import { createHash, randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import type { Sql } from 'postgres';
import { z } from 'zod';
import {
  createAIProvider,
  AIProviderError,
  providerEmbeddingIdentity,
  type AIProvider,
} from '@threadsignal/ai';
import { EMBEDDING_DIMENSIONS } from '@threadsignal/knowledge';
import {
  draftContextSchema,
  draftControlsSchema,
  draftKnowledgeSchema,
  draftVerificationSchema,
  type DraftContext,
} from '@threadsignal/drafts';
import { generateDraft, verifyDraft, checkDraftCompliance } from '@threadsignal/drafts/pipeline';
import { createLogger, createObservability } from '@threadsignal/shared';
import { draftPolicySchema, type WorkerConfig } from '../config';
import { createWorkerAI, withWorkerAIUsage, type WorkerAIUsage } from '../providers';

export const DRAFT_QUEUES = {
  generate: 'generate-draft',
  verify: 'verify-draft-claims',
  compliance: 'check-draft-compliance',
} as const;
export const draftPayload = z.object({ jobId: z.uuid() }).strict();
const jobSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  draft_id: z.uuid(),
  kind: z.enum(['generate', 'verify', 'compliance']),
  version: z.number().int().nonnegative(),
  attempts: z.number().int().min(1).max(3),
  lease_token: z.uuid(),
  options: draftControlsSchema,
});
export type DraftJob = z.infer<typeof jobSchema>;
const timestamp = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
// Bounded context: at most eight chunks / 24,000 characters, plus bounded thread and rules.
export const DRAFT_CONTEXT_CHARACTERS = 24_000;
const defaultDraftPolicy = {
  maxSourceCharacters: DRAFT_CONTEXT_CHARACTERS,
  maxContextCharacters: 80_000,
};
// Cache only retrieved source IDs, never Reddit text, drafts or provider output.
// Each provider instance has its own bounded cache; tenant and current context are in the key.
const retrievalCaches = new WeakMap<AIProvider, Map<string, { ids: string[]; expires: number }>>();

export async function claimDraftJob(sql: Sql, id: string): Promise<DraftJob | null> {
  z.uuid().parse(id);
  return sql.begin(async (tx) => {
    // Match publication/edit lock order. In particular, exhausted-lease cleanup
    // must not hold a job lock while waiting for an editor's draft lock.
    const [identity] =
      await tx`select organization_id,draft_id from public.draft_jobs where id=${id}`;
    if (!identity) return null;
    const [organization] =
      await tx`select id from public.organizations where id=${identity.organization_id} and status='active' and deleted_at is null for update`;
    if (!organization) return null;
    await tx`select id from public.drafts where id=${identity.draft_id} for update`;
    const expired =
      await tx`update public.draft_jobs set status='failed',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null
      where id=${id} and status='processing' and attempts>=3 and lease_expires_at<=now() returning draft_id,version`;
    for (const row of expired)
      await tx`update public.drafts set status='error',error_code='LEASE_EXPIRED' where id=${row.draft_id} and current_version=${row.version} and status not in ('approved','rejected') and purged_at is null`;
    const [row] =
      await tx`update public.draft_jobs set status='processing',attempts=attempts+1,lease_token=${randomUUID()},lease_expires_at=now()+interval '90 seconds',error_code=null
      where id=${id} and attempts<3 and ((status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<=now())) returning *`;
    return row ? jobSchema.parse(row) : null;
  });
}

