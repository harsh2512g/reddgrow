import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15000 });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Billing journeys require verified project-local services.',
);
test.setTimeout(240_000);

test('Journey D: reaches the draft limit, upgrades, and persists personal notifications', async ({
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
    connection: { statement_timeout: 10000, application_name: 'threadsignal-phase7-e2e' },
  });
  const identity = uniqueIdentity('billing');
  let organization: string | undefined;
  try {
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    await page.goto('/app/brands/new');
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    const brand = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));
    await page.getByLabel('Source name', { exact: true }).fill('Billing journey knowledge');
    await page.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    const sources = page.locator('input[name="approved-pages"]');
    await expect(sources).toHaveCount(6);
    for (const input of await sources.all()) await input.check();
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45000 });
    await page.goto(`/app/subreddits?brandId=${brand}`);
    await page.getByLabel('Community name', { exact: true }).fill('SaaS');
    await page.getByRole('button', { name: 'Search communities', exact: true }).click();
    await page.getByRole('button', { name: 'Monitor community', exact: true }).click();
    const opportunityRows = () =>
      sql`select o.id from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and p.provider_post_id='fixture_001' and not o.is_blocked`;
    await expect.poll(async () => (await opportunityRows()).length, { timeout: 45000 }).toBe(1);
    const opportunity = z.uuid().parse((await opportunityRows())[0]?.id);

    // Only the prior allowance is seeded. The browser and worker consume the final trial draft,
    // and the real API must reject both UI and direct requests before the owner upgrades.
    await sql`insert into public.usage_counters(organization_id,metric,period_start,period_end,quantity)
      select organization_id,'ai_drafts',current_period_start,current_period_end,9 from public.subscriptions where organization_id=${organization}
      on conflict(organization_id,metric,period_start,period_end) do update set quantity=9`;
    const count = async () =>
      Number(
        (
          await sql`select c.quantity from public.usage_counters c join public.subscriptions s on s.organization_id=c.organization_id and c.period_start=s.current_period_start and c.period_end=s.current_period_end where c.organization_id=${organization!} and c.metric='ai_drafts'`
        )[0]?.quantity,
      );
    await page.goto(`/app/opportunities/${opportunity}`);
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/drafts\/[a-f0-9-]+$/);
    const lastTrialDraft = z.uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
    await expect
      .poll(
        async () =>
          String(
            (await sql`select status from public.drafts where id=${lastTrialDraft}`)[0]?.status,
          ),
        { timeout: 45000 },
      )
      .toMatch(/^(ready|warning)$/);
    expect(await count()).toBe(10);
    await page.goto(`/app/opportunities/${opportunity}`);
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'View plans and upgrade', exact: true }),
    ).toBeVisible();
    const denial = await page.evaluate(
      async ({ opportunityId, organizationId }) => {
        const response = await fetch(`/api/opportunities/${opportunityId}/drafts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ThreadSignal-Organization': organizationId,
          },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), options: {} }),
          signal: AbortSignal.timeout(15000),
        });
        const payload: unknown = await response.json();
        const code =
          payload &&
          typeof payload === 'object' &&
          'error' in payload &&
          payload.error &&
          typeof payload.error === 'object' &&
          'code' in payload.error
            ? payload.error.code
            : null;
        return { status: response.status, code: typeof code === 'string' ? code : null };
      },
      { opportunityId: opportunity, organizationId: organization },
    );
    expect(denial.status).toBeGreaterThanOrEqual(400);
    expect(denial.code).toBe('DRAFT_LIMIT');
    expect(await count()).toBe(10);

    await page.getByRole('link', { name: 'View plans and upgrade', exact: true }).click();
    await expect(page.getByRole('meter', { name: 'AI drafts', exact: true })).toHaveAttribute(
      'aria-valuetext',
      '10 of 10 used',
    );
    await page.getByRole('button', { name: 'Choose Solo', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Switch to Solo?', exact: true })).toBeVisible();
    expect(
      (
        await sql`select plan_key from public.subscriptions where organization_id=${organization}`
      )[0]?.plan_key,
    ).toBe('trial');
    await page.getByRole('button', { name: 'Confirm development upgrade', exact: true }).click();
    await expect(page.getByRole('meter', { name: 'AI drafts', exact: true })).toHaveAttribute(
      'aria-valuetext',
      '10 of 60 used',
    );
    await expect(page.getByRole('status').filter({ hasText: 'Solo is active' })).toBeVisible();
    expect(
      (
        await sql`select plan_key,status from public.subscriptions where organization_id=${organization}`
      )[0],
    ).toMatchObject({ plan_key: 'solo', status: 'active' });
    expect(await count()).toBe(10);
    await page.reload();
    await expect(page.getByRole('meter', { name: 'AI drafts', exact: true })).toHaveAttribute(
      'aria-valuetext',
      '10 of 60 used',
    );

    await page.getByRole('button', { name: 'Cancel subscription', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Resume subscription', exact: true }),
    ).toBeVisible();
    expect(
      (
        await sql`select cancel_at_period_end,status from public.subscriptions where organization_id=${organization}`
      )[0],
    ).toMatchObject({ cancel_at_period_end: true, status: 'active' });
    await page.getByRole('button', { name: 'Resume subscription', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm resume', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Cancel subscription', exact: true }),
    ).toBeVisible();

    await page.goto(`/app/opportunities/${opportunity}`);
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/drafts\/[a-f0-9-]+$/);
    const paidDraft = z.uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
    expect(paidDraft).not.toBe(lastTrialDraft);
    await expect
      .poll(
        async () =>
          String((await sql`select status from public.drafts where id=${paidDraft}`)[0]?.status),
        { timeout: 45000 },
      )
      .toMatch(/^(ready|warning)$/);
    expect(await count()).toBe(11);
    await page.goto('/app/settings/notifications');
    await expect(page.getByRole('checkbox', { name: /Daily opportunity digest/ })).toBeEnabled();
    await page.getByLabel('Minimum opportunity score', { exact: true }).fill('88');
    await page.getByLabel('Daily digest time', { exact: true }).fill('10:30');
    await page.getByLabel('Quiet hours start', { exact: true }).fill('22:00');
    await page.getByLabel('Quiet hours end', { exact: true }).fill('08:00');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'have been saved' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Minimum opportunity score', { exact: true })).toHaveValue('88');
    await expect(page.getByLabel('Daily digest time', { exact: true })).toHaveValue('10:30');
    await expect(page.getByLabel('Quiet hours start', { exact: true })).toHaveValue('22:00');
    await expect(page.getByLabel('Quiet hours end', { exact: true })).toHaveValue('08:00');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase7-notifications-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.goto('/app/settings/billing');
    await expect(page.getByRole('meter', { name: 'AI drafts', exact: true })).toHaveAttribute(
      'aria-valuetext',
      '11 of 60 used',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase7-billing-${test.info().project.name}.png`,
      fullPage: true,
    });
  } finally {
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
  }
});
