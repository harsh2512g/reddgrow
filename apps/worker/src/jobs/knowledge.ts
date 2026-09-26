import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Queue, Worker } from 'bullmq';
import type { Sql, TransactionSql } from 'postgres';
import { createAIProvider, providerEmbeddingIdentity, type AIProvider } from '@threadsignal/ai';
import { createCrawlerProvider, type CrawlerProvider } from '@threadsignal/crawler';
import { createLogger, createObservability } from '@threadsignal/shared';
import {
  crawlDocuments,
  extractKnowledgeFile,
  extractManualText,
  prepareDocuments,
  safeIngestionError,
  type PreparedDocument,
} from '@threadsignal/knowledge/pipeline';
import type { WorkerConfig } from '../config';
import { WorkerKnowledgeStorage } from '../storage';
import { createWorkerAI, createWorkerCrawler, withWorkerAIOperation } from '../providers';

export const KNOWLEDGE_QUEUE = 'knowledge-ingestion';
export const LEASE_SECONDS = 90;
export const MAX_JOB_ATTEMPTS = 3;
export const knowledgePayload = z.object({ jobId: z.uuid() }).strict();
const jobSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  source_id: z.uuid(),
  generation: z.number().int(),
  kind: z.enum(['ingest', 'delete']),
  attempts: z.number().int(),
  lease_token: z.uuid(),
});
const sourceSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  generation: z.number().int(),
  type: z.enum(['website', 'webpage', 'file', 'manual']),
  name: z.string(),
  filename: z.string().nullable(),
  mime_type: z.string().nullable(),
  storage_path: z.string().nullable(),
  manual_text: z.string().nullable(),
  selected_pages: z.array(z.string()),
  website_url: z.string(),
});
type ClaimedJob = z.infer<typeof jobSchema>;
export const retryDelaySeconds = (attempt: number) => Math.min(30, 2 ** Math.max(1, attempt));

/** Lock organization, source, then job so pause/deletion cannot race publication. */
async function lockCurrent(sql: TransactionSql, job: ClaimedJob) {
  const [guard] =
    await sql`select public.worker_lock_knowledge_organization(${job.id}) as eligible`;
  if (guard?.eligible !== true) return false;
  const sources =
    await sql`select id,generation,deleted_at from public.knowledge_sources where id=${job.source_id} and organization_id=${job.organization_id} and brand_id=${job.brand_id} for update`;
  const source = sources[0];
  if (
    !source ||
    source.generation !== job.generation ||
    (job.kind === 'ingest' ? source.deleted_at !== null : source.deleted_at === null)
  )
    return false;
  const rows =
    await sql`select id from public.knowledge_jobs where id=${job.id} and generation=${job.generation} and status='processing' and lease_token=${job.lease_token} and lease_expires_at>now() for update`;
  return rows.length === 1;
}

export async function claimKnowledgeJob(sql: Sql, jobId: string): Promise<ClaimedJob | null> {
  z.uuid().parse(jobId);
  return await sql.begin(async (tx) => {
    const [candidate] = await tx`select * from public.knowledge_jobs where id=${jobId}`;
    if (!candidate) return null;
    const [guard] =
      await tx`select public.worker_lock_knowledge_organization(${jobId}) as eligible`;
    if (guard?.eligible !== true) return null;
    const [source] =
      await tx`select id,generation,deleted_at from public.knowledge_sources where id=${candidate.source_id} for update`;
    if (!source) return null;
    if (source.generation !== candidate.generation) {
      await tx`update public.knowledge_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code='STALE_GENERATION' where id=${jobId} and status in ('queued','processing')`;
      return null;
    }
    if (candidate.attempts >= MAX_JOB_ATTEMPTS) {
      const failed =
        await tx`update public.knowledge_jobs set status='failed',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null where id=${jobId} and status='processing' and lease_expires_at<=now() returning id`;
      if (failed.length)
        await tx`update public.knowledge_sources set status=${candidate.kind === 'delete' ? 'deleting' : 'failed'},error_code='LEASE_EXPIRED' where id=${source.id}`;
      return null;
    }
    const token = randomUUID();
    const rows =
      await tx`update public.knowledge_jobs set status='processing',attempts=attempts+1,lease_token=${token},lease_expires_at=now()+interval '90 seconds',error_code=null
      where id=${jobId} and attempts<3 and ((status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<=now())) returning *`;
    if (!rows.length) return null;
    const job = jobSchema.parse(rows[0]);
    if (job.kind === 'ingest')
      await tx`update public.knowledge_sources set status='processing',error_code=null where id=${source.id} and deleted_at is null`;
    return job;
  });
}