/** Read only this tenant's current, included sources. Source content never becomes instructions. */
export async function readDraftContext(
  sql: Sql,
  job: DraftJob,
  ai: AIProvider,
  now = new Date(),
  configuredPolicy: WorkerConfig['draftPolicy'] = defaultDraftPolicy,
) {
  const policy = draftPolicySchema.parse(configuredPolicy);
  await sql`select private.require_draft_available(${job.draft_id}::uuid)`;
  const [row] = await sql`select d.current_version,d.current_content,d.status,d.purged_at,b.profile,
    to_jsonb(persona) as persona,p.id as post_id,p.title,p.body,p.is_deleted,p.is_locked,p.is_archived,
    s.name as subreddit,o.user_need,private.draft_context_checksum(d.id) as checksum
    from public.drafts d join public.brands b on b.id=d.brand_id and b.organization_id=d.organization_id
    join public.brand_personas persona on persona.id=d.persona_id and persona.organization_id=d.organization_id
    join public.opportunities o on o.id=d.opportunity_id and o.organization_id=d.organization_id
    join public.reddit_posts p on p.id=o.reddit_post_id join public.subreddits s on s.id=p.subreddit_id
    where d.id=${job.draft_id} and d.organization_id=${job.organization_id} and d.brand_id=${job.brand_id}`;
  if (!row || row.current_version !== job.version || row.status === 'rejected' || row.purged_at)
    return null;
  const checksum = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(row.checksum);
  const [generation] =
    job.kind === 'generate'
      ? []
      : await sql`select options from public.draft_jobs where draft_id=${job.draft_id} and kind='generate' and status='completed' order by created_at desc,id desc limit 1`;
  const controls = draftControlsSchema.parse(generation?.options ?? job.options);
  const identity = providerEmbeddingIdentity(ai);
  const query = [
    row.title,
    row.user_need,
    controls.capability ?? '',
    String(row.body ?? '').slice(0, 2000),
  ]
    .join('\n')
    .slice(0, 4000);
  let cache = retrievalCaches.get(ai);
  if (!cache) {
    cache = new Map();
    retrievalCaches.set(ai, cache);
  }
  const key = createHash('sha256')
    .update(JSON.stringify([job.organization_id, job.brand_id, checksum, query, identity]))
    .digest('hex');
  for (const [entry, value] of cache) if (value.expires <= Date.now()) cache.delete(entry);
  const cached = cache.get(key);
  const vectors = cached
    ? [Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)]
    : z
        .array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS))
        .length(1)
        .parse(await ai.embed({ texts: [query], dimensions: EMBEDDING_DIMENSIONS }));
  const embedding = JSON.stringify(vectors[0]);
  const cachedIds = cached?.ids ?? [];
  const [chunks, rules] = await Promise.all([
    sql`select c.id,c.source_id,c.document_id,doc.title,c.content,
      doc.canonical_url as source_url,s.filename,doc.page_number,coalesce(c.section_heading,doc.section_heading) as section_heading,
      s.last_ingested_at as updated_at
      from public.knowledge_chunks c join public.knowledge_documents doc on doc.id=c.document_id
      join public.knowledge_sources s on s.id=c.source_id
      where c.brand_id=${job.brand_id} and c.organization_id=${job.organization_id} and doc.is_included
        and c.embedding_identity=${identity} and doc.embedding_identity=${identity}
        and s.deleted_at is null and s.status in ('ready','partial') and s.last_ingested_at>now()-interval '90 days'
        and (${!cached} or c.id=any(${cachedIds}::uuid[]))
      order by case when ${Boolean(cached)} then 1-array_position(${cachedIds}::uuid[],c.id)::float/10 else (0.75*(1-(c.embedding operator(extensions.<=>) ${embedding}::extensions.vector(512)))
        +0.2*ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',${query}))
        +case when doc.canonical_url ~ '/(docs|pricing)(/|$)' then 0.05 else 0 end) end desc,c.id limit 8`,
    sql`select r.title,r.description from public.subreddit_rules r join public.reddit_posts p on p.subreddit_id=r.subreddit_id where p.id=${row.post_id} order by r.id limit 100`,
  ]);
  if (!cached) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    cache.set(key, {
      ids: chunks.map((chunk) => z.uuid().parse(chunk.id)),
      expires: Date.now() + 300_000,
    });
  }
  let remaining = policy.maxSourceCharacters;
  const knowledge: DraftContext['knowledge'] = [];
  for (const chunk of chunks) {
    const text = z.string().parse(chunk.content);
    // Whole chunks preserve claim meaning; never trim a sentence into apparent evidence.
    if (text.length > remaining || text.length > 12000) continue;
    knowledge.push(
      draftKnowledgeSchema.parse({
        ...chunk,
        updated_at: timestamp.parse(chunk.updated_at),
        is_stale: false,
        is_inferred: false,
      }),
    );
    remaining -= text.length;
  }
  const context = draftContextSchema.parse({
    brand: row.profile,
    persona: row.persona,
    post: {
      id: row.post_id,
      title: row.title ?? '',
      body: row.body ?? '',
      subreddit: row.subreddit,
      deleted: row.is_deleted,
      locked: row.is_locked,
      archived: row.is_archived,
    },
    rules,
    knowledge,
    now: now.toISOString(),
    controls,
  });
  if (JSON.stringify(context).length > policy.maxContextCharacters)
    throw new Error('DRAFT_CONTEXT_TOO_LARGE');
  return { context, checksum, text: z.string().parse(row.current_content) };
}

