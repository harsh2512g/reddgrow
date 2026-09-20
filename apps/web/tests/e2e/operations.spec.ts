import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15000 });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Operations require verified project-local services.',
);
test.setTimeout(240_000);

test('Phase 8: audited operations, safe retries, activity and private data controls', async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('Verified local test database required.');
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
    connection: { statement_timeout: 10000, application_name: 'threadsignal-phase8-e2e' },
  });
  const identity = uniqueIdentity('operations');
  let organization: string | undefined;
  let actor: string | undefined;
  try {
    await page.goto('/');
    expect(await page.evaluate(async () => (await fetch('/api/internal/overview')).status)).toBe(
      401,
    );
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    expect(await page.evaluate(async () => (await fetch('/api/internal/overview')).status)).toBe(
      403,
    );
    const denied = await page.goto('/internal/admin');
    expect(denied?.status()).toBe(404);
    await page.goto('/app/brands/new');
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    const brand = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));

    const [user] = await sql`select id from auth.users where email=${identity.email}`;
    actor = z.uuid().parse(user?.id);
    // Only this disposable, newly created test identity receives platform authority.
    await sql`update public.profiles set is_platform_admin=true where id=${actor}`;
    const [source] =
      await sql`insert into public.knowledge_sources(organization_id,brand_id,name,type,status,manual_text)
      values(${organization},${brand},'Operations retry fixture','manual','failed','This synthetic knowledge source documents threadsignal-operations-e2e-evidence. It has no customer or provider credentials.') returning id`;
    const sourceId = z.uuid().parse(source?.id);
    const [job] =
      await sql`insert into public.knowledge_jobs(organization_id,brand_id,source_id,generation,kind,status,attempts,error_code)
      values(${organization},${brand},${sourceId},1,'ingest','failed',3,'PROVIDER_UNAVAILABLE') returning id`;
    const jobId = z.uuid().parse(job?.id);

    await page.goto('/internal/admin');
    await expect(
      page.getByRole('heading', { name: 'Keep the conversations moving.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Processing ledger', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase8-operations-${test.info().project.name}.png`,
      fullPage: true,
    });
    const jobsLink = page
      .getByRole('navigation', { name: 'Platform operations' })
      .getByRole('link', { name: 'Jobs', exact: true });
    await jobsLink.focus();
    await expect(jobsLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Every job has a trail.' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Pipeline', exact: true }).selectOption('knowledge');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    const jobRow = page
      .getByRole('region', { name: 'Job results' })
      .locator('li')
      .filter({ has: page.getByText(jobId, { exact: true }) });
    await jobRow.getByRole('button', { name: 'Review retry', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Confirm a safe retry', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Reason', { exact: true }).selectOption('recovered');
    await page.getByRole('button', { name: 'Confirm retry', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'The retry was recorded' }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          String(
            (await sql`select status from public.knowledge_sources where id=${sourceId}`)[0]
              ?.status,
          ),
        { timeout: 45000 },
      )
      .toBe('ready');
    const [sourceAfter] =
      await sql`select generation from public.knowledge_sources where id=${sourceId}`;
    expect(sourceAfter?.generation).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase8-jobs-${test.info().project.name}.png`,
      fullPage: true,
    });

    await page.goto(`/internal/admin/organizations/${organization}`);
    await expect(page.getByRole('heading', { name: identity.name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Pause workspace', exact: true }).click();
    await page.getByLabel('Reason for this change', { exact: true }).selectOption('maintenance');
    await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume workspace', exact: true })).toBeVisible();
    expect(
      (await sql`select status from public.organizations where id=${organization}`)[0]?.status,
    ).toBe('suspended');
    await page.getByRole('button', { name: 'Resume workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm change', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pause workspace', exact: true })).toBeVisible();
    expect(
      (await sql`select status from public.organizations where id=${organization}`)[0]?.status,
    ).toBe('active');
    await page.goto('/internal/admin/providers');
    await expect(page.getByRole('heading', { name: 'Know what is connected.' })).toBeVisible();
    await expect(page.getByText('console', { exact: true })).toBeVisible();
    await expect(page.getByText('fixture', { exact: true })).toBeVisible();
    await page.goto('/app/activity');
    await expect(page.getByRole('heading', { name: 'A clear record of your work.' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'organization resumed', exact: true }),
    ).toBeVisible();

    await page.goto('/app/settings/organization');
    await page.getByRole('button', { name: 'Create private export', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your private export is queued' }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await sql`select status from public.organization_data_requests where organization_id=${organization!} and kind='export' order by created_at desc limit 1`
          )[0]?.status,
        { timeout: 45000 },
      )
      .toBe('completed');
    await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
    const downloadLink = page.getByRole('link', { name: 'Download export', exact: true });
    await expect(downloadLink).toBeVisible();
    const downloadPath = z
      .string()
      .regex(/^\/api\/privacy\/requests\/[a-f0-9-]{36}\/download$/)
      .parse(await downloadLink.getAttribute('href'));
    const download = await page.request.get(downloadPath);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toBe('application/gzip');
    const serialized = gunzipSync(await download.body()).toString('utf8');
    const archive = z
      .object({
        format: z.literal('threadsignal-organization-export'),
        version: z.literal(1),
        organizationId: z.uuid(),
      })
      .parse(JSON.parse(serialized));
    expect(archive.organizationId).toBe(organization);
    expect(serialized).toContain('threadsignal-operations-e2e-evidence');
    for (const name of ['token_hash', 'key_hash', 'lease_token', 'delivery_fingerprint'])
      expect(serialized).not.toContain(`"${name}"`);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase8-privacy-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Revoke export', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'The export is revoked' }),
    ).toBeVisible();
    await expect(downloadLink).toHaveCount(0);
    expect((await page.request.get(downloadPath)).status()).toBe(409);
    await page.getByRole('button', { name: 'Review deletion', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Permanently delete organization', exact: true }),
    ).toBeDisabled();
    await page.getByLabel(`Type ${identity.slug} to confirm`, { exact: true }).fill(identity.slug);
    await page
      .getByRole('checkbox', {
        name: 'I have saved any data I need and understand deletion is permanent.',
        exact: true,
      })
      .check();
    await page
      .getByRole('button', { name: 'Permanently delete organization', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Organization deletion is underway.' }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          Number(
            (
              await sql`select count(*)::integer as count from public.organizations where id=${organization!}`
            )[0]?.count,
          ),
        { timeout: 45000 },
      )
      .toBe(0);
    expect((await sql`select id from auth.users where id=${actor}`).length).toBe(1);
    expect(
      (
        await sql`select id from storage.objects where bucket_id in ('knowledge-private','privacy-exports') and split_part(name,'/',1)=${organization}`
      ).length,
    ).toBe(0);
  } finally {
    if (actor) {
      await sql`delete from private.platform_operations_audit where actor_user_id=${actor}`;
      await sql`delete from private.platform_job_retries where actor_user_id=${actor}`;
    }
    if (organization) {
      await sql`delete from public.organizations where id=${organization}`;
      await sql`delete from private.privacy_deletion_receipts where organization_id=${organization}`;
    }
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
  }
});