export async function publishKnowledge(
  sql: Sql,
  job: ClaimedJob,
  documents: PreparedDocument[],
  partial: boolean,
  embeddingIdentity?: string,
) {
  return await sql.begin(async (tx) => {
    if (!(await lockCurrent(tx, job))) return false;
    const keys = documents.map((document) => document.key);
    await tx`delete from public.knowledge_documents where source_id=${job.source_id} and document_key not in ${tx(keys)}`;
    let chunkCount = 0;
    for (const document of documents) {
      const [previous] =
        await tx`select id,checksum ${embeddingIdentity ? tx`,embedding_identity` : tx``} from public.knowledge_documents where source_id=${job.source_id} and document_key=${document.key}`;
      const id = typeof previous?.id === 'string' ? previous.id : randomUUID();
      await tx`insert into public.knowledge_documents(id,organization_id,brand_id,source_id,document_key,title,canonical_url,page_number,section_heading,content,checksum)
        values(${id},${job.organization_id},${job.brand_id},${job.source_id},${document.key},${document.title},${document.canonicalUrl},${document.pageNumber},${document.sectionHeading},${document.content},${document.checksum})
        on conflict(source_id,document_key) do update set title=excluded.title,canonical_url=excluded.canonical_url,page_number=excluded.page_number,section_heading=excluded.section_heading,content=excluded.content,checksum=excluded.checksum`;
      if (
        previous?.checksum !== document.checksum ||
        (embeddingIdentity && previous?.embedding_identity !== embeddingIdentity)
      ) {
        await tx`delete from public.knowledge_chunks where document_id=${id}`;
        for (const chunk of document.chunks) {
          await tx`insert into public.knowledge_chunks(organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,checksum,embedding,section_heading)
            values(${job.organization_id},${job.brand_id},${job.source_id},${id},${chunk.index},${chunk.content},${chunk.tokenCount},${chunk.checksum},${JSON.stringify(chunk.embedding)}::extensions.vector,${chunk.sectionHeading})`;
        }
      }
      if (embeddingIdentity) {
        await tx`update public.knowledge_documents set embedding_identity=${embeddingIdentity} where id=${id}`;
        await tx`update public.knowledge_chunks set embedding_identity=${embeddingIdentity} where document_id=${id}`;
      }
      chunkCount += document.chunks.length;
    }
    await tx`update public.knowledge_sources set status=${partial ? 'partial' : 'ready'},error_code=${partial ? 'PARTIAL_CRAWL' : null},page_count=${documents.length},chunk_count=${chunkCount},last_ingested_at=now() where id=${job.source_id}`;
    await tx`update public.knowledge_jobs set status='completed',lease_token=null,lease_expires_at=null,error_code=null where id=${job.id}`;
    return true;
  });
}

async function recordFailure(sql: Sql, job: ClaimedJob, errorCode: string) {
  await sql.begin(async (tx) => {
    if (!(await lockCurrent(tx, job))) return;
    const retry = job.attempts < MAX_JOB_ATTEMPTS;
    await tx`update public.knowledge_jobs set status=${retry ? 'queued' : 'failed'},available_at=now()+${retryDelaySeconds(job.attempts)}*interval '1 second',lease_token=null,lease_expires_at=null,error_code=${errorCode} where id=${job.id}`;
    await tx`update public.knowledge_sources set status=${job.kind === 'delete' ? 'deleting' : retry ? 'pending' : 'failed'},error_code=${errorCode} where id=${job.source_id}`;
  });
}

export async function processKnowledgeJob(
  sql: Sql,
  jobId: string,
  storage: WorkerKnowledgeStorage,
  providers: { ai: AIProvider; crawler: CrawlerProvider; embeddingIdentity?: string } = {
    ai: createAIProvider(),
    crawler: createCrawlerProvider(),
  },
) {
  if (
    providers.ai.mode !== 'mock' &&
    providers.embeddingIdentity !== providerEmbeddingIdentity(providers.ai)
  )
    throw new Error('Real knowledge embeddings require their configured vector-space identity.');
  const job = await claimKnowledgeJob(sql, jobId);
  if (!job) return { status: 'skipped' } as const;
  const renewal = setInterval(() => {
    void sql`update public.knowledge_jobs set lease_expires_at=now()+interval '90 seconds' where id=${job.id} and lease_token=${job.lease_token} and status='processing' and lease_expires_at>now()`.catch(
      () => undefined,
    );
  }, 20_000);
  renewal.unref();
  try {
    const rows =
      await sql`select s.*,b.website_url from public.knowledge_sources s join public.brands b on b.id=s.brand_id where s.id=${job.source_id} and s.generation=${job.generation}`;
    const result = sourceSchema.safeParse(rows[0]);
    if (!result.success) return { status: 'stale' } as const;
    const source = result.data;
    if (job.kind === 'delete') {
      // Deletion already removes searchable content transactionally. Retain the tombstone until storage confirms cleanup.
      if (source.storage_path)
        await storage.remove(source.storage_path, job.organization_id, job.brand_id);
      await sql.begin(async (tx) => {
        if (await lockCurrent(tx, job))
          await tx`delete from public.knowledge_sources where id=${job.source_id}`;
      });
      return { status: 'deleted' } as const;
    }
    let extracted;
    let partial = false;
    if (source.type === 'manual')
      extracted = extractManualText(source.manual_text ?? '', source.name);
    else if (source.type === 'file')
      extracted = await extractKnowledgeFile({
        filename: source.filename ?? '',
        mimeType: source.mime_type ?? '',
        bytes: await storage.read(source.storage_path ?? '', job.organization_id, job.brand_id),
      });
    else {
      const crawled = await crawlDocuments(
        { pages: source.selected_pages, approvedDomains: [new URL(source.website_url).hostname] },
        providers.crawler,
      );
      extracted = crawled.documents;
      partial = crawled.partial;
    }
    const previous =
      await sql`select checksum,embedding::text as embedding from public.knowledge_chunks where organization_id=${job.organization_id} and brand_id=${job.brand_id} and source_id=${job.source_id} ${providers.embeddingIdentity ? sql`and embedding_identity=${providers.embeddingIdentity}` : sql``}`;
    const cache = new Map<string, number[]>();
    for (const row of previous) {
      if (typeof row.checksum === 'string' && typeof row.embedding === 'string') {
        const embedding = z
          .array(z.number().finite())
          .length(512)
          .safeParse(JSON.parse(row.embedding));
        if (embedding.success) cache.set(row.checksum, embedding.data);
      }
    }
    const documents = providers.embeddingIdentity
      ? await withWorkerAIOperation(
          sql,
          {
            organizationId: job.organization_id,
            brandId: job.brand_id,
            operationId: job.lease_token,
            task: 'knowledge.embed',
          },
          providers.ai,
          (tracked) => prepareDocuments(extracted, tracked, cache),
        )
      : await prepareDocuments(extracted, providers.ai, cache);
    const published = await publishKnowledge(
      sql,
      job,
      documents,
      partial,
      providers.embeddingIdentity,
    );
    return { status: published ? 'completed' : 'stale' } as const;
  } catch (error) {
    await recordFailure(sql, job, safeIngestionError(error).toUpperCase());
    return { status: 'retry_or_failed' } as const;
  } finally {
    clearInterval(renewal);
  }
}