const terminalCodes = new Set([
  'DRAFT_CONTEXT_TOO_LARGE',
  'POST_STALE',
  'OPPORTUNITY_UNAVAILABLE',
  'PLAN_INACTIVE',
  'TRIAL_EXPIRED',
  'POST_DELETED',
  'OPPORTUNITY_BLOCKED',
  'ORGANIZATION_UNAVAILABLE',
  'BRAND_ARCHIVED',
  'SUBREDDIT_PAUSED',
  'PLAN_UNAVAILABLE',
  'NO_ACTIVE_SUBSCRIPTION',
  'INVALID_KNOWLEDGE_REFERENCE',
]);
function safeFailure(error: unknown) {
  if (error instanceof AIProviderError)
    return {
      code: `AI_${error.code}`,
      retryMs: error.retryAfterMs,
      terminal: ['CONFIGURATION', 'REFUSED'].includes(error.code),
    };
  if (error instanceof z.ZodError)
    return { code: 'INVALID_DRAFT_RESPONSE', retryMs: 0, terminal: false };
  if (error instanceof Error && terminalCodes.has(error.message))
    return { code: error.message, retryMs: 0, terminal: true };
  return { code: 'DRAFT_PROCESSING_FAILED', retryMs: 0, terminal: false };
}

async function finishUnpublished(
  sql: Sql,
  job: DraftJob,
  code: string,
  retry = false,
  retryMs = 0,
) {
  await sql.begin(async (tx) => {
    const [current] =
      await tx`select d.current_version,d.status,d.purged_at from public.drafts d where d.id=${job.draft_id} for update`;
    const live =
      current &&
      current.current_version === job.version &&
      !current.purged_at &&
      !['approved', 'rejected'].includes(current.status);
    const status = !live ? 'completed' : retry && job.attempts < 3 ? 'queued' : 'failed';
    const rows =
      await tx`update public.draft_jobs set status=${status},error_code=${code},lease_token=null,lease_expires_at=null,
      available_at=now()+${Math.max(retryMs, 1000 * 2 ** (job.attempts - 1))}*interval '1 millisecond'
      where id=${job.id} and status='processing' and lease_token=${job.lease_token} and lease_expires_at>now() returning id`;
    if (rows.length && live && status === 'failed')
      await tx`update public.drafts set status='error',error_code=${code},verified_version=null,approved_at=null,approved_by=null where id=${job.draft_id}`;
  });
}

/** Each publication is version/lease/context fenced by SQL, including post-deletion races. */
export async function processDraftJob(
  sql: Sql,
  id: string,
  ai: AIProvider = createAIProvider(),
  now = new Date(),
  policy: WorkerConfig['draftPolicy'] = defaultDraftPolicy,
) {
  return withWorkerAIUsage(ai, (usage) =>
    processDraftJobWithUsage(sql, id, ai, now, policy, usage),
  );
}

async function processDraftJobWithUsage(
  sql: Sql,
  id: string,
  ai: AIProvider,
  now: Date,
  policy: WorkerConfig['draftPolicy'],
  usage: () => WorkerAIUsage,
) {
  const job = await claimDraftJob(sql, id);
  if (!job) return { status: 'skipped' };
  let renewing: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (renewing) return;
    renewing =
      sql`update public.draft_jobs set lease_expires_at=now()+interval '90 seconds' where id=${job.id} and lease_token=${job.lease_token} and status='processing' and lease_expires_at>now()`
        .catch(() => undefined)
        .finally(() => {
          renewing = null;
        });
  }, 20_000);
  try {
    const input = await readDraftContext(sql, job, ai, now, policy);
    if (!input) {
      await finishUnpublished(sql, job, 'DRAFT_VERSION_CHANGED');
      return { status: 'stale' };
    }
    const { context, checksum, text } = input;
    let published: boolean;
    if (job.kind === 'generate') {
      const result = await generateDraft(context, ai);
      const [row] =
        await sql`select private.publish_draft_generation(${job.id},${job.lease_token},${checksum},${sql.json({ ...result, provider_metadata: usage() })}::jsonb) as published`;
      published = row?.published === true;
    } else if (job.kind === 'verify') {
      const result = await verifyDraft({ ...context, text }, ai);
      const [row] =
        await sql`select private.publish_draft_verification(${job.id},${job.lease_token},${checksum},${sql.json({ ...result, provider_metadata: usage() })}::jsonb) as published`;
      published = row?.published === true;
    } else {
      const [draft] =
        await sql`select verification_status,context_checksum from public.drafts where id=${job.draft_id} and current_version=${job.version}`;
      if (
        !draft ||
        draft.context_checksum !== checksum ||
        draft.verification_status === 'pending'
      ) {
        await finishUnpublished(sql, job, 'DRAFT_CONTEXT_CHANGED');
        return { status: 'stale' };
      }
      const claims =
        await sql`select c.claim_text,c.status,c.confidence,c.source_chunk_ids,c.explanation from public.draft_claims c join public.draft_versions v on v.id=c.draft_version_id where c.draft_id=${job.draft_id} and v.version=${job.version} order by c.created_at,c.id`;
      const verification = draftVerificationSchema.parse({
        overall_status: draft.verification_status,
        claims,
      });
      const result = await checkDraftCompliance({ ...context, text, verification }, ai);
      const [row] =
        await sql`select private.publish_draft_compliance(${job.id},${job.lease_token},${checksum},${sql.json({ ...result, provider_metadata: usage() })}::jsonb) as published`;
      published = row?.published === true;
    }
    if (!published) await finishUnpublished(sql, job, 'DRAFT_CONTEXT_CHANGED', true);
    return { status: published ? 'completed' : 'stale' };
  } catch (error) {
    const failure = safeFailure(error);
    await finishUnpublished(sql, job, failure.code, !failure.terminal, failure.retryMs);
    return { status: 'retry_or_failed', code: failure.code };
  } finally {
    clearInterval(timer);
    await renewing;
    // Publication may fail after a billed response, or a later attempt may retry
    // the same job. Persist each claimed attempt independently, including failures.
    await sql`select private.record_draft_attempt_usage(${job.id},${job.attempts},${job.lease_token},${sql.json(usage())}::jsonb)`;
  }
}

