// Explicit personal-development API/worker smoke. Never discovered by Vitest.
// Creates two synthetic identities, no email, and cleans up only this run's recorded resources.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createAIProvider } from '@threadsignal/ai';
import { demoBrand, sourceInputSchema } from '@threadsignal/knowledge';
import { fixturePages } from '@threadsignal/crawler';
import { assertInside, state } from '../../scripts/isolation.mjs';
import { readHostedProfile } from '../../scripts/hosted-profile.mjs';
import { loadVerifiedServiceRuntime } from '../../scripts/service-utils.mjs';
import {
  readHostedWorkerProfile,
  readHostedStorageSecret,
  workerDatabaseConfig,
} from '../../scripts/hosted-worker-profile.mjs';
import {
  readHostedDatabaseConfig,
  loadSupabaseCertificate,
} from '../../scripts/hosted-database-config.mjs';

class SmokeFailure extends Error {}
const check = (condition, step) => {
  if (!condition) throw new SmokeFailure(step);
};
const dataOrFail = (result, step) => {
  check(!result.error, step);
  return result.data;
};
const uuid = (value, step) => {
  const result = z.uuid().safeParse(value);
  check(result.success, step);
  return result.data;
};

/** Restrict every SDK request, suppress redirects, and bound its body/time without logging it. */
function projectFetch(profile, secret) {
  return async (input, init = {}) => {
    const url = new URL(input instanceof globalThis.Request ? input.url : String(input));
    check(
      url.origin === profile.url &&
        !url.username &&
        !url.password &&
        /^\/(auth|rest|storage)\/v1\//.test(url.pathname),
      'REQUEST_DESTINATION_REJECTED',
    );
    const headers = new globalThis.Headers(
      init.headers ?? (input instanceof globalThis.Request ? input.headers : {}),
    );
    // Supabase translates a modern secret apikey into its service role at the gateway.
    if (secret && headers.get('authorization') === `Bearer ${secret}`)
      headers.delete('authorization');
    const response = await fetch(input, {
      ...init,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        check(size <= 1_048_576, 'RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const responseHeaders = new globalThis.Headers(response.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new globalThis.Response(chunks.length ? Buffer.concat(chunks) : null, {
      status: response.status,
      headers: responseHeaders,
    });
  };
}

async function poll(action, step) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await action()) return;
    await delay(1_000);
  }
  throw new SmokeFailure(step);
}

