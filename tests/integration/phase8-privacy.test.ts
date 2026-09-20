import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoBrand } from '@threadsignal/knowledge';
import { createAIProvider } from '@threadsignal/ai';
import { extractManualText, prepareDocuments } from '@threadsignal/knowledge/pipeline';
import { localDatabaseUrl, supabase, verifyDocker } from '../../scripts/service-utils.mjs';
import { parseWorkerStorageKey } from '../../scripts/worker-storage.mjs';
import { claimKnowledgeJob, publishKnowledge } from '../../apps/worker/src/jobs/knowledge';
import {
  EXPORT_SECTIONS,
  LocalPrivacyStorage,
  maintainPrivacy,
  processPrivacyJob,
  type PrivacyStorage,
} from '../../apps/worker/src/jobs/privacy';

const users = {
  owner: randomUUID(),
  admin: randomUUID(),
  member: randomUUID(),
  other: randomUUID(),
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Phase 8 confirmed privacy lifecycle and Supabase private artifacts', () => {
  let sql: postgres.Sql, storage: LocalPrivacyStorage, storageKey: string;
  let organization: string, otherOrganization: string, brand: string, slug: string;
  const organizations: string[] = [],
    communities: string[] = [];
  async function asUser<T>(user: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: user, role: 'authenticated' })},true)`;
      await tx`set local role authenticated`;
      return operation(tx);
    });
  }
  async function beginExport(user = users.owner, org = organization) {
    const [row] = await asUser(
      user,
      (tx) => tx`select public.begin_organization_export(${org}) as id`,
    );
    return String(row?.id);
  }
  async function confirmDeletion(confirmation = slug) {
    const [row] = await asUser(
      users.owner,
      (tx) =>
        tx`select public.confirm_organization_deletion(${organization},${confirmation}) as id`,
    );
    return String(row?.id);
  }
  async function createOrganization(user: string) {
    const nextSlug = `privacy-${randomUUID()}`;
    const [row] = await asUser(
      user,
      (tx) =>
        tx`select public.create_organization('Privacy fixture',${nextSlug},${`${user}@privacy.example`}) as id`,
    );
    const id = String(row?.id);
    organizations.push(id);
    return { id, slug: nextSlug };
  }
  async function original() {
    const id = randomUUID(),
      path = `${organization}/${brand}/${id}/original.txt`;
    const bytes = Buffer.from(
      'Private original file contents for export and deletion verification.',
    );
    const response = await fetch(
      `http://127.0.0.1:54321/storage/v1/object/knowledge-private/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: storageKey,
          Authorization: `Bearer ${storageKey}`,
          'Content-Type': 'text/plain',
        },
        body: bytes,
      },
    );
    expect(response.ok).toBe(true);
    await response.body?.cancel();
    await sql`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,filename,mime_type,storage_path)
      values(${id},${organization},${brand},'Original export fixture','file','original.txt','text/plain',${path})`;
    return { id, path, bytes };
  }
  async function artifact(id: string) {
    const [row] = await asUser(
      users.owner,
      (tx) => tx`select public.get_organization_export(${id}) as value`,
    );
    const value = row?.value as { path: string; bytes: number; sha256: string };
    const response = await fetch(
      `http://127.0.0.1:54321/storage/v1/object/authenticated/privacy-exports/${value.path}`,
      {
        headers: { apikey: storageKey, Authorization: `Bearer ${storageKey}` },
      },
    );
    expect(response.ok).toBe(true);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.length).toBe(value.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(value.sha256);
    return {
      path: value.path,
      document: JSON.parse(gunzipSync(bytes).toString('utf8')) as Record<string, unknown>,
    };
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => undefined });
    storageKey = parseWorkerStorageKey(supabase(['status', '--output', 'json']).stdout);
    storage = new LocalPrivacyStorage({
      mode: 'local',
      baseUrl: 'http://127.0.0.1:54321',
      key: storageKey,
    });
    for (const user of Object.values(users))
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${user},${`${user}@privacy.example`},now(),'{}')`;
    otherOrganization = (await createOrganization(users.other)).id;
  });
  beforeEach(async () => {
    const created = await createOrganization(users.owner);
    organization = created.id;
    slug = created.slug;
    brand = randomUUID();
    await sql`insert into public.brands(id,organization_id,name,website_url,profile) values(${brand},${organization},'Privacy brand','https://clarityscale.example',${sql.json(demoBrand)})`;
    for (const role of ['admin', 'member'] as const)
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${organization},${users[role]},${role})`;
  });
  afterEach(async () => {
    for (const row of await sql`select bucket_id,name from storage.objects where bucket_id in ('knowledge-private','privacy-exports') and split_part(name,'/',1)=${organization}`)
      await storage.remove(
        row.bucket_id as 'knowledge-private' | 'privacy-exports',
        String(row.name),
      );
    await sql`delete from public.organizations where id=${organization}`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from public.organizations where id in ${sql(organizations)}`;
    await sql`delete from private.privacy_deletion_receipts where organization_id in ${sql(organizations)}`;
    if (communities.length)
      await sql`delete from public.subreddits where id in ${sql(communities)}`;
    await sql`delete from auth.users where id in ${sql(Object.values(users))}`;
    await sql.end({ timeout: 5 });
  });

  it('does not execute historical deletion requests without fresh exact-slug confirmation', async () => {
    const [row] = await asUser(
      users.owner,
      (tx) => tx`select public.request_organization_data(${organization},'delete') as id`,
    );
    expect(await processPrivacyJob(sql, String(row?.id), storage)).toEqual({ processed: false });
    expect(await sql`select id from public.privacy_jobs where id=${row?.id}`).toHaveLength(0);
    await expect(confirmDeletion('wrong-workspace')).rejects.toThrow('CONFIRMATION_REQUIRED');
    const [org] =
      await sql`select status,deleted_at from public.organizations where id=${organization}`;
    expect(org).toMatchObject({ status: 'active', deleted_at: null });
    expect(await confirmDeletion()).toBe(row?.id);
    const [confirmed] =
      await sql`select confirmed_at from public.organization_data_requests where id=${row?.id}`;
    expect(confirmed?.confirmed_at).toBeInstanceOf(Date);
  });
  it('owner-only APIs and restricted Storage deny admins, members, anonymous and other tenants', async () => {
    for (const user of [users.admin, users.member, users.other]) {
      await expect(beginExport(user)).rejects.toThrow('FORBIDDEN');
      await expect(
        asUser(
          user,
          (tx) => tx`select public.confirm_organization_deletion(${organization},${slug})`,
        ),
      ).rejects.toThrow('FORBIDDEN');
      await expect(
        asUser(user, (tx) => tx`select public.list_organization_data_requests(${organization})`),
      ).rejects.toThrow('FORBIDDEN');
    }
    const [rights] =
      await sql`select has_function_privilege('anon','public.begin_organization_export(uuid)','execute') as anonymous,
      has_function_privilege('authenticated','private.claim_privacy_job(uuid,uuid)','execute') as claim,
      has_column_privilege('authenticated','public.organization_data_requests','artifact_path','select') as path`;
    expect(rights).toEqual({ anonymous: false, claim: false, path: false });
    expect(
      EXPORT_SECTIONS.flatMap(([, , fields]) => fields.split(',')).filter(
        (field) =>
          /hash|token|password|secret|provider_customer|provider_subscription|provider_session|receipt|embedding/.test(
            field,
          ) && !['token_count', 'input_tokens', 'output_tokens'].includes(field),
      ),
    ).toEqual([]);
  });
  it('enforces export quotas even through legacy requests and exposes a boolean for legacy completion', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await beginExport();
      await asUser(users.owner, (tx) => tx`select public.revoke_organization_export(${id})`);
    }
    await expect(beginExport()).rejects.toThrow('EXPORT_RATE_LIMIT');
    const [legacy] = await asUser(
      users.owner,
      (tx) => tx`select public.request_organization_data(${organization},'export') as id`,
    );
    await expect(beginExport()).rejects.toThrow('EXPORT_RATE_LIMIT');
    await sql`update public.organization_data_requests set status='completed' where id=${legacy?.id}`;
    const [listed] = await asUser(
      users.owner,
      (tx) => tx`select public.list_organization_data_requests(${organization}) as value`,
    );
    expect(listed?.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: legacy?.id, download_available: false }),
      ]),
    );
  });
  it('does not publish a truncated export when the total original bytes exceed the bounded archive budget', async () => {
    for (let i = 0; i < 6; i++) {
      const source = randomUUID();
      await sql`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,filename,mime_type,storage_path)
        values(${source},${organization},${brand},'Large fixture','file','large.txt','text/plain',${`${organization}/${brand}/${source}/large.txt`})`;
    }
    const id = await beginExport(),
      write = vi.fn<PrivacyStorage['writeExport']>();
    const tenMb = new Uint8Array(10 * 1024 * 1024);
    const bounded: PrivacyStorage = {
      readOriginal: async () => tenMb,
      writeExport: write,
      remove: async () => undefined,
    };
    expect(await processPrivacyJob(sql, id, bounded)).toEqual({ processed: false, retry: true });
    expect(write).not.toHaveBeenCalled();
    const [request] =
      await sql`select status,error_code,artifact_path from public.organization_data_requests where id=${id}`;
    expect(request).toEqual({
      status: 'failed',
      error_code: 'EXPORT_TOO_LARGE',
      artifact_path: null,
    });
  });
  it('fences expired and forged export leases while recovering a lost worker claim', async () => {
    const id = await beginExport(),
      old = randomUUID(),
      fresh = randomUUID();
    const [first] = await sql`select private.claim_privacy_job(${id},${old}) as value`;
    expect(first?.value).toMatchObject({ attempts: 1 });
    const [duplicate] = await sql`select private.claim_privacy_job(${id},${fresh}) as value`;
    expect(duplicate?.value).toBeNull();
    await sql`update public.privacy_jobs set lease_expires_at=now()-interval '1 second' where id=${id}`;
    const [claimed] = await sql`select private.claim_privacy_job(${id},${fresh}) as value`;
    expect(claimed?.value).toMatchObject({ attempts: 2 });
    const [stale] =
      await sql`select private.finish_privacy_export(${id},${old},100,${hash('stale')}) as value`;
    expect(stale?.value).toBe(false);
    const [forged] =
      await sql`select private.finish_privacy_export(${id},${randomUUID()},100,${hash('forged')}) as value`;
    expect(forged?.value).toBe(false);
    const [state] = await sql`select status,lease_token from public.privacy_jobs where id=${id}`;
    expect(state).toEqual({ status: 'processing', lease_token: fresh });
  });
  it('writes a complete gzip artifact with originals in real private Supabase Storage and an owner-safe allowlist', async () => {
    const file = await original();
    await sql`insert into public.organization_invitations(organization_id,email,role,token_hash) values(${organization},'invite@privacy.example','member',${hash('never-export-invite-token')})`;
    await sql`insert into public.conversion_api_keys(organization_id,brand_id,name,key_prefix,key_hash) values(${organization},${brand},'Private key','tsk_abcdefgh',${hash('never-export-api-key')})`;
    const id = await beginExport();
    expect(await processPrivacyJob(sql, id, storage)).toEqual({ processed: true, kind: 'export' });
    const result = await artifact(id);
    expect(result.document.format).toBe('threadsignal-organization-export');
    expect(result.document.original_files).toEqual([
      {
        source_id: file.id,
        filename: 'original.txt',
        encoding: 'base64',
        content: file.bytes.toString('base64'),
      },
    ]);
    expect(JSON.stringify(result.document)).not.toContain(hash('never-export-api-key'));
    expect(JSON.stringify(result.document)).not.toContain(hash('never-export-invite-token'));
    expect(JSON.stringify(result.document)).not.toContain(otherOrganization);
    expect(
      await asUser(
        users.owner,
        (tx) =>
          tx`select name from storage.objects where bucket_id='privacy-exports' and name=${result.path}`,
      ),
    ).toHaveLength(1);
    for (const user of [users.admin, users.member, users.other])
      expect(
        await asUser(
          user,
          (tx) =>
            tx`select name from storage.objects where bucket_id='privacy-exports' and name=${result.path}`,
        ),
      ).toHaveLength(0);
    const anonymous = await fetch(
      `http://127.0.0.1:54321/storage/v1/object/public/privacy-exports/${result.path}`,
    );
    expect(anonymous.ok).toBe(false);
    await anonymous.body?.cancel();
  });
  it('deduplicates requests and concurrent delivery without duplicate export publication', async () => {
    const ids = await Promise.all([beginExport(), beginExport()]);
    expect(ids[0]).toBe(ids[1]);
    const write = vi.spyOn(storage, 'writeExport');
    try {
      const results = await Promise.all(ids.map((id) => processPrivacyJob(sql, id, storage)));
      expect(results.filter((result) => result.processed)).toHaveLength(1);
      expect(write).toHaveBeenCalledOnce();
    } finally {
      write.mockRestore();
    }
  });
  it('rechecks current ownership at artifact download and revokes access immediately', async () => {
    const id = await beginExport();
    await processPrivacyJob(sql, id, storage);
    const { path } = await artifact(id);
    await sql`update public.organization_members set role='admin' where organization_id=${organization} and user_id=${users.owner}`;
    await expect(
      asUser(users.owner, (tx) => tx`select public.get_organization_export(${id})`),
    ).rejects.toThrow('FORBIDDEN');
    expect(
      await asUser(
        users.owner,
        (tx) =>
          tx`select name from storage.objects where bucket_id='privacy-exports' and name=${path}`,
      ),
    ).toHaveLength(0);
    await sql`update public.organization_members set role='owner' where organization_id=${organization} and user_id=${users.owner}`;
    await asUser(users.owner, (tx) => tx`select public.revoke_organization_export(${id})`);
    await expect(
      asUser(users.owner, (tx) => tx`select public.get_organization_export(${id})`),
    ).rejects.toThrow('EXPORT_UNAVAILABLE');
    expect(
      await asUser(
        users.owner,
        (tx) =>
          tx`select name from storage.objects where bucket_id='privacy-exports' and name=${path}`,
      ),
    ).toHaveLength(0);
    await maintainPrivacy(sql, storage);
    expect(
      await sql`select id from storage.objects where bucket_id='privacy-exports' and name=${path}`,
    ).toHaveLength(0);
  });
  it('expires exports after 24 hours and physically cleans their artifacts', async () => {
    const id = await beginExport();
    await processPrivacyJob(sql, id, storage);
    const { path } = await artifact(id);
    await sql`update public.organization_data_requests set expires_at=now()-interval '1 second' where id=${id}`;
    const [row] = await asUser(
      users.owner,
      (tx) => tx`select public.list_organization_data_requests(${organization}) as value`,
    );
    expect(row?.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: 'expired', download_available: false }),
      ]),
    );
    await maintainPrivacy(sql, storage);
    expect(
      await sql`select id from storage.objects where name=${path} and bucket_id='privacy-exports'`,
    ).toHaveLength(0);
  });
  it('uses at most three attempts for Storage failure and never retains the provider error body', async () => {
    const id = await beginExport();
    const failing: PrivacyStorage = {
      readOriginal: (...args) => storage.readOriginal(...args),
      remove: (...args) => storage.remove(...args),
      writeExport: async () => {
        throw new Error('upstream private secret contents');
      },
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await processPrivacyJob(sql, id, failing)).toMatchObject({
        processed: false,
        retry: true,
      });
      const [job] =
        await sql`select status,attempts,error_code from public.privacy_jobs where id=${id}`;
      expect(job).toMatchObject({
        status: attempt === 3 ? 'failed' : 'queued',
        attempts: attempt,
        error_code: 'PRIVACY_OPERATION_FAILED',
      });
      await sql`update public.privacy_jobs set available_at=now() where id=${id}`;
    }
    expect(await processPrivacyJob(sql, id, failing)).toEqual({ processed: false });
    const [request] =
      await sql`select status,error_code from public.organization_data_requests where id=${id}`;
    expect(request).toEqual({ status: 'failed', error_code: 'PRIVACY_OPERATION_FAILED' });
  });
  it('invalidates an in-flight export revoked while original files are being read', async () => {
    await original();
    const id = await beginExport();
    const write = vi.fn<PrivacyStorage['writeExport']>();
    const revoking: PrivacyStorage = {
      remove: (...args) => storage.remove(...args),
      writeExport: write,
      readOriginal: async (...args) => {
        await asUser(users.owner, (tx) => tx`select public.revoke_organization_export(${id})`);
        return storage.readOriginal(...args);
      },
    };
    expect(await processPrivacyJob(sql, id, revoking)).toEqual({ processed: false });
    expect(write).not.toHaveBeenCalled();
  });
  it('deletion refuses an uncanceled real subscription rather than silently orphaning billing', async () => {
    await sql`update public.subscriptions set provider='stripe',status='active' where organization_id=${organization}`;
    await expect(confirmDeletion()).rejects.toThrow('BILLING_CANCELLATION_REQUIRED');
    expect(
      await sql`select id from public.organizations where id=${organization} and status='active'`,
    ).toHaveLength(1);
  });
  it('deletes originals and tenant rows, revokes keys, and preserves other tenants and shared Auth identities', async () => {
    const file = await original();
    const exported = await beginExport();
    await processPrivacyJob(sql, exported, storage);
    const key = randomUUID();
    await sql`insert into public.conversion_api_keys(id,organization_id,brand_id,name,key_prefix,key_hash) values(${key},${organization},${brand},'Revocation fixture','tsk_abcdefgh',${hash(randomUUID())})`;
    const id = await confirmDeletion();
    expect(
      await asUser(
        users.owner,
        (tx) => tx`select id from public.brands where organization_id=${organization}`,
      ),
    ).toHaveLength(0);
    const [revoked] = await sql`select revoked_at from public.conversion_api_keys where id=${key}`;
    expect(revoked?.revoked_at).toBeInstanceOf(Date);
    expect(await processPrivacyJob(sql, id, storage)).toEqual({ processed: true, kind: 'delete' });
    expect(await sql`select id from public.organizations where id=${organization}`).toHaveLength(0);
    expect(await sql`select id from public.brands where id=${brand}`).toHaveLength(0);
    expect(
      await sql`select id from storage.objects where name=${file.path} or split_part(name,'/',1)=${organization}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from public.organizations where id=${otherOrganization}`,
    ).toHaveLength(1);
    expect(await sql`select id from auth.users where id=${users.owner}`).toHaveLength(1);
    expect(
      await sql`select request_id from private.privacy_deletion_receipts where request_id=${id}`,
    ).toHaveLength(1);
    expect(await processPrivacyJob(sql, id, storage)).toEqual({ processed: false });
  });
  it('keeps the deleted tenant tombstone and retries if physical file deletion fails', async () => {
    await original();
    const id = await confirmDeletion();
    const failing: PrivacyStorage = {
      readOriginal: (...args) => storage.readOriginal(...args),
      writeExport: (...args) => storage.writeExport(...args),
      remove: async () => {
        throw new Error('unavailable');
      },
    };
    expect(await processPrivacyJob(sql, id, failing)).toMatchObject({
      processed: false,
      retry: true,
    });
    expect(
      await sql`select id from public.organizations where id=${organization} and status='deleted'`,
    ).toHaveLength(1);
    expect(
      await sql`select id from public.knowledge_sources where organization_id=${organization}`,
    ).toHaveLength(1);
    await sql`update public.privacy_jobs set available_at=now() where id=${id}`;
    expect(await processPrivacyJob(sql, id, storage)).toMatchObject({ processed: true });
  });
  it('does not let deletion finalize while any tenant Storage object remains', async () => {
    await original();
    const id = await confirmDeletion(),
      token = randomUUID();
    await sql`select private.claim_privacy_job(${id},${token})`;
    await expect(sql`select private.finish_organization_deletion(${id},${token})`).rejects.toThrow(
      'STORAGE_CLEANUP_PENDING',
    );
    expect(await sql`select id from public.organizations where id=${organization}`).toHaveLength(1);
  });
  it('treats a Storage delete that makes no progress as failure instead of retrying forever', async () => {
    await original();
    const id = await confirmDeletion();
    const noProgress: PrivacyStorage = {
      readOriginal: (...args) => storage.readOriginal(...args),
      writeExport: (...args) => storage.writeExport(...args),
      remove: async () => undefined,
    };
    expect(await processPrivacyJob(sql, id, noProgress)).toEqual({ processed: false, retry: true });
    const [job] =
      await sql`select status,attempts,error_code from public.privacy_jobs where id=${id}`;
    expect(job).toEqual({ status: 'queued', attempts: 1, error_code: 'PRIVACY_OPERATION_FAILED' });
    expect(await sql`select id from public.organizations where id=${organization}`).toHaveLength(1);
  });
  it('serializes admitted uploads with deletion and refuses new uploads after confirmation', async () => {
    const path = `${organization}/${brand}/${randomUUID()}/upload.txt`;
    let release: () => void = () => undefined,
      admitted: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const upload = asUser(users.owner, async (tx) => {
      const [row] =
        await tx`select private.knowledge_storage_access(${path},${users.owner},'insert') as allowed`;
      expect(row?.allowed).toBe(true);
      admitted();
      await gate;
    });
    await entered;
    let deleted = false;
    const deletion = confirmDeletion().then((id) => {
      deleted = true;
      return id;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(deleted).toBe(false);
    } finally {
      release();
    }
    await upload;
    await deletion;
    const [blocked] = await asUser(
      users.owner,
      (tx) =>
        tx`select private.knowledge_storage_access(${path},${users.owner},'insert') as allowed`,
    );
    expect(blocked?.allowed).toBe(false);
  });
  it('cleans only old uncommitted knowledge objects while preserving current and recently uploaded files', async () => {
    const old = await original(),
      recent = await original(),
      current = await original();
    await sql`delete from public.knowledge_sources where id in (${old.id},${recent.id})`;
    await sql`update storage.objects set created_at=now()-interval '25 hours' where bucket_id='knowledge-private' and name in (${old.path},${current.path})`;
    await maintainPrivacy(sql, storage);
    expect(
      await sql`select id from storage.objects where bucket_id='knowledge-private' and name=${old.path}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from storage.objects where bucket_id='knowledge-private' and name in (${recent.path},${current.path})`,
    ).toHaveLength(2);
  });
  it('fences knowledge publication and admission after organization suspension or deletion', async () => {
    const source = randomUUID(),
      job = randomUUID();
    await sql`insert into public.knowledge_sources(id,organization_id,brand_id,name,type,manual_text) values(${source},${organization},${brand},'Paused source','manual','Private documented fixture content.')`;
    await sql`insert into public.knowledge_jobs(id,organization_id,brand_id,source_id,generation,kind) values(${job},${organization},${brand},${source},1,'ingest')`;
    await sql`update public.organizations set status='suspended' where id=${organization}`;
    expect(await claimKnowledgeJob(sql, job)).toBeNull();
    await sql`update public.organizations set status='active' where id=${organization}`;
    const claim = await claimKnowledgeJob(sql, job);
    expect(claim).not.toBeNull();
    if (!claim) throw new Error('Missing fixture lease');
    const documents = await prepareDocuments(
      extractManualText('Documented private API content.', 'Fixture'),
      createAIProvider(),
    );
    await confirmDeletion();
    expect(await publishKnowledge(sql, claim, documents, false)).toBe(false);
    expect(
      await sql`select id from public.knowledge_documents where source_id=${source}`,
    ).toHaveLength(0);
  });
  it('purges all tenant exports containing derived content and cannot publish an old lease afterward', async () => {
    const subreddit = randomUUID(),
      post = randomUUID(),
      opportunity = randomUUID();
    communities.push(subreddit);
    await sql`insert into public.subreddits(id,provider,provider_id,name,display_name) values(${subreddit},'mock',${subreddit},${`privacy_${subreddit.slice(0, 8)}`},'Privacy fixture')`;
    await sql`insert into public.reddit_posts(id,provider,provider_post_id,subreddit_id,title,body,author_name,permalink,created_at_provider) values(${post},'mock',${post.replaceAll('-', '')},${subreddit},'Deleted title','Deleted body','fixture','https://www.reddit.com/r/SaaS/comments/fixture001/post/',now())`;
    await sql`insert into public.opportunities(id,organization_id,brand_id,reddit_post_id,subreddit_id,summary,user_need,intent_category,semantic_relevance,buying_intent,freshness,engagement_velocity,rule_fit,competitor_context,penalty_score,final_score,risk_level,suggested_action,reasoning_summary,input_checksum)
      values(${opportunity},${organization},${brand},${post},${subreddit},'Derived Reddit text','Derived user need','recommendation',90,90,90,90,90,90,0,90,'low','reply','Derived reasoning',${hash('privacy opportunity')})`;
    const id = await beginExport();
    await processPrivacyJob(sql, id, storage);
    const { path } = await artifact(id);
    const pending = await beginExport(),
      token = randomUUID();
    await sql`select private.claim_privacy_job(${pending},${token})`;
    await sql`select private.purge_reddit_post(${post})`;
    expect(
      await asUser(
        users.owner,
        (tx) =>
          tx`select name from storage.objects where bucket_id='privacy-exports' and name=${path}`,
      ),
    ).toHaveLength(0);
    const [finished] =
      await sql`select private.finish_privacy_export(${pending},${token},100,${hash('old artifact')}) as value`;
    expect(finished?.value).toBe(false);
    const [purged] =
      await sql`select title,body,author_name from public.reddit_posts where id=${post}`;
    expect(purged).toEqual({ title: null, body: null, author_name: null });
    const [derived] =
      await sql`select summary,user_need,reasoning_summary from public.opportunities where id=${opportunity}`;
    expect(derived).toEqual({ summary: '', user_need: '', reasoning_summary: '' });
    await maintainPrivacy(sql, storage);
    expect(await sql`select id from storage.objects where name=${path}`).toHaveLength(0);
  });
});