export async function startDraftWorker(sql: Sql, config: WorkerConfig) {
  if (config.mode !== 'local' && config.mode !== 'deployment')
    throw new Error('Phase 4 processing requires the verified local database.');
  const logger = createLogger({ service: 'draft-worker', level: config.logLevel });
  const observability = createObservability({});
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2000 };
  const ai = createWorkerAI(config);
  const kinds = Object.keys(DRAFT_QUEUES) as (keyof typeof DRAFT_QUEUES)[];
  const queues = kinds.map(
    (kind) =>
      new Queue<{ jobId: string }>(DRAFT_QUEUES[kind], {
        connection,
        prefix: config.queuePrefix,
        defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
      }),
  );
  const workers = kinds.map(
    (kind) =>
      new Worker<{ jobId: string }>(
        DRAFT_QUEUES[kind],
        async (item) => {
          const data = draftPayload.parse(item.data);
          return observability.run(`draft.${kind}`, { jobId: data.jobId }, async () => {
            const result = await processDraftJob(
              sql,
              data.jobId,
              ai,
              new Date(),
              config.draftPolicy,
            );
            logger.info(
              { event: 'draft_job_finished', jobId: data.jobId, ...result },
              'Draft stage processed.',
            );
            return result;
          });
        },
        { connection, prefix: config.queuePrefix, concurrency: 2 },
      ),
  );
  const queueError = () =>
    logger.warn({ event: 'draft_queue_unavailable' }, 'Draft queue unavailable.');
  for (const queue of queues) queue.on('error', queueError);
  for (const worker of workers) worker.on('error', queueError);
  for (const worker of workers)
    worker.on('failed', () =>
      logger.warn(
        { event: 'draft_delivery_failed' },
        'Durable draft job recovery will retry delivery.',
      ),
    );
  try {
    await Promise.all([...queues, ...workers].map((resource) => resource.waitUntilReady()));
  } catch {
    await Promise.allSettled([...queues, ...workers].map((resource) => resource.close()));
    throw new Error('Draft queues unavailable.');
  }
  let stopped = false,
    dispatching = false,
    lastDispatch: number | null = null;
  let dispatchFinished: Promise<void> = Promise.resolve();
  const dispatch = async () => {
    if (stopped || dispatching) return;
    dispatching = true;
    let finish: () => void = () => undefined;
    dispatchFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      const rows =
        await sql`select j.id,j.kind,j.attempts from public.draft_jobs j join public.organizations o on o.id=j.organization_id
          where o.status='active' and o.deleted_at is null and ((j.status='queued' and j.available_at<=now()) or (j.status='processing' and j.lease_expires_at<=now())) order by j.available_at,j.id limit 100`;
      for (const row of rows) {
        if (stopped) break;
        const kind = jobSchema.shape.kind.parse(row.kind),
          id = z.uuid().parse(row.id);
        await queues[kinds.indexOf(kind)]!.add(
          'process',
          { jobId: id },
          { jobId: `${id}-${z.number().int().parse(row.attempts)}` },
        );
      }
      lastDispatch = Date.now();
    } catch {
      lastDispatch = null;
      logger.warn({ event: 'draft_dispatch_failed' }, 'Draft outbox dispatch unavailable.');
    } finally {
      dispatching = false;
      finish();
    }
  };
  await dispatch();
  const timer = setInterval(() => {
    void dispatch();
  }, 1500);
  return {
    isReady: () =>
      !stopped &&
      lastDispatch !== null &&
      Date.now() - lastDispatch < 30_000 &&
      workers.every((worker) => worker.isRunning()),
    stop: async (force = false) => {
      stopped = true;
      clearInterval(timer);
      await dispatchFinished;
      await Promise.all(workers.map((worker) => worker.close(force)));
      await Promise.all(queues.map((queue) => queue.close()));
    },
  };
}