export async function startKnowledgeWorker(sql: Sql, config: WorkerConfig) {
  const ai = createWorkerAI(config);
  const providers = {
    ai,
    crawler: createWorkerCrawler(config),
    ...(config.mode === 'personal-development'
      ? {}
      : { embeddingIdentity: providerEmbeddingIdentity(ai) }),
  };
  const logger = createLogger({ service: 'knowledge-worker', level: config.logLevel });
  const observability = createObservability({});
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2_000 };
  // PostgreSQL owns retry state and failure visibility. Never let an old Redis failure block redispatch.
  const queue = new Queue<{ jobId: string }>(KNOWLEDGE_QUEUE, {
    connection,
    prefix: config.queuePrefix,
    defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
  });
  const storage = new WorkerKnowledgeStorage(config.storage);
  const worker = new Worker<{ jobId: string }>(
    KNOWLEDGE_QUEUE,
    async (item) => {
      const data = knowledgePayload.parse(item.data);
      return observability.run('knowledge.ingest', { jobId: data.jobId }, async () => {
        const result = await processKnowledgeJob(sql, data.jobId, storage, providers);
        logger.info(
          { event: 'knowledge_job_finished', jobId: data.jobId, status: result.status },
          'Knowledge job processed.',
        );
        return result;
      });
    },
    { connection, prefix: config.queuePrefix, concurrency: 2 },
  );
  queue.on('error', () =>
    logger.warn({ event: 'knowledge_queue_error' }, 'Knowledge dispatch queue unavailable.'),
  );
  worker.on('error', () =>
    logger.warn({ event: 'knowledge_worker_error' }, 'Knowledge processor unavailable.'),
  );
  worker.on('failed', (job) =>
    logger.warn(
      { event: 'knowledge_job_delivery_failed', jobId: job?.data.jobId },
      'Durable lease recovery will retry this delivery.',
    ),
  );
  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
  } catch {
    await Promise.allSettled([worker.close(true), queue.close()]);
    throw new Error('Local knowledge queue could not start.');
  }
  let dispatching = false;
  let stopped = false;
  let lastSuccessfulDispatchAt: number | null = null;
  const dispatch = async () => {
    if (dispatching || stopped) return;
    dispatching = true;
    try {
      const rows = await sql`select id,attempts from public.worker_knowledge_dispatch(50)`;
      for (const row of rows) {
        const id = z.uuid().parse(row.id);
        const attempts = z.number().int().parse(row.attempts);
        await queue.add('process', { jobId: id }, { jobId: `${id}-${attempts}` });
      }
      lastSuccessfulDispatchAt = Date.now();
    } catch {
      lastSuccessfulDispatchAt = null;
      logger.warn({ event: 'knowledge_dispatch_failed' }, 'Knowledge outbox dispatch unavailable.');
    } finally {
      dispatching = false;
    }
  };
  await dispatch();
  const timer = setInterval(() => {
    void dispatch();
  }, 1500);
  return {
    isReady: () => {
      const age = lastSuccessfulDispatchAt === null ? null : Date.now() - lastSuccessfulDispatchAt;
      return !stopped && worker.isRunning() && age !== null && age >= 0 && age <= 30_000;
    },
    stop: async (force = false) => {
      stopped = true;
      clearInterval(timer);
      await worker.close(force);
      await queue.close();
    },
  };
}
