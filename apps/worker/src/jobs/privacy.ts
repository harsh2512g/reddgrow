import { createHash, randomUUID } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Queue, Worker } from 'bullmq';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { createLogger, createObservability } from '@threadsignal/shared';
import type { WorkerConfig, WorkerStorageConfig } from '../config';
import { WorkerKnowledgeStorage } from '../storage';

const compress = promisify(gzip);
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
export const MAX_EXPORT_ROWS = 50_000;
const claimSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  kind: z.enum(['export', 'delete']),
  attempts: z.number().int().min(1).max(3),
  lease_token: z.uuid(),
});
type PrivacyClaim = z.infer<typeof claimSchema>;
const storageObjectSchema = z.object({
  bucket_id: z.enum(['privacy-exports', 'knowledge-private']),
  name: z.string(),
});
const exportSourceSchema = z.object({
  id: z.uuid(),
  brand_id: z.uuid(),
  filename: z.string(),
  storage_path: z.string(),
});

/** Deliberate allowlists: a newly added column can never silently enter an export. */
export const EXPORT_SECTIONS = [
  [
    'organizations',
    'id',
    'id,name,slug,billing_email,timezone,default_currency,status,trial_started_at,trial_ends_at,created_at,updated_at',
  ],
  ['organization_members', 'user_id', 'user_id,role,invited_by,joined_at'],
  [
    'organization_invitations',
    'id',
    'id,email,role,expires_at,accepted_at,revoked_at,created_by,created_at',
  ],
  ['brands', 'id', 'id,name,website_url,profile,status,created_at,updated_at'],
  ['brand_competitors', 'id', 'id,brand_id,name,domain,aliases,created_at,updated_at'],
  [
    'brand_personas',
    'id',
    'id,brand_id,name,real_role,tone,custom_tone,reply_length,default_disclosure,prohibited_statements,technical_depth,allowed_first_person_statements,created_at,updated_at',
  ],
  ['brand_keywords', 'id', 'id,brand_id,value,kind,is_exclusion,status,source,created_at'],
  [
    'brand_subreddits',
    'id',
    'id,brand_id,subreddit_id,status,priority,minimum_score,risk_level,product_relevance,allowed_reply_style,internal_notes,internal_interpretation,monitor_new,monitor_hot,monitor_rising,created_at,updated_at',
  ],
  [
    'knowledge_sources',
    'id',
    'id,brand_id,name,type,status,source_url,filename,mime_type,manual_text,selected_pages,page_count,chunk_count,generation,created_at,updated_at,last_ingested_at,deleted_at',
  ],
  [
    'knowledge_documents',
    'id',
    'id,brand_id,source_id,title,canonical_url,page_number,section_heading,content,is_included,created_at,updated_at',
  ],
  [
    'knowledge_chunks',
    'id',
    'id,brand_id,source_id,document_id,chunk_index,content,token_count,section_heading,created_at',
  ],
  [
    'opportunities',
    'id',
    'id,brand_id,reddit_post_id,subreddit_id,status,summary,user_need,intent_category,semantic_relevance,buying_intent,freshness,engagement_velocity,rule_fit,competitor_context,penalty_score,final_score,risk_level,suggested_action,is_blocked,risk_reasons,matched_capabilities,missing_capabilities,matched_competitor_ids,knowledge_citations,reasoning_summary,evaluated_at,dismissed_reason,created_at,updated_at',
  ],
  [
    'drafts',
    'id',
    'id,brand_id,opportunity_id,persona_id,status,current_version,current_content,strategy,brand_mentioned,disclosure_included,suggested_link,verification_status,compliance_status,approved_by,approved_at,warnings_acknowledged_at,inserted_at,inserted_version,published_at,published_version,published_comment_url,rejection_reason,purged_at,created_by,created_at,updated_at',
  ],
  ['draft_versions', 'id', 'id,draft_id,version,content,source,instruction,created_by,created_at'],
  [
    'draft_claims',
    'id',
    'id,draft_id,draft_version_id,claim_text,status,confidence,explanation,source_chunk_ids,evidence_kind,provenance,created_at',
  ],
  [
    'draft_compliance_checks',
    'id',
    'id,draft_id,draft_version_id,status,checks,safe_to_approve,created_at',
  ],
  ['draft_feedback', 'id', 'id,brand_id,opportunity_id,draft_id,user_id,rating,notes,created_at'],
  ['tracking_settings', 'organization_id', 'attribution_days,consent_text,updated_at'],
  [
    'tracking_links',
    'id',
    'id,brand_id,opportunity_id,draft_id,draft_version,draft_style,code,destination_url,utm_config,overwrite_utm,status,created_by,created_at,revoked_at',
  ],
  ['tracking_clicks', 'id', 'id,brand_id,tracking_link_id,occurred_at'],
  [
    'conversion_events',
    'id',
    'id,brand_id,tracking_click_id,tracking_link_id,event_type,external_id,value,currency,occurred_at,metadata,source,created_at',
  ],
  ['conversion_api_keys', 'id', 'id,brand_id,name,last_used_at,created_by,created_at,revoked_at'],
  [
    'subscriptions',
    'id',
    'id,provider,plan_key,status,current_period_start,current_period_end,cancel_at_period_end,grace_ends_at,created_at,updated_at',
  ],
  ['usage_counters', 'id', 'id,metric,period_start,period_end,quantity,updated_at'],
  [
    'ai_task_usage',
    'id',
    'id,brand_id,draft_id,job_id,task,provider,model,input_tokens,output_tokens,estimated_cost_usd,created_at',
  ],
  [
    'billing_checkout_requests',
    'id',
    'id,requested_by,plan_key,provider,status,expires_at,completed_at,created_at',
  ],
  ['billing_events', 'id', 'id,provider,provider_created_at,outcome,created_at'],
  [
    'organization_data_requests',
    'id',
    'id,requested_by,kind,status,confirmed_at,completed_at,expires_at,error_code,created_at,updated_at',
  ],
  [
    'notification_preferences',
    'id',
    'id,user_id,categories,minimum_score,digest_time,quiet_start,quiet_end,created_at,updated_at',
  ],
  ['notification_deliveries', 'id', 'id,user_id,type,status,provider,created_at,sent_at'],
  ['extension_sessions', 'id', 'id,user_id,name,last_used_at,expires_at,revoked_at,created_at'],
  ['responsible_use_acceptances', 'user_id', 'user_id,notice_version,accepted_at'],
  ['audit_logs', 'id', 'id,actor_user_id,actor_type,action,target_type,target_id,created_at'],
] as const;

