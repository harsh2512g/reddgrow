import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createAIProvider, providerEmbeddingIdentity, type AIProvider } from '@threadsignal/ai';
import { demoBrand } from '@threadsignal/knowledge';
import { extractManualText, prepareDocuments } from '@threadsignal/knowledge/pipeline';
import { fixturePages, createCrawlerProvider } from '@threadsignal/crawler';
import {
  claimKnowledgeJob,
  processKnowledgeJob,
  publishKnowledge,
} from '../../apps/worker/src/jobs/knowledge';
import { LocalKnowledgeStorage } from '../../apps/worker/src/storage';
import { parseWorkerConfig } from '../../apps/worker/src/config';
import { createWorkerAI } from '../../apps/worker/src/providers';
import { localDatabaseUrl, verifyDocker, supabase } from '../../scripts/service-utils.mjs';
import { parseWorkerStorageKey } from '../../scripts/worker-storage.mjs';

/** Direct lease tests require the normal dev worker to be stopped, as documented for integration. */
describe('Phase 2 durable ingestion worker', () => {
  let sql: ReturnType<typeof postgres>;
  let organization: string;
  let brand: string;
  const user = randomUUID();
  let storage: LocalKnowledgeStorage;
  let storageKey: string;
  async function source(
    type = 'website',
    options: { pages?: string[]; storagePath?: string; filename?: string; mimeType?: string } = {},
  ) {
    const id = randomUUID();
    const jobId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,selected_pages,manual_text,storage_path,filename,mime_type)
        values(${id},${organization},${brand},'Worker fixture',${type},${options.pages ?? fixturePages.map((page) => page.url)},${type === 'manual' ? 'Private image storage is available for asynchronous batch image processing.' : null},${options.storagePath ?? null},${options.filename ?? null},${options.mimeType ?? null})`;
      await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${jobId},${organization},${brand},${id},1,'ingest')`;
    });
    return { id, jobId };
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 5, connect_timeout: 5, onnotice: () => {} });
    storageKey = parseWorkerStorageKey(supabase(['status', '--output', 'json']).stdout);
    storage = new LocalKnowledgeStorage(storageKey);
    await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${user},${`${user}@worker.example`},now(),'{}')`;
    organization = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${user},true)`;
      await tx`set local role authenticated`;
      const rows =
        await tx`select public.create_organization('Worker tests',${`worker-${user.slice(0, 8)}`},${`${user}@worker.example`}) as id`;
      return String(rows[0]?.id);
    });
    brand = randomUUID();
    await sql`insert into public.brands(id,organization_id,name,website_url,profile) values(${brand},${organization},'Worker test brand','https://clarityscale.example',${sql.json(demoBrand)})`;
  });
  beforeEach(async () => {
    await sql`delete from public.knowledge_sources where brand_id=${brand}`;
  });
  afterAll(async () => {
    if (sql) {
      if (organization) await sql`delete from public.organizations where id=${organization}`;
      await sql`delete from auth.users where id=${user}`;
      await sql.end({ timeout: 3 });
    }
  });
  it('ingests six fixture pages into searchable vectors with source provenance', async () => {
    const fixture = await source();
    expect(await processKnowledgeJob(sql, fixture.jobId, storage)).toEqual({ status: 'completed' });
    const [row] =
      await sql`select status,page_count,chunk_count from public.knowledge_sources where id=${fixture.id}`;
    expect(row?.status).toBe('ready');
    expect(row?.page_count).toBe(6);
    expect(row?.chunk_count).toBeGreaterThanOrEqual(6);
    const [embedding] = await createAIProvider().embed({
      texts: ['private storage retention security'],
      dimensions: 512,
    });
    const results =
      await sql`select d.canonical_url,c.section_heading from public.knowledge_chunks c join public.knowledge_documents d on d.id=c.document_id where c.source_id=${fixture.id} order by c.embedding operator(extensions.<=>) ${JSON.stringify(embedding)}::extensions.vector limit 1`;
    expect(results[0]?.canonical_url).toBe('https://clarityscale.example/security');
    expect(results[0]?.section_heading).toBeTruthy();
  });
  it('allows only one claim during concurrent duplicate delivery and rejects forged leases', async () => {
    const fixture = await source('manual');
    const claims = await Promise.all([
      claimKnowledgeJob(sql, fixture.jobId),
      claimKnowledgeJob(sql, fixture.jobId),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const job = claims.find(Boolean)!;
    const documents = await prepareDocuments(
      extractManualText('Verified image limits for the API.', 'Limits'),
      createAIProvider(),
    );
    expect(
      await publishKnowledge(sql, { ...job, lease_token: randomUUID() }, documents, false),
    ).toBe(false);
    expect(await publishKnowledge(sql, job, documents, false)).toBe(true);
    expect(await processKnowledgeJob(sql, fixture.jobId, storage)).toEqual({ status: 'skipped' });
  });
  it('recovers an expired lease and never re-embeds or replaces unchanged chunks on recrawl', async () => {
    const fixture = await source();
    expect(await claimKnowledgeJob(sql, fixture.jobId)).not.toBeNull();
    await sql`update public.knowledge_jobs set lease_expires_at=now()-interval '1 second' where id=${fixture.jobId}`;
    expect(await processKnowledgeJob(sql, fixture.jobId, storage)).toEqual({ status: 'completed' });
    const first =
      await sql`select id,checksum,embedding::text as embedding from public.knowledge_chunks where source_id=${fixture.id} order by id`;
    const secondJob = randomUUID();
    await sql.begin(async (tx) => {
      await tx`update public.knowledge_sources set generation=2,status='pending' where id=${fixture.id}`;
      await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${secondJob},${organization},${brand},${fixture.id},2,'ingest')`;
    });
    expect(await processKnowledgeJob(sql, secondJob, storage)).toEqual({ status: 'completed' });
    expect(
      await sql`select id,checksum,embedding::text as embedding from public.knowledge_chunks where source_id=${fixture.id} order by id`,
    ).toEqual(first);
  });
  it('fences stale content after a deletion and removes the durable tombstone', async () => {
    const fixture = await source('manual');
    const job = (await claimKnowledgeJob(sql, fixture.jobId))!;
    const deletedJob = randomUUID();
    await sql.begin(async (tx) => {
      await tx`update public.knowledge_sources set generation=2,status='deleting',deleted_at=now(),manual_text=null where id=${fixture.id}`;
      await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${deletedJob},${organization},${brand},${fixture.id},2,'delete')`;
    });
    const documents = await prepareDocuments(
      extractManualText('Old content must never reappear after deletion.', 'Old content'),
      createAIProvider(),
    );
    expect(await publishKnowledge(sql, job, documents, false)).toBe(false);
    expect(await processKnowledgeJob(sql, deletedJob, storage)).toEqual({ status: 'deleted' });
    expect(await sql`select id from public.knowledge_sources where id=${fixture.id}`).toHaveLength(
      0,
    );
    expect(
      await sql`select id from public.knowledge_chunks where source_id=${fixture.id}`,
    ).toHaveLength(0);
  });
  it('re-embeds unchanged content after a model change and never searches across vector spaces', async () => {
    const fixture = await source('manual');
    expect(await processKnowledgeJob(sql, fixture.jobId, storage)).toEqual({ status: 'completed' });
    const first = await sql`select id from public.knowledge_chunks where source_id=${fixture.id}`;
    const base = createAIProvider();
    const embed = vi.fn(base.embed.bind(base));
    const identity = 'openai:synthetic-model-v2:512:v1';
    const ai: AIProvider = {
      mode: 'openai',
      embeddingIdentity: identity,
      embed,
      generateStructured: base.generateStructured.bind(base),
    };
    const providers = { ai, crawler: createCrawlerProvider(), embeddingIdentity: identity };
    async function reingest(generation: number) {
      const jobId = randomUUID();
      await sql`update public.knowledge_sources set generation=${generation},status='pending' where id=${fixture.id}`;
      await sql`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${jobId},${organization},${brand},${fixture.id},${generation},'ingest')`;
      expect(await processKnowledgeJob(sql, jobId, storage, providers)).toEqual({
        status: 'completed',
      });
    }
    await reingest(2);
    expect(embed).toHaveBeenCalledOnce();
    const second =
      await sql`select id,embedding_identity from public.knowledge_chunks where source_id=${fixture.id}`;
    expect(second).not.toEqual(first);
    expect(second.every((chunk) => chunk.embedding_identity === identity)).toBe(true);
    expect(first.some((chunk) => second.some((next) => next.id === chunk.id))).toBe(false);
    await reingest(3);
    expect(embed).toHaveBeenCalledOnce();
    expect(
      await sql`select id,embedding_identity from public.knowledge_chunks where source_id=${fixture.id}`,
    ).toEqual(second);
    const vector = JSON.stringify(
      (await base.embed({ texts: ['private storage'], dimensions: 512 }))[0],
    );
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${user},true)`;
      await tx`set local role authenticated`;
      expect(
        await tx`select * from public.search_knowledge(${brand},${vector}::extensions.vector,'private storage')`,
      ).toHaveLength(0);
      expect(
        await tx`select * from public.search_knowledge(${brand},${vector}::extensions.vector,'private storage',${identity})`,
      ).toHaveLength(second.length);
      expect(
        await tx`select * from public.search_knowledge(${brand},${vector}::extensions.vector,'private storage','openai:different-model:512:v1')`,
      ).toHaveLength(0);
    });
  });
  it('records three bounded failed attempts and safe retry codes', async () => {
    const fixture = await source('website', { pages: ['https://clarityscale.example/unknown'] });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await processKnowledgeJob(sql, fixture.jobId, storage);
      const [row] =
        await sql`select status,attempts,error_code from public.knowledge_jobs where id=${fixture.jobId}`;
      expect(row?.attempts).toBe(attempt);
      expect(row?.status).toBe(attempt === 3 ? 'failed' : 'queued');
      expect(row?.error_code).toBe('CRAWL_FAILED');
      await sql`update public.knowledge_jobs set available_at=now()-interval '1 second' where id=${fixture.jobId}`;
    }
    expect(await processKnowledgeJob(sql, fixture.jobId, storage)).toEqual({ status: 'skipped' });
  });
  it('persists actual embedding tokens from failed attempts without charging a duplicate delivery twice', async () => {
    const fixture = await source('manual');
    const config = parseWorkerConfig({
      DATABASE_URL: 'postgresql://postgres:synthetic-password@127.0.0.1:54322/postgres',
    });
    // Synthetic adapter transport only: no deployment connection or external request.
    config.mode = 'deployment';
    config.providers = {
      ai: {
        mode: 'openai',
        options: {
          apiKey: 'synthetic-test-key',
          fastModel: 'synthetic-fast',
          smartModel: 'synthetic-smart',
          embeddingModel: 'failed-embedding-fixture',
          maxRetries: 0,
          transport: async () =>
            Response.json({ data: [], usage: { prompt_tokens: 23, total_tokens: 23 } }),
        },
      },
      reddit: { mode: 'mock' },
      email: { mode: 'console' },
      crawler: 'fixture',
    };
    const ai = createWorkerAI(config);
    const providers = {
      ai,
      crawler: createCrawlerProvider(),
      embeddingIdentity: providerEmbeddingIdentity(ai),
    };
    expect(await processKnowledgeJob(sql, fixture.jobId, storage, providers)).toEqual({
      status: 'retry_or_failed',
    });
    expect(await processKnowledgeJob(sql, fixture.jobId, storage, providers)).toEqual({
      status: 'skipped',
    });
    const first =
      await sql`select operation_id,input_tokens,output_tokens,estimated_cost_usd from public.ai_task_usage where brand_id=${brand} and task='knowledge.embed' and model='failed-embedding-fixture'`;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      input_tokens: 23,
      output_tokens: 0,
      estimated_cost_usd: null,
    });
    await sql`update public.knowledge_jobs set available_at=now()-interval '1 second' where id=${fixture.jobId}`;
    expect(await processKnowledgeJob(sql, fixture.jobId, storage, providers)).toEqual({
      status: 'retry_or_failed',
    });
    const retried =
      await sql`select operation_id from public.ai_task_usage where brand_id=${brand} and task='knowledge.embed' and model='failed-embedding-fixture'`;
    expect(retried).toHaveLength(2);
    expect(new Set(retried.map((row) => row.operation_id)).size).toBe(2);
  });
  it('marks an exhausted abandoned lease as failed rather than leaving permanent processing', async () => {
    const fixture = await source('manual');
    await claimKnowledgeJob(sql, fixture.jobId);
    await sql`update public.knowledge_jobs set attempts=3,lease_expires_at=now()-interval '1 second' where id=${fixture.jobId}`;
    expect(await claimKnowledgeJob(sql, fixture.jobId)).toBeNull();
    expect(
      (await sql`select status,error_code from public.knowledge_sources where id=${fixture.id}`)[0],
    ).toMatchObject({ status: 'failed', error_code: 'LEASE_EXPIRED' });
  });
  it('reads an original from private Storage, extracts it, and removes it on deletion', async () => {
    const id = randomUUID();
    const path = `${organization}/${brand}/${id}/private-notes.txt`;
    const response = await fetch(
      `http://127.0.0.1:54321/storage/v1/object/knowledge-private/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: storageKey,
          Authorization: `Bearer ${storageKey}`,
          'Content-Type': 'text/plain',
        },
        body: 'Private images expire after twenty-four hours. Batch API processing is supported.',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      },
    );
    expect(response.ok).toBe(true);
    await response.body?.cancel();
    try {
      const fixture = await source('file', {
        storagePath: path,
        filename: 'private-notes.txt',
        mimeType: 'text/plain',
      });
      expect(await processKnowledgeJob(sql, fixture.jobId, storage)).toEqual({
        status: 'completed',
      });
      expect(
        (await sql`select content from public.knowledge_documents where source_id=${fixture.id}`)[0]
          ?.content,
      ).toContain('twenty-four hours');
      const deletion = randomUUID();
      await sql.begin(async (tx) => {
        await tx`update public.knowledge_sources set generation=2,status='deleting',deleted_at=now() where id=${fixture.id}`;
        await tx`delete from public.knowledge_documents where source_id=${fixture.id}`;
        await tx`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${deletion},${organization},${brand},${fixture.id},2,'delete')`;
      });
      expect(await processKnowledgeJob(sql, deletion, storage)).toEqual({ status: 'deleted' });
      await expect(storage.read(path, organization, brand)).rejects.toThrow('storage_unavailable');
    } finally {
      await storage.remove(path, organization, brand);
    }
  });
});
