import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15000 });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Draft journeys require verified project-local services.',
);
test.setTimeout(240_000);
const origin = 'http://127.0.0.1:3000';
test('reviews source-backed drafts, blocks unsafe edits and approves a restored version', async ({
  page,
}) => {
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('Verified local test database required.');
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const identity = uniqueIdentity('drafts');
  let organization: string | undefined;
  try {
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    await page.goto('/app/brands/new');
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    const brand = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));
    await page.getByLabel('Source name', { exact: true }).fill('Draft evidence documents');
    await page.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    const pages = page.locator('input[name="approved-pages"]');
    await expect(pages).toHaveCount(6);
    for (const input of await pages.all()) await input.check();
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45000 });
    await page.goto(`/app/settings/persona?brandId=${brand}`);
    await expect(page.getByRole('heading', { name: 'Sound like yourself.' })).toBeVisible();
    await page.getByLabel('Display name', { exact: true }).fill('Evidence reviewer');
    await page
      .getByRole('combobox', { name: 'Technical depth', exact: true })
      .selectOption('technical');
    await page.getByRole('button', { name: 'Save persona', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Persona saved');
    await page.goto(`/app/subreddits?brandId=${brand}`);
    await page.getByLabel('Community name', { exact: true }).fill('SaaS');
    await page.getByRole('button', { name: 'Search communities', exact: true }).click();
    await page.getByRole('button', { name: 'Monitor community', exact: true }).click();
    await expect
      .poll(
        async () =>
          Number(
            (
              await sql`select count(*) as n from public.opportunities where brand_id=${brand} and not is_blocked and final_score>=90`
            )[0]?.n,
          ),
        { timeout: 45000 },
      )
      .toBeGreaterThan(0);
    const [opportunity] =
      await sql`select o.id from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and p.provider_post_id='fixture_001'`;
    const opportunityId = z.uuid().parse(opportunity?.id);
    await page.goto(`/app/opportunities/${opportunityId}`);
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/drafts\/[a-f0-9-]+$/);
    const draft = z.uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
    const row = async () =>
      (
        await sql`select current_content,current_version,status,verified_version,compliance_status from public.drafts where id=${draft}`
      )[0];
    await expect
      .poll(async () => String((await row())?.status), { timeout: 45000 })
      .toMatch(/^(ready|warning)$/);
    const original = z.string().parse((await row())?.current_content);
    await expect(page.getByLabel('Editable draft')).toHaveValue(original, { timeout: 15000 });
    expect(original).toMatch(/founder|work with|team behind/i);
    await expect(page.getByRole('heading', { name: 'Claim evidence', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Independent checks', exact: true }),
    ).toBeVisible();
    const evidence = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Claim evidence', exact: true }),
    });
    await evidence.locator('summary').first().click();
    await expect(
      page.getByRole('link', { name: 'Review source', exact: true }).first(),
    ).toBeVisible();
    const unsafe = original + ' ClarityScale AI guarantees quantum teleportation for every image.';
    await page.getByLabel('Editable draft').fill(unsafe);
    await expect(page.getByRole('button', { name: /Approve version/ })).toBeDisabled();
    // Autosave must create a new immutable version without requiring a manual click.
    await expect
      .poll(async () => Number((await row())?.current_version), { timeout: 15000 })
      .toBe(2);
    await expect
      .poll(async () => String((await row())?.status), { timeout: 45000 })
      .toBe('blocked');
    await expect(page.locator('mark').filter({ hasText: /quantum teleportation/ })).toBeVisible({
      timeout: 15000,
    });
    const blocked = await page.request.post(`/api/drafts/${draft}/approve`, {
      headers: { origin, 'X-ThreadSignal-Organization': organization },
      data: { expectedVersion: 2, acknowledgeWarnings: true, acceptResponsibleUse: true },
    });
    expect(blocked.status()).toBe(409);
    await page.screenshot({
      path: `.threadsignal/verification/phase4-blocked-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole('combobox', { name: 'Compare with version', exact: true })
      .selectOption('1');
    await page.getByRole('button', { name: 'Restore selected version', exact: true }).click();
    await expect.poll(async () => Number((await row())?.current_version)).toBe(3);
    await expect
      .poll(async () => String((await row())?.status), { timeout: 45000 })
      .toMatch(/^(ready|warning)$/);
    await expect(page.getByLabel('Editable draft')).toHaveValue(original, { timeout: 15000 });
    await page.getByText('Reject this draft', { exact: true }).click();
    await page
      .getByLabel('Rejection reason', { exact: true })
      .fill('Please make this reply shorter.');
    await page.getByRole('button', { name: 'Reject with reason', exact: true }).click();
    await expect.poll(async () => String((await row())?.status)).toBe('rejected');
    await expect(page.getByText('Please make this reply shorter.', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption('shorter');
    await page.getByRole('button', { name: 'Regenerate draft', exact: true }).click();
    await expect
      .poll(async () => Number((await row())?.current_version), { timeout: 45000 })
      .toBe(4);
    await expect
      .poll(async () => String((await row())?.status), { timeout: 45000 })
      .toMatch(/^(ready|warning)$/);
    await expect(
      page.getByRole('button', { name: 'Verify current version', exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    const warnings = page.getByRole('checkbox', { name: /I reviewed the warnings/ });
    if (await warnings.isVisible()) await warnings.check();
    const responsible = page.getByRole('checkbox', { name: /I will disclose my affiliation/ });
    if (await responsible.isVisible()) await responsible.check();
    await expect(
      page.getByRole('button', { name: 'Approve version 4', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Approve version 4', exact: true }).click();
    await expect.poll(async () => String((await row())?.status)).toBe('approved');
    // Use an isolated in-page clipboard stub; never replace the owner's OS clipboard.
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            Reflect.set(window, '__threadsignalCopiedDraft', text);
          },
        },
      }),
    );
    await expect(
      page.getByRole('button', { name: 'Copy approved draft', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Copy approved draft', exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(() => String(Reflect.get(window, '__threadsignalCopiedDraft') ?? '')),
      )
      .toMatch(/ClarityScale/i);
    await page.getByText('Share feedback', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Feedback', exact: true }).selectOption('useful');
    await page.getByRole('button', { name: 'Save feedback', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Feedback saved for this draft.' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      await page
        .getByRole('button', {
          name: /publish to reddit|submit (comment|reply)|post (comment|reply)/i,
        })
        .count(),
    ).toBe(0);
    await page.getByText('Already published it yourself?', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Mark published manually', exact: true }),
    ).toBeDisabled();
    await page.getByText('Already published it yourself?', { exact: true }).click();
    await page.screenshot({
      path: `.threadsignal/verification/phase4-approved-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `.threadsignal/verification/phase4-studio-${test.info().project.name}.png`,
    });
    await page.goto(`/app/drafts?brandId=${brand}`);
    await expect(
      page.locator(`a[href="/app/drafts/${draft}"]`).getByText('approved', { exact: true }),
    ).toBeVisible();
  } finally {
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
  }
});