export interface PrivacyStorage {
  readOriginal(path: string, organizationId: string, brandId: string): Promise<Uint8Array>;
  writeExport(path: string, bytes: Uint8Array): Promise<void>;
  remove(bucket: 'privacy-exports' | 'knowledge-private', path: string): Promise<void>;
}

/** Fixed local Supabase endpoint; no inherited configuration or hosted credentials. */
export class LocalPrivacyStorage implements PrivacyStorage {
  private readonly knowledge: WorkerKnowledgeStorage;
  constructor(private readonly config: WorkerStorageConfig) {
    if (config.mode !== 'local' || config.baseUrl !== 'http://127.0.0.1:54321' || !config.key)
      throw new Error('PRIVACY_STORAGE_UNAVAILABLE');
    this.knowledge = new WorkerKnowledgeStorage(config);
  }
  private headers() {
    return { apikey: this.config.key ?? '', Authorization: `Bearer ${this.config.key ?? ''}` };
  }
  private async mutate(url: string, request: RequestInit, allowMissing = false) {
    try {
      const response = await fetch(url, {
        ...request,
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      if (!response.ok && !(allowMissing && response.status === 404)) throw new Error();
    } catch {
      throw new Error('PRIVACY_STORAGE_UNAVAILABLE');
    }
  }
  readOriginal(path: string, organizationId: string, brandId: string) {
    return this.knowledge.read(path, organizationId, brandId);
  }
  async writeExport(path: string, bytes: Uint8Array) {
    if (
      !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.json\.gz$/.test(path) ||
      bytes.length > MAX_EXPORT_BYTES
    )
      throw new Error('PRIVACY_STORAGE_UNAVAILABLE');
    await this.mutate(`${this.config.baseUrl}/storage/v1/object/privacy-exports/${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/gzip', 'x-upsert': 'true' },
      body: Buffer.from(bytes),
    });
  }
  async remove(bucket: 'privacy-exports' | 'knowledge-private', path: string) {
    // Exact names returned by Storage metadata, never caller-controlled prefixes.
    if (
      !['privacy-exports', 'knowledge-private'].includes(bucket) ||
      path.length > 500 ||
      !/^[a-f0-9-]{36}\//.test(path) ||
      path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('PRIVACY_STORAGE_UNAVAILABLE');
    await this.mutate(
      `${this.config.baseUrl}/storage/v1/object/${bucket}`,
      {
        method: 'DELETE',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      },
      true,
    );
  }
}

/** A repeatable-read snapshot, paged by allowlisted identifiers; never an unbounded aggregate. */
export async function buildOrganizationExport(
  sql: Sql,
  claim: PrivacyClaim,
  storage: PrivacyStorage,
) {
  const pieces: string[] = [];
  let bytes = 0,
    count = 0;
  const append = (piece: string) => {
    bytes += Buffer.byteLength(piece);
    if (bytes > MAX_EXPORT_BYTES) throw new Error('EXPORT_TOO_LARGE');
    pieces.push(piece);
  };
  let originals: z.infer<typeof exportSourceSchema>[] = [];
  await sql.begin('isolation level repeatable read', async (tx) => {
    await tx`set local statement_timeout='15s'`;
    const [active] =
      await tx`select id from public.organizations where id=${claim.organization_id} and status='active' and deleted_at is null for update`;
    const [current] =
      await tx`select id from public.privacy_jobs where id=${claim.id} and status='processing' and lease_token=${claim.lease_token} and lease_expires_at>now()`;
    if (!active || !current) throw new Error('PRIVACY_LEASE_LOST');
    append(
      JSON.stringify({
        format: 'threadsignal-organization-export',
        version: 1,
        organizationId: claim.organization_id,
        generatedAt: new Date().toISOString(),
        note: 'Credentials, vectors and shared provider post bodies are excluded. Uploaded originals are base64 encoded.',
      }).slice(0, -1),
    );
    for (const [table, key, columns] of EXPORT_SECTIONS) {
      append(`,${JSON.stringify(table)}:[`);
      let offset = 0,
        first = true;
      for (;;) {
        const rows =
          await tx`select ${tx(columns.split(','))} from ${tx(`public.${table}`)} where ${tx(table === 'organizations' ? 'id' : 'organization_id')}=${claim.organization_id} order by ${tx(key)} limit 100 offset ${offset}`;
        for (const row of rows) {
          if (++count > MAX_EXPORT_ROWS) throw new Error('EXPORT_TOO_LARGE');
          append(`${first ? '' : ','}${JSON.stringify(row)}`);
          first = false;
        }
        if (rows.length < 100) break;
        offset += 100;
      }
      append(']');
    }
    originals = z
      .array(exportSourceSchema)
      .parse(
        await tx`select id,brand_id,filename,storage_path from public.knowledge_sources where organization_id=${claim.organization_id} and type='file' and deleted_at is null order by id limit 1001`,
      );
    if (originals.length > 1000) throw new Error('EXPORT_TOO_LARGE');
  });
  append(',"original_files":[');
  for (const [index, source] of originals.entries()) {
    const original = await storage.readOriginal(
      source.storage_path,
      claim.organization_id,
      source.brand_id,
    );
    append(
      `${index ? ',' : ''}${JSON.stringify({ source_id: source.id, filename: source.filename, encoding: 'base64', content: Buffer.from(original).toString('base64') })}`,
    );
  }
  append(']}');
  const compressed = await compress(Buffer.from(pieces.join('')), { level: 6 });
  if (compressed.length > MAX_EXPORT_BYTES) throw new Error('EXPORT_TOO_LARGE');
  return compressed;
}

export async function processPrivacyJob(sql: Sql, id: string, storage: PrivacyStorage) {
  z.uuid().parse(id);
  const token = randomUUID();
  const [row] = await sql`select private.claim_privacy_job(${id}::uuid,${token}::uuid) as value`;
  if (!row?.value) return { processed: false };
  const claim = claimSchema.parse(row.value);
  const renewal = setInterval(() => {
    void sql`update public.privacy_jobs set lease_expires_at=now()+interval '120 seconds' where id=${id} and status='processing' and lease_token=${token} and lease_expires_at>now()`.catch(
      () => undefined,
    );
  }, 20_000);
  renewal.unref();
  try {
    if (claim.kind === 'export') {
      const bytes = await buildOrganizationExport(sql, claim, storage);
      const path = `${claim.organization_id}/${claim.id}/${token}.json.gz`;
      const completed = await sql.begin(async (tx) => {
        // Storage is outside PostgreSQL. Holding the organization lock across upload prevents
        // deletion/purge from finishing before an admitted export upload has committed.
        const [active] =
          await tx`select id from public.organizations where id=${claim.organization_id} and status='active' and deleted_at is null for update`;
        const [current] =
          await tx`select id from public.privacy_jobs where id=${id} and status='processing' and lease_token=${token} and lease_expires_at>now() for update`;
        if (!active || !current) return false;
        await storage.writeExport(path, bytes);
        const [result] =
          await tx`select private.finish_privacy_export(${id}::uuid,${token}::uuid,${bytes.length},${createHash('sha256').update(bytes).digest('hex')}) as value`;
        return result?.value === true;
      });
      if (!completed) {
        await storage.remove('privacy-exports', path);
        return { processed: false };
      }
      return { processed: true, kind: claim.kind };
    }
    // No Storage SQL DELETE: object bytes and metadata are deleted together by Supabase's API.
    // Confirmed deletion has already stopped every tenant writer and revoked all access.
    const cleanupStarted = Date.now();
    let cleanupYielded = false;
    let previousFirstObject: string | undefined;
    for (let batch = 0; batch < 20; batch++) {
      const objects = z
        .array(storageObjectSchema)
        .parse(
          await sql`select bucket_id,name from storage.objects where bucket_id in ('knowledge-private','privacy-exports') and split_part(name,'/',1)=${claim.organization_id} order by bucket_id,name limit 25`,
        );
      if (!objects.length) {
        const [result] =
          await sql`select private.finish_organization_deletion(${id}::uuid,${token}::uuid) as value`;
        return { processed: result?.value === true, kind: claim.kind };
      }
      const firstObject = `${objects[0]?.bucket_id}/${objects[0]?.name}`;
      if (previousFirstObject === firstObject) throw new Error('PRIVACY_STORAGE_UNAVAILABLE');
      previousFirstObject = firstObject;
      for (const object of objects) {
        if (Date.now() - cleanupStarted >= 60_000) {
          cleanupYielded = true;
          break;
        }
        await storage.remove(object.bucket_id, object.name);
      }
      if (cleanupYielded) break;
    }
    // More than 500 objects is progress, not a provider failure; resume a fresh bounded batch.
    await sql`update public.privacy_jobs set status='queued',attempts=0,available_at=now(),lease_token=null,lease_expires_at=null where id=${id} and lease_token=${token} and status='processing'`;
    return { processed: false, continued: true };
  } catch (error) {
    const code =
      error instanceof Error && error.message === 'EXPORT_TOO_LARGE'
        ? 'EXPORT_TOO_LARGE'
        : 'PRIVACY_OPERATION_FAILED';
    await sql`select private.fail_privacy_job(${id}::uuid,${token}::uuid,${code})`;
    return { processed: false, retry: true };
  } finally {
    clearInterval(renewal);
  }
}

/** Bounded sweeps; policy denial is immediate even when physical cleanup is retrying. */
export async function maintainPrivacy(sql: Sql, storage: PrivacyStorage) {
  await sql`select private.maintain_platform_operations(100)`;
  await sql`update public.organization_data_requests set status='expired' where id in (select id from public.organization_data_requests where kind='export' and status='completed' and expires_at<=now() limit 100)`;
  const objects = z.array(storageObjectSchema).parse(
    await sql`select s.bucket_id,s.name from storage.objects s where
    (s.bucket_id='privacy-exports' and not exists(select 1 from public.organization_data_requests r where r.organization_id::text || '/' || r.artifact_path=s.name and r.status='completed' and r.expires_at>now())
      and (s.created_at<now()-interval '1 hour' or exists(select 1 from public.organization_data_requests r where r.organization_id::text || '/' || r.artifact_path=s.name and r.status in ('expired','revoked','failed','canceled')))
      and not exists(select 1 from public.privacy_jobs j where s.name=j.organization_id::text || '/' || j.id::text || '/' || j.lease_token::text || '.json.gz' and j.status='processing' and j.lease_expires_at>now()))
    or (s.bucket_id='knowledge-private' and s.created_at<now()-interval '24 hours' and not exists(select 1 from public.knowledge_sources k where k.storage_path=s.name))
    order by s.created_at,s.id limit 25`,
  );
  for (const object of objects) await storage.remove(object.bucket_id, object.name);
  await sql`delete from private.privacy_deletion_receipts where request_id in (select request_id from private.privacy_deletion_receipts where completed_at<now()-interval '30 days' order by completed_at limit 100)`;
  await sql`delete from public.notification_deliveries where id in (select id from public.notification_deliveries where status in ('sent','suppressed','failed') and updated_at<now()-interval '30 days' order by updated_at limit 100)`;
  await sql`delete from public.audit_logs where id in (select id from public.audit_logs where created_at<now()-interval '180 days' order by created_at limit 100)`;
  await sql.begin(async (tx) => {
    // Click deletion also mutates the analytics cache. Keep the same organization-first
    // lock order as attribution, aggregation and tenant deletion; skip busy tenants.
    const organizations =
      await tx`select o.id from public.organizations o where exists(select 1 from public.tracking_clicks c where c.organization_id=o.id and c.occurred_at<now()-interval '400 days') order by o.id limit 100 for update of o skip locked`;
    if (organizations.length) {
      const ids = organizations.map((row) => z.uuid().parse(row.id));
      await tx`delete from public.tracking_clicks where id in (select id from public.tracking_clicks where organization_id in ${tx(ids)} and occurred_at<now()-interval '400 days' order by occurred_at limit 100)`;
    }
  });
  return { objectsRemoved: objects.length };
}

export async function startPrivacyWorker(sql: Sql, config: WorkerConfig) {
  if (config.mode !== 'local') throw new Error('Verified local Supabase runtime required.');
  const logger = createLogger({ service: 'privacy-worker', level: config.logLevel });
  const observability = createObservability({});
  const storage = new LocalPrivacyStorage(config.storage);
  const connection = { ...config.redis, maxRetriesPerRequest: null, connectTimeout: 2000 };
  const queue = new Queue('privacy', {
    connection,
    prefix: config.queuePrefix,
    defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
  });
  let lastDispatch: number | null = null,
    dispatching = false,
    stopped = false;
  const worker = new Worker(
    'privacy',
    async (job) => {
      if (job.name !== 'process') throw new Error('Invalid privacy job.');
      const payload = z.object({ id: z.uuid() }).strict().parse(job.data);
      return observability.run('worker.privacy', { jobId: job.id ?? 'unassigned' }, async () => {
        const result = await processPrivacyJob(sql, payload.id, storage);
        logger.info(
          { event: 'privacy_processed', jobId: job.id, ...result },
          'Privacy operation completed.',
        );
        return result;
      });
    },
    { connection, prefix: config.queuePrefix, concurrency: 1 },
  );
  const failed = () => {
    lastDispatch = null;
    logger.warn({ event: 'privacy_queue_error' }, 'Privacy queue unavailable.');
  };
  queue.on('error', failed);
  worker.on('error', failed);
  worker.on('failed', failed);
  const dispatch = async () => {
    if (dispatching || stopped) return;
    dispatching = true;
    try {
      await maintainPrivacy(sql, storage);
      const rows = z
        .array(z.object({ id: z.uuid(), attempts: z.number().int() }))
        .parse(
          await sql`select id,attempts from public.privacy_jobs where (status='queued' and available_at<=now()) or (status='processing' and lease_expires_at<=now()) order by available_at,id limit 25`,
        );
      for (const row of rows)
        await queue.add('process', { id: row.id }, { jobId: `${row.id}-${row.attempts}` });
      lastDispatch = Date.now();
    } finally {
      dispatching = false;
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = async (force = false) => {
    stopped = true;
    if (timer) clearInterval(timer);
    await worker.close(force);
    await queue.close();
  };
  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    await dispatch();
    timer = setInterval(() => {
      void dispatch().catch(failed);
    }, 10_000);
    return {
      stop,
      isReady: () =>
        !stopped &&
        worker.isRunning() &&
        lastDispatch !== null &&
        Date.now() - lastDispatch <= 30_000,
    };
  } catch (error) {
    await stop(true);
    throw error;
  }
}
