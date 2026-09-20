import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  brandInputSchema,
  demoBrand,
  sourceInputSchema,
} from '../../packages/knowledge/src/schema.js';
import { localDatabaseUrl, verifyDocker } from '../../scripts/service-utils.mjs';

const users = {
  owner: randomUUID(),
  admin: randomUUID(),
  member: randomUUID(),
  viewer: randomUUID(),
  other: randomUUID(),
};
const run = randomUUID().slice(0, 8);
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const vector = JSON.stringify([1, ...Array.from({ length: 511 }, () => 0)]);
const manual = sourceInputSchema.parse({
  name: 'Verified product notes',
  type: 'manual',
  text: 'Batch image optimization is supported by the product API.',
});

describe('Phase 2 tenant knowledge PostgreSQL contracts', () => {
  let sql: ReturnType<typeof postgres>;
  let org: string;
  let otherOrg: string;
  async function asUser<T>(user: string, operation: (tx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${user},true),set_config('request.jwt.claims',${JSON.stringify({ sub: user, role: 'authenticated' })},true)`;
      await tx`set local role authenticated`;
      return operation(tx);
    });
  }
  async function brand(user = users.owner, organization = org) {
    const rows = await asUser(
      user,
      (tx) => tx`select public.save_brand(${organization},null,${tx.json(demoBrand)}) as id`,
    );
    return String(rows[0]?.id);
  }
  async function source(brandId: string, input = manual, user = users.owner, id = randomUUID()) {
    await asUser(user, async (tx) => {
      await tx`select public.add_knowledge_source(${brandId},${id},${tx.json(input)})`;
      // These SQL-contract fixtures are never dispatched to the live worker. The
      // delay is set inside the same transaction before the job becomes visible.
      await tx`set local role postgres`;
      await tx`update public.knowledge_jobs set available_at=now()+interval '1 day' where source_id=${id}`;
      return true;
    });
    return id;
  }
  async function document(brandId: string, sourceId: string, organization = org) {
    const text = 'The image optimization API supports batch processing.';
    const rows =
      await sql`insert into public.knowledge_documents(organization_id,brand_id,source_id,document_key,title,canonical_url,content,checksum)
      values(${organization},${brandId},${sourceId},'manual','Product capabilities','https://clarityscale.example/docs',${text},${hash(text)}) returning id`;
    const id = String(rows[0]?.id);
    await sql`insert into public.knowledge_chunks(organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,embedding,checksum)
      values(${organization},${brandId},${sourceId},${id},0,${text},10,${vector}::extensions.vector,${hash(text)})`;
    await sql`update public.knowledge_sources set status='ready',page_count=1,chunk_count=1 where id=${sourceId}`;
    return id;
  }
  async function upload(
    brandId: string,
    sourceId: string,
    user = users.owner,
    organization = org,
    filename = 'guide.txt',
    mime = 'text/plain',
    size = 120,
  ) {
    const path = `${organization}/${brandId}/${sourceId}/${filename}`;
    await asUser(
      user,
      (tx) => tx`insert into storage.objects(bucket_id,name,owner_id,metadata)
      values('knowledge-private',${path},${user},${tx.json({ size, mimetype: mime })})`,
    );
    return sourceInputSchema.parse({
      name: 'Uploaded product guide',
      type: 'file',
      filename,
      mime_type: mime,
      storage_path: path,
    });
  }
  beforeAll(async () => {
    verifyDocker();
    sql = postgres(localDatabaseUrl(), { max: 6, connect_timeout: 5, onnotice: () => {} });
    for (const [role, id] of Object.entries(users)) {
      await sql`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values(${id},${`${id}@phase2.example`},now(),${sql.json({ full_name: `Knowledge ${role}` })})`;
    }
    const first = await asUser(
      users.owner,
      (tx) =>
        tx`select public.create_organization('Knowledge fixture',${`knowledge-a-${run}`},${`${users.owner}@phase2.example`}) as id`,
    );
    org = String(first[0]?.id);
    const second = await asUser(
      users.other,
      (tx) =>
        tx`select public.create_organization('Other knowledge',${`knowledge-b-${run}`},${`${users.other}@phase2.example`}) as id`,
    );
    otherOrg = String(second[0]?.id);
    for (const role of ['admin', 'member', 'viewer'] as const) {
      await sql`insert into public.organization_members(organization_id,user_id,role) values(${org},${users[role]},${role})`;
    }
  });
  beforeEach(async () => {
    await sql`delete from public.brands where organization_id in (${org},${otherOrg})`;
    await sql.begin(async (tx) => {
      await tx`select set_config('storage.allow_delete_query','true',true)`;
      await tx`delete from storage.objects where bucket_id='knowledge-private' and (name like ${`${org}/%`} or name like ${`${otherOrg}/%`})`;
    });
    await sql`update public.subscriptions set plan_key='growth',status='active',current_period_start=now(),current_period_end=now()+interval '30 days' where organization_id=${org}`;
    await sql`update public.organizations set status='active' where id=${org}`;
  });
  afterAll(async () => {
    if (!sql) return;
    try {
      await sql.begin(async (tx) => {
        await tx`select set_config('storage.allow_delete_query','true',true)`;
        await tx`delete from storage.objects where bucket_id='knowledge-private' and (name like ${`${org}/%`} or name like ${`${otherOrg}/%`})`;
      });
      await sql`delete from public.organizations where id in (${org},${otherOrg})`;
      await sql`delete from auth.users where id in ${sql(Object.values(users))}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it('saves the complete validated brand and relational competitor, persona and keyword mirrors', async () => {
    const id = await brand();
    const rows = await asUser(users.viewer, (tx) => tx`select * from public.brands where id=${id}`);
    // Vocabulary is a set reconciled by stable identity in Phase 3. Compare its
    // complete contents independently of row ordering, retaining every other field.
    const saved = brandInputSchema.parse(rows[0]?.profile);
    expect({
      ...saved,
      keywords: [...saved.keywords].sort(),
      exclusions: [...saved.exclusions].sort(),
    }).toEqual({
      ...demoBrand,
      keywords: [...demoBrand.keywords].sort(),
      exclusions: [...demoBrand.exclusions].sort(),
    });
    expect(
      await asUser(
        users.viewer,
        (tx) => tx`select * from public.brand_competitors where brand_id=${id}`,
      ),
    ).toHaveLength(2);
    const personas = await asUser(
      users.viewer,
      (tx) => tx`select * from public.brand_personas where brand_id=${id}`,
    );
    expect(personas[0]).toMatchObject({
      real_role: 'employee',
      tone: 'Technical',
      default_disclosure: demoBrand.disclosure_text,
    });
    expect(
      await asUser(
        users.viewer,
        (tx) => tx`select * from public.brand_keywords where brand_id=${id}`,
      ),
    ).toHaveLength(4);
    await asUser(
      users.admin,
      (tx) =>
        tx`select public.save_brand(${org},${id},${tx.json({ ...demoBrand, name: 'Updated product', competitors: [] })})`,
    );
    expect(await sql`select * from public.brand_competitors where brand_id=${id}`).toHaveLength(0);
  });

  it('denies member/viewer mutations, anonymous access, direct writes and cross-tenant RPCs', async () => {
    const id = await brand();
    for (const user of [users.member, users.viewer, users.other]) {
      await expect(
        asUser(user, (tx) => tx`select public.save_brand(${org},${id},${tx.json(demoBrand)})`),
      ).rejects.toThrow('FORBIDDEN');
      await expect(
        asUser(user, (tx) => tx`select public.archive_brand(${id},true)`),
      ).rejects.toThrow('FORBIDDEN');
      await expect(
        asUser(
          user,
          (tx) => tx`select public.add_knowledge_source(${id},${randomUUID()},${tx.json(manual)})`,
        ),
      ).rejects.toThrow('FORBIDDEN');
    }
    await expect(
      asUser(users.owner, (tx) => tx`update public.brands set status='archived' where id=${id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select public.save_brand(${org},null,${tx.json(demoBrand)})`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select * from public.knowledge_sources`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it('rejects malformed profiles, forged roles and unsafe product links at the SQL boundary', async () => {
    for (const bad of [
      { ...demoBrand, name: null },
      { ...demoBrand, disclosure_text: '' },
      { ...demoBrand, website_url: 'https://127.0.0.1' },
      { ...demoBrand, website_url: 'https://private.local' },
      { ...demoBrand, real_role: 'independent customer' },
      { ...demoBrand, tone: 'Custom', custom_tone: '' },
      { ...demoBrand, allowed_links: ['https://attacker.example/docs'] },
      { ...demoBrand, keywords: 'unbounded' },
    ]) {
      await expect(
        asUser(users.owner, (tx) => tx`select public.save_brand(${org},null,${tx.json(bad)})`),
      ).rejects.toThrow(/INVALID_/);
    }
    expect(await sql`select id from public.brands where organization_id=${org}`).toHaveLength(0);
  });

  it('serializes Growth brand capacity and rechecks capacity on restoration', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => brand()));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(attempts.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'BRAND_LIMIT' }),
    });
    const first = attempts.find((r) => r.status === 'fulfilled');
    if (first?.status !== 'fulfilled') throw new Error('Brand fixture missing');
    await asUser(users.owner, (tx) => tx`select public.archive_brand(${first.value},true)`);
    await brand();
    await expect(
      asUser(users.owner, (tx) => tx`select public.archive_brand(${first.value},false)`),
    ).rejects.toThrow('BRAND_LIMIT');
    expect(await sql`select id from public.brands where organization_id=${org}`).toHaveLength(4);
  });

  it('enforces Solo/trial limits and expired usage without deleting existing knowledge', async () => {
    const id = await brand();
    const sid = await source(id);
    await sql`update public.subscriptions set plan_key='solo' where organization_id=${org}`;
    await expect(brand()).rejects.toThrow('BRAND_LIMIT');
    await brand(users.other, otherOrg);
    await expect(brand(users.other, otherOrg)).rejects.toThrow('BRAND_LIMIT');
    await sql`update public.subscriptions set status='trialing',plan_key='trial',current_period_start=now()-interval '8 days',current_period_end=now()-interval '1 day' where organization_id=${org}`;
    await expect(source(id)).rejects.toThrow('TRIAL_EXPIRED');
    await expect(
      asUser(users.owner, (tx) => tx`select public.retry_knowledge_source(${sid})`),
    ).rejects.toThrow('TRIAL_EXPIRED');
    expect(
      await asUser(
        users.viewer,
        (tx) => tx`select id from public.knowledge_sources where id=${sid}`,
      ),
    ).toHaveLength(1);
    await asUser(users.owner, (tx) => tx`select public.delete_knowledge_source(${sid})`);
  });

  it('enforces aggregate crawl-page reservations, exact domains and bounded manual input', async () => {
    const id = await brand();
    await sql`update public.subscriptions set plan_key='solo' where organization_id=${org}`;
    const input = sourceInputSchema.parse({
      name: 'Approved docs',
      type: 'website',
      pages: Array.from({ length: 20 }, (_, i) => `https://clarityscale.example/docs/${i}`),
    });
    const attempts = await Promise.allSettled([source(id, input), source(id, input)]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'PAGE_LIMIT' }),
    });
    await expect(
      source(id, { ...input, pages: ['https://attacker.example/docs'] }),
    ).rejects.toThrow('UNAPPROVED_DOMAIN');
    await expect(
      source(id, { ...input, pages: ['https://clarityscale.example.attacker.example/docs'] }),
    ).rejects.toThrow('UNAPPROVED_DOMAIN');
    await expect(source(id, { ...manual, text: 'x'.repeat(500001) })).rejects.toThrow(
      'INVALID_SOURCE',
    );
    await expect(source(id, { ...manual, text: 'too short' })).rejects.toThrow('INVALID_SOURCE');
    await asUser(users.owner, (tx) => tx`select public.archive_brand(${id},true)`);
    await expect(source(id)).rejects.toThrow('BRAND_ARCHIVED');
  });

  it('enforces the 100-source cap inside the locked allocation transaction', async () => {
    const id = await brand();
    await sql`insert into public.knowledge_sources(organization_id,brand_id,name,type,manual_text)
      select ${org},${id},'Reserved fixture','manual','A bounded source reserved for the quota contract.' from generate_series(1,100)`;
    await expect(source(id)).rejects.toThrow('SOURCE_LIMIT');
  });

  it('isolates every knowledge table and rejects cross-brand composite foreign keys', async () => {
    const a = await brand();
    const sid = await source(a);
    const doc = await document(a, sid);
    const b = await brand(users.other, otherOrg);
    for (const table of [
      'brands',
      'brand_competitors',
      'brand_personas',
      'brand_keywords',
      'knowledge_sources',
      'knowledge_documents',
      'knowledge_chunks',
    ]) {
      const rows = await asUser(
        users.other,
        (tx) => tx`select id from ${tx('public')}.${tx(table)} where organization_id=${org}`,
      );
      expect(rows).toHaveLength(0);
    }
    expect(
      await asUser(
        users.other,
        (tx) => tx`select id from public.knowledge_jobs where source_id=${sid}`,
      ),
    ).toHaveLength(0);
    await expect(sql`insert into public.knowledge_documents(organization_id,brand_id,source_id,document_key,title,content,checksum)
      values(${otherOrg},${b},${sid},'forged','Forged','Cross-tenant content',${hash('forged')})`).rejects.toThrow(
      /foreign key/,
    );
    await expect(sql`insert into public.knowledge_chunks(organization_id,brand_id,source_id,document_id,chunk_index,content,token_count,embedding,checksum)
      values(${otherOrg},${b},${sid},${doc},1,'Cross-tenant content',5,${vector}::extensions.vector,${hash('forged')})`).rejects.toThrow(
      /foreign key/,
    );
    await expect(
      asUser(users.owner, (tx) => tx`select lease_token from public.knowledge_jobs`),
    ).rejects.toThrow(/permission denied/);
  });

  it('returns vector-backed citations only for included, active tenant knowledge', async () => {
    const a = await brand();
    const sid = await source(a);
    const doc = await document(a, sid);
    const search = (user: string) =>
      asUser(
        user,
        (tx) =>
          tx`select * from public.search_knowledge(${a},${vector}::extensions.vector,'batch optimization')`,
      );
    expect((await search(users.viewer))[0]).toMatchObject({
      document_id: doc,
      source_id: sid,
      title: 'Product capabilities',
      source_url: 'https://clarityscale.example/docs',
    });
    expect(await search(users.other)).toHaveLength(0);
    await expect(
      asUser(users.viewer, (tx) => tx`select public.set_knowledge_document_included(${doc},false)`),
    ).rejects.toThrow('FORBIDDEN');
    await asUser(
      users.admin,
      (tx) => tx`select public.set_knowledge_document_included(${doc},false)`,
    );
    expect(await search(users.owner)).toHaveLength(0);
    await asUser(
      users.admin,
      (tx) => tx`select public.set_knowledge_document_included(${doc},true)`,
    );
    await asUser(users.owner, (tx) => tx`select public.archive_brand(${a},true)`);
    expect(await search(users.owner)).toHaveLength(0);
    await asUser(users.owner, (tx) => tx`select public.archive_brand(${a},false)`);
    await asUser(users.owner, (tx) => tx`select public.delete_knowledge_source(${sid})`);
    expect(await search(users.owner)).toHaveLength(0);
    expect(await sql`select id from public.knowledge_chunks where source_id=${sid}`).toHaveLength(
      0,
    );
    await expect(
      asUser(
        users.owner,
        (tx) => tx`select * from public.search_knowledge(${a},'[1,0]'::extensions.vector,'batch')`,
      ),
    ).rejects.toThrow('INVALID_SEARCH');
  });

  it('reserves private uploads by organization/brand/source and prevents overwrite and cross-tenant reads', async () => {
    const a = await brand();
    const sid = randomUUID();
    const file = await upload(a, sid);
    expect(
      await asUser(
        users.owner,
        (tx) => tx`select id from storage.objects where name=${file.storage_path}`,
      ),
    ).toHaveLength(1);
    expect(
      await asUser(
        users.viewer,
        (tx) => tx`select id from storage.objects where name=${file.storage_path}`,
      ),
    ).toHaveLength(0);
    await source(a, file, users.owner, sid);
    expect(
      await asUser(
        users.viewer,
        (tx) => tx`select id from storage.objects where name=${file.storage_path}`,
      ),
    ).toHaveLength(1);
    expect(
      await asUser(
        users.other,
        (tx) => tx`select id from storage.objects where name=${file.storage_path}`,
      ),
    ).toHaveLength(0);
    expect(
      await asUser(
        users.owner,
        (tx) =>
          tx`update storage.objects set metadata='{}' where name=${file.storage_path} returning id`,
      ),
    ).toHaveLength(0);
    for (const user of [users.member, users.viewer, users.other]) {
      await expect(upload(a, randomUUID(), user)).rejects.toThrow(/row-level security/);
    }
    await expect(upload(a, randomUUID(), users.owner, otherOrg)).rejects.toThrow(
      /row-level security/,
    );
  });

  it('checks original file ownership, MIME, extension, size and source path before committing a job', async () => {
    const a = await brand();
    const sid = randomUUID();
    const file = await upload(a, sid);
    await expect(source(a, file, users.admin, sid)).rejects.toThrow('FILE_NOT_FOUND');
    await expect(
      source(a, { ...file, storage_path: `${otherOrg}/${a}/${sid}/guide.txt` }, users.owner, sid),
    ).rejects.toThrow('INVALID_FILE');
    await expect(
      source(a, { ...file, mime_type: 'application/pdf' }, users.owner, sid),
    ).rejects.toThrow('INVALID_FILE');
    await sql`update storage.objects set metadata=${sql.json({ size: 10485761, mimetype: 'text/plain' })} where name=${file.storage_path}`;
    await expect(source(a, file, users.owner, sid)).rejects.toThrow('INVALID_FILE');
    expect(await sql`select id from public.knowledge_jobs where source_id=${sid}`).toHaveLength(0);
    // Own uncommitted objects remain removable when source validation fails.
    const deleted = await asUser(users.owner, async (tx) => {
      await tx`select set_config('storage.allow_delete_query','true',true)`;
      return tx`delete from storage.objects where name=${file.storage_path} returning id`;
    });
    expect(deleted).toHaveLength(1);
  });

  it('deduplicates pending retries and increments generation only for a new processing attempt', async () => {
    const a = await brand();
    const sid = await source(a);
    await Promise.all([
      asUser(users.owner, (tx) => tx`select public.retry_knowledge_source(${sid})`),
      asUser(users.admin, (tx) => tx`select public.retry_knowledge_source(${sid})`),
    ]);
    expect(await sql`select id from public.knowledge_jobs where source_id=${sid}`).toHaveLength(1);
    await sql`update public.knowledge_sources set status='failed',error_code='EXTRACTION_FAILED' where id=${sid}`;
    await asUser(users.owner, async (tx) => {
      await tx`select public.retry_knowledge_source(${sid})`;
      await tx`set local role postgres`;
      await tx`update public.knowledge_jobs set available_at=now()+interval '1 day' where source_id=${sid}`;
    });
    const rows =
      await sql`select generation,status,error_code from public.knowledge_sources where id=${sid}`;
    expect(rows[0]).toMatchObject({ generation: 2, status: 'pending', error_code: null });
    expect(await sql`select id from public.knowledge_jobs where source_id=${sid}`).toHaveLength(2);
    await expect(
      sql`insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind) values(${org},${a},${sid},2,'ingest')`,
    ).rejects.toThrow(/unique/);
  });

  it('purges content immediately, invalidates old generations and queues deletion exactly once', async () => {
    const a = await brand();
    const sid = await source(a);
    await document(a, sid);
    await expect(
      asUser(users.other, (tx) => tx`select public.delete_knowledge_source(${sid})`),
    ).rejects.toThrow('FORBIDDEN');
    await asUser(users.owner, async (tx) => {
      await tx`select public.delete_knowledge_source(${sid})`;
      await tx`select public.delete_knowledge_source(${sid})`;
      await tx`set local role postgres`;
      await tx`update public.knowledge_jobs set available_at=now()+interval '1 day' where source_id=${sid}`;
    });
    const rows =
      await sql`select generation,status,manual_text,page_count,chunk_count,deleted_at from public.knowledge_sources where id=${sid}`;
    expect(rows[0]).toMatchObject({
      generation: 2,
      status: 'deleting',
      manual_text: null,
      page_count: 0,
      chunk_count: 0,
    });
    expect(rows[0]?.deleted_at).not.toBeNull();
    expect(
      await sql`select id from public.knowledge_jobs where source_id=${sid} and kind='delete'`,
    ).toHaveLength(1);
    expect(
      await sql`select id from public.knowledge_documents where source_id=${sid}`,
    ).toHaveLength(0);
    const audit = await asUser(
      users.owner,
      (tx) =>
        tx`select action,metadata from public.audit_logs where organization_id=${org} and target_id=${sid}`,
    );
    expect(audit.some((r) => r.action === 'knowledge.delete_requested')).toBe(true);
    expect(audit.every((r) => !JSON.stringify(r.metadata).includes(manual.text))).toBe(true);
  });

  it('allows a failed storage deletion to be retried without duplicate pending cleanup', async () => {
    const a = await brand();
    const sid = await source(a);
    await asUser(users.owner, async (tx) => {
      await tx`select public.delete_knowledge_source(${sid})`;
      await tx`set local role postgres`;
      await tx`update public.knowledge_jobs set status='failed',attempts=3,error_code='STORAGE_DELETE_FAILED' where source_id=${sid} and kind='delete'`;
      await tx`update public.knowledge_sources set error_code='STORAGE_DELETE_FAILED' where id=${sid}`;
    });
    await asUser(users.owner, async (tx) => {
      await tx`select public.delete_knowledge_source(${sid})`;
      await tx`select public.delete_knowledge_source(${sid})`;
      await tx`set local role postgres`;
      await tx`update public.knowledge_jobs set available_at=now()+interval '1 day' where source_id=${sid}`;
    });
    expect(
      (
        await sql`select generation,status,error_code from public.knowledge_sources where id=${sid}`
      )[0],
    ).toMatchObject({ generation: 3, status: 'deleting', error_code: null });
    expect(
      await sql`select id from public.knowledge_jobs where source_id=${sid} and kind='delete' and status='queued'`,
    ).toHaveLength(1);
  });
});