export async function runHostedKnowledgeSmoke() {
  check(process.env.THREADSIGNAL_LOCAL === '1', 'ISOLATED_RUNNER_REQUIRED');
  check(Boolean(loadVerifiedServiceRuntime()), 'OWNED_LOCAL_SERVICES_REQUIRED');
  const profile = readHostedProfile();
  const workerProfile = readHostedWorkerProfile(profile.projectRef);
  const storageSecret = readHostedStorageSecret();
  const adminConfig = readHostedDatabaseConfig(profile.projectRef);
  const ca = await loadSupabaseCertificate();
  adminConfig.ssl = { ca, rejectUnauthorized: true, servername: adminConfig.host };
  adminConfig.connection.application_name = 'threadsignal-hosted-smoke-cleanup';
  const workerSql = postgres(workerDatabaseConfig(workerProfile, ca));
  // This lazy administrator connection is used only in finally for exact-fixture cleanup.
  const adminSql = postgres(adminConfig);
  const sdkOptions = (secret) => ({
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: projectFetch(profile, secret) },
  });
  const admin = createClient(profile.url, storageSecret, sdkOptions(storageSecret));
  const owner = createClient(profile.url, profile.publishableKey, sdkOptions());
  const other = createClient(profile.url, profile.publishableKey, sdkOptions());
  const runId = randomUUID();
  const identities = [0, 1].map((index) => ({
    id: randomUUID(),
    email: `threadsignal-smoke-${runId}-${index}@example.invalid`,
    creationAttempted: false,
    created: false,
    removed: false,
  }));
  const sourceIds = [randomUUID(), randomUUID(), randomUUID()];
  const record = {
    version: 1,
    kind: 'hosted-knowledge-api-worker-smoke',
    projectRef: profile.projectRef,
    runId,
    startedAt: new Date().toISOString(),
    status: 'pending',
    checks: [],
    identities,
    organizationId: null,
    organizationSlug: `smoke-${runId}`,
    brandId: null,
    sourceIds,
    storagePath: null,
    cleanup: 'pending',
    failure: null,
  };
  const directory = assertInside(join(state, 'hosted/smoke'));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const receipt = assertInside(join(directory, `${runId}.json`));
  const save = (flag = 'w') =>
    writeFileSync(assertInside(receipt), JSON.stringify(record, null, 2) + '\n', {
      mode: 0o600,
      flag,
    });
  save('wx');
  const passed = (step) => {
    record.checks.push(step);
    save();
    process.stdout.write(`Hosted smoke: ${step} passed.\n`);
  };
  let failure;
  try {
    const [identity] = await workerSql`select current_user as role`;
    check(identity?.role === 'threadsignal_worker', 'RESTRICTED_WORKER_IDENTITY');
    await poll(async () => {
      const response = await fetch('http://127.0.0.1:3003/api/health/ready', {
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      const health = await response.json();
      return (
        response.ok &&
        health.status === 'ready' &&
        health.mode === 'personal-development' &&
        health.projectRef === profile.projectRef &&
        health.queuePrefix === `threadsignal-hosted-${profile.projectRef}`
      );
    }, 'WORKER_READINESS_TIMEOUT');
    passed('restricted-worker-readiness');
    for (const [index, user] of identities.entries()) {
      // IDs are persisted before creation, so even a lost response has a bounded cleanup target.
      const password = randomBytes(32).toString('base64url');
      user.creationAttempted = true;
      save();
      const created = dataOrFail(
        await admin.auth.admin.createUser({
          id: user.id,
          email: user.email,
          password,
          email_confirm: true,
          app_metadata: { threadsignal_smoke_run: runId },
          user_metadata: { full_name: 'ThreadSignal synthetic verification' },
        }),
        'SYNTHETIC_IDENTITY_CREATION',
      );
      check(created.user?.id === user.id, 'SYNTHETIC_IDENTITY_MISMATCH');
      user.created = true;
      save();
      const authenticated = dataOrFail(
        await (index === 0 ? owner : other).auth.signInWithPassword({
          email: user.email,
          password,
        }),
        'SYNTHETIC_AUTHENTICATION',
      );
      check(authenticated.user?.id === user.id && authenticated.session, 'SYNTHETIC_SESSION');
    }
    passed('two-synthetic-identities-no-email');
    record.organizationId = uuid(
      dataOrFail(
        await owner.rpc('create_organization', {
          p_name: 'ThreadSignal synthetic verification',
          p_slug: record.organizationSlug,
          p_billing_email: identities[0].email,
        }),
        'ORGANIZATION_CREATION',
      ),
      'ORGANIZATION_ID',
    );
    save();
    record.brandId = uuid(
      dataOrFail(
        await owner.rpc('save_brand', {
          p_organization_id: record.organizationId,
          p_id: null,
          p_profile: demoBrand,
        }),
        'BRAND_CREATION',
      ),
      'BRAND_ID',
    );
    save();
    const text =
      'Private fixture: ClarityScale AI supports batch image optimization and asynchronous image processing.';
    record.storagePath = `${record.organizationId}/${record.brandId}/${sourceIds[2]}/smoke.txt`;
    save();
    dataOrFail(
      await owner.storage.from('knowledge-private').upload(record.storagePath, Buffer.from(text), {
        contentType: 'text/plain',
        upsert: false,
      }),
      'PRIVATE_UPLOAD',
    );
    const inputs = [
      {
        name: 'Synthetic demo website',
        type: 'website',
        pages: fixturePages.map((page) => page.url),
      },
      { name: 'Synthetic manual note', type: 'manual', text },
      {
        name: 'Synthetic private text',
        type: 'file',
        filename: 'smoke.txt',
        mime_type: 'text/plain',
        storage_path: record.storagePath,
      },
    ];
    for (const [index, input] of inputs.entries()) {
      const source = dataOrFail(
        await owner.rpc('add_knowledge_source', {
          p_brand_id: record.brandId,
          p_id: sourceIds[index],
          p_input: sourceInputSchema.parse(input),
        }),
        'SOURCE_CREATION',
      );
      check(source === sourceIds[index], 'SOURCE_ID');
    }
    await poll(async () => {
      const sources = dataOrFail(
        await owner
          .from('knowledge_sources')
          .select('id,status,page_count,chunk_count')
          .eq('organization_id', record.organizationId)
          .in('id', sourceIds),
        'SOURCE_STATUS',
      );
      check(!sources.some((source) => source.status === 'failed'), 'SOURCE_PROCESSING_FAILED');
      return (
        sources.length === 3 &&
        sources.every((source) => source.status === 'ready' && source.chunk_count > 0) &&
        sources.find((source) => source.id === sourceIds[0])?.page_count === fixturePages.length
      );
    }, 'KNOWLEDGE_INGESTION_TIMEOUT');
    passed('website-manual-private-file-ingestion');
    const query = 'batch image optimization';
    const [embedding] = await createAIProvider('mock').embed({ texts: [query], dimensions: 512 });
    const searchInput = {
      p_brand_id: record.brandId,
      p_embedding: JSON.stringify(embedding),
      p_query: query,
    };
    const results = dataOrFail(
      await owner.rpc('search_knowledge', searchInput),
      'KNOWLEDGE_SEARCH',
    );
    check(
      results.length > 0 && results.every((result) => sourceIds.includes(result.source_id)),
      'SEARCH_PROVENANCE',
    );
    const file = dataOrFail(
      await owner.storage.from('knowledge-private').download(record.storagePath),
      'PRIVATE_DOWNLOAD',
    );
    check((await file.text()) === text, 'PRIVATE_FILE_BYTES');
    passed('search-provenance-private-file-bytes');
    for (const table of [
      'brands',
      'knowledge_sources',
      'knowledge_documents',
      'knowledge_chunks',
    ]) {
      const rows = dataOrFail(
        await other.from(table).select('id').eq('organization_id', record.organizationId),
        'CROSS_TENANT_QUERY',
      );
      check(rows.length === 0, 'CROSS_TENANT_ROWS_VISIBLE');
    }
    check(
      dataOrFail(await other.rpc('search_knowledge', searchInput), 'CROSS_TENANT_SEARCH').length ===
        0,
      'CROSS_TENANT_SEARCH_VISIBLE',
    );
    check(
      Boolean((await other.storage.from('knowledge-private').download(record.storagePath)).error),
      'CROSS_TENANT_FILE_VISIBLE',
    );
    check(
      (await other.rpc('archive_brand', { p_brand_id: record.brandId, p_archived: true })).error
        ?.code === '42501',
      'CROSS_TENANT_MUTATION',
    );
    passed('cross-tenant-read-write-storage-denial');
    // Exact synthetic fixture only: a trial has one seat, so adding the test viewer is an
    // admin fixture insert. Customer plan/membership records and billing remain untouched.
    dataOrFail(
      await admin.from('organization_members').insert({
        organization_id: record.organizationId,
        user_id: identities[1].id,
        role: 'viewer',
      }),
      'SYNTHETIC_VIEWER_FIXTURE',
    );
    check(
      dataOrFail(await other.rpc('search_knowledge', searchInput), 'VIEWER_READ').length > 0,
      'VIEWER_READ',
    );
    check(
      (await other.rpc('archive_brand', { p_brand_id: record.brandId, p_archived: true })).error
        ?.code === '42501',
      'VIEWER_BRAND_MUTATION',
    );
    check(
      (await other.rpc('delete_knowledge_source', { p_source_id: sourceIds[0] })).error?.code ===
        '42501',
      'VIEWER_SOURCE_MUTATION',
    );
    passed('viewer-read-and-mutation-denial');
    for (const sourceId of sourceIds)
      dataOrFail(
        await owner.rpc('delete_knowledge_source', { p_source_id: sourceId }),
        'SOURCE_DELETION',
      );
    await poll(async () => {
      const rows =
        await workerSql`select id from public.knowledge_sources where organization_id=${record.organizationId} and id=any(${sourceIds}::uuid[])`;
      return rows.length === 0;
    }, 'WORKER_DELETION_TIMEOUT');
    const absent = await admin.storage.from('knowledge-private').download(record.storagePath);
    check(
      absent.error?.statusCode === '404' ||
        (absent.error?.statusCode === '400' && absent.error?.message === 'Object not found'),
      'PRIVATE_FILE_NOT_REMOVED',
    );
    passed('worker-source-and-storage-deletion');
    record.status = 'passed';
  } catch (error) {
    failure = error instanceof SmokeFailure ? error : new SmokeFailure('UNEXPECTED_SMOKE_FAILURE');
    record.status = 'failed';
    record.failure = failure.message;
  } finally {
    const cleanupFailures = [];
    // Recover a lost create_organization response only through this freshly created owner's RLS.
    if (!record.organizationId && identities[0].created) {
      try {
        const rows = dataOrFail(
          await owner.from('organizations').select('id').eq('slug', record.organizationSlug),
          'CLEANUP_ORGANIZATION_LOOKUP',
        );
        if (rows.length === 1) record.organizationId = uuid(rows[0].id, 'CLEANUP_ORGANIZATION_ID');
      } catch {
        cleanupFailures.push('organization-lookup');
      }
    }
    if (record.storagePath) {
      try {
        check(
          record.storagePath ===
            `${record.organizationId}/${record.brandId}/${sourceIds[2]}/smoke.txt`,
          'CLEANUP_STORAGE_PATH',
        );
        dataOrFail(
          await admin.storage.from('knowledge-private').remove([record.storagePath]),
          'CLEANUP_STORAGE',
        );
      } catch {
        cleanupFailures.push('storage');
      }
    }
    if (record.organizationId) {
      try {
        await adminSql.begin(async (tx) => {
          const removed =
            await tx`delete from public.organizations o where o.id=${record.organizationId}
            and o.slug=${record.organizationSlug} and exists(select 1 from public.organization_members m
              where m.organization_id=o.id and m.user_id=${identities[0].id} and m.role='owner') returning id`;
          check(removed.length === 1, 'CLEANUP_ORGANIZATION_BINDING');
        });
      } catch {
        cleanupFailures.push('organization');
      }
    }
    for (const user of identities) {
      if (!user.creationAttempted) continue;
      try {
        const lookup = await admin.auth.admin.getUserById(user.id);
        if (lookup.error?.status === 404) {
          user.removed = true;
          continue;
        }
        const found = dataOrFail(lookup, 'CLEANUP_IDENTITY_LOOKUP').user;
        check(
          found?.id === user.id &&
            found.email === user.email &&
            found.app_metadata.threadsignal_smoke_run === runId,
          'CLEANUP_IDENTITY_BINDING',
        );
        dataOrFail(await admin.auth.admin.deleteUser(user.id), 'CLEANUP_IDENTITY');
        user.removed = true;
      } catch {
        cleanupFailures.push('identity');
      }
    }
    const closed = await Promise.allSettled([
      workerSql.end({ timeout: 3 }),
      adminSql.end({ timeout: 3 }),
    ]);
    if (closed.some((result) => result.status === 'rejected'))
      cleanupFailures.push('database-connection');
    record.cleanup = cleanupFailures.length ? 'incomplete' : 'complete';
    record.finishedAt = new Date().toISOString();
    if (cleanupFailures.length) {
      record.status = 'failed';
      record.failure = 'CLEANUP_INCOMPLETE';
      record.cleanupFailures = cleanupFailures;
      failure = new SmokeFailure('CLEANUP_INCOMPLETE');
    }
    save();
    process.stdout.write(
      `Hosted smoke cleanup: ${record.cleanup}. Receipt: .threadsignal/hosted/smoke/${runId}.json\n`,
    );
  }
  if (failure) throw failure;
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    process.stderr.write(
      'Explicit personal cloud write: use the isolated runner with --run after authorization.\n',
    );
    process.exitCode = 1;
  } else {
    try {
      await runHostedKnowledgeSmoke();
    } catch (error) {
      process.stderr.write(
        `Hosted smoke failed: ${error instanceof SmokeFailure ? error.message : 'SMOKE_CONFIGURATION_FAILED'}.\n`,
      );
      process.exitCode = 1;
    }
  }
}
