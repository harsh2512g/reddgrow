import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import {
  createWorkspace,
  signInWithMagicLink,
  uniqueIdentity,
} from '../../apps/web/tests/e2e/local-auth';

test.setTimeout(240000);
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Verified project-local services are required.',
);
const appOrigin = 'http://127.0.0.1:3000';

async function approveCurrentDraft(page: Page, version: number) {
  await expect(
    page.getByRole('button', { name: 'Verify current version', exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  const warnings = page.getByRole('checkbox', { name: /I reviewed the warnings/ });
  if (await warnings.isVisible()) await warnings.check();
  const responsible = page.getByRole('checkbox', { name: /I will disclose my affiliation/ });
  if (await responsible.isVisible()) await responsible.check();
  await page.getByRole('button', { name: `Approve version ${version}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy approved draft', exact: true })).toBeEnabled({
    timeout: 15000,
  });
}

/** Code is passed only in memory; no fill step or report attachment contains its value. */
async function connectFromSettings(web: Page, panel: Page, name: string) {
  await web.goto('/app/settings/integrations');
  await web.getByLabel('Browser name', { exact: true }).fill(name);
  const creationResponse = web.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/extension/connection-code' &&
      response.request().method() === 'POST',
  );
  await web.getByRole('button', { name: 'Connect Chrome extension', exact: true }).click();
  const response = await creationResponse;
  if (!response.ok()) {
    const error = z
      .object({ error: z.object({ code: z.string().regex(/^[A-Z_]{1,80}$/) }) })
      .safeParse(await response.json().catch(() => null));
    throw new Error(
      `Connection-code creation failed: HTTP ${response.status()} ${error.success ? error.data.error.code : 'UNKNOWN_ERROR'}.`,
    );
  }
  await web.getByLabel('One-time connection code', { exact: true }).waitFor();
  let code: string;
  try {
    code = await web.evaluate(() => {
      const input = document.getElementById('extension-connection-code');
      if (!(input instanceof HTMLInputElement) || !input.value) throw new Error('Missing code.');
      const value = input.value;
      const hide = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Hide code',
      );
      if (!hide) throw new Error('Missing privacy control.');
      hide.click();
      return value;
    });
    await panel.evaluate((value) => {
      const input = document.getElementById('connection-code');
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing connection input.');
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, code);
  } catch {
    throw new Error('The local one-time connection flow could not be prepared.');
  }
  await panel.getByRole('button', { name: 'Connect workspace', exact: true }).click();
  try {
    await expect(panel.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible({
      timeout: 15000,
    });
  } catch {
    // Panel messages are fixed safe strings; never read or report the code/token inputs.
    const status = await panel.locator('#status').textContent();
    throw new Error(`Extension connection did not complete. ${status ?? 'No status returned.'}`);
  }
  await expect(panel.getByLabel('One-time connection code')).toHaveValue('');
}

async function hasStoredConnection(panel: Page) {
  return panel.evaluate(async () => {
    const api = Reflect.get(globalThis, 'chrome') as {
      storage: { local: { get: (key: string) => Promise<Record<string, unknown>> } };
    };
    const stored = await api.storage.local.get('threadsignalSession');
    return Boolean(stored.threadsignalSession);
  });
}

test('connects the real MV3 build, reapproves edits, inserts without submitting, copies and revokes', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('A verified project-local database is required.');
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const build = z
    .object({ extensionId: z.string().regex(/^[a-p]{32}$/), apiOrigin: z.literal(appOrigin) })
    .parse(JSON.parse(await readFile('config/extension-development.json', 'utf8')));
  const extensionPath = resolve('apps/extension/dist');
  const profilePath = resolve('.threadsignal/browser-profiles', `phase5-${randomUUID()}`);
  const identity = uniqueIdentity('extension');
  let context: BrowserContext | undefined;
  let organization: string | undefined;
  try {
    await mkdir(profilePath, { recursive: true });
    context = await chromium.launchPersistentContext(profilePath, {
      channel: 'chromium',
      headless: true,
      baseURL: appOrigin,
      viewport: { width: 1280, height: 960 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    context.setDefaultTimeout(15000);
    // This browser has an isolated project-owned profile. Refuse every nonlocal HTTP request.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (
        ['chrome-extension:', 'data:', 'about:', 'blob:'].includes(url.protocol) ||
        (url.hostname === '127.0.0.1' && ['3000', '54321', '54324'].includes(url.port))
      )
        await route.continue();
      else await route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const probe = await worker.evaluate(async (extensionId) => {
      try {
        const response = await fetch('http://127.0.0.1:3000/api/extension/exchange', {
          method: 'POST',
          credentials: 'omit',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-ThreadSignal-Extension': extensionId },
          body: JSON.stringify({ code: 'deliberately-invalid-test-input' }),
          signal: AbortSignal.timeout(12000),
        });
        const value: unknown = await response.json().catch(() => null);
        const outer = value as { error?: { code?: unknown } } | null;
        return {
          status: response.status,
          code:
            typeof outer?.error?.code === 'string' && /^[A-Z_]{1,80}$/.test(outer.error.code)
              ? outer.error.code
              : 'NONE',
        };
      } catch (issue) {
        return { status: 0, code: issue instanceof Error ? issue.name : 'NETWORK_FAILURE' };
      }
    }, build.extensionId);
    expect(
      probe,
      'The actual extension worker must reach the local API and reject invalid input.',
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    const web = await context.newPage();
    await signInWithMagicLink(web, identity.email);
    await expect(web).toHaveURL(appOrigin + '/app/onboarding');
    await expect(web.getByLabel('Organization name', { exact: true })).toBeVisible();
    organization = await createWorkspace(web, identity);
    await web.goto('/app/brands/new');
    await web.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await web.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(web).toHaveURL(/\/app\/knowledge\?brandId=/);
    const brand = z.uuid().parse(new URL(web.url()).searchParams.get('brandId'));
    await web.getByLabel('Source name', { exact: true }).fill('Extension evidence documents');
    await web.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    const pages = web.locator('input[name="approved-pages"]');
    await expect(pages).toHaveCount(6);
    for (const input of await pages.all()) await input.check();
    await web.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    await expect(web.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45000 });
    await web.goto(`/app/subreddits?brandId=${brand}`);
    await web.getByLabel('Community name', { exact: true }).fill('SaaS');
    await web.getByRole('button', { name: 'Search communities', exact: true }).click();
    await web.getByRole('button', { name: 'Monitor community', exact: true }).click();
    const findOpportunity = async () =>
      (
        await sql`select o.id from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and p.provider_post_id='fixture_001' and not o.is_blocked`
      )[0]?.id;
    await expect.poll(async () => Boolean(await findOpportunity()), { timeout: 45000 }).toBe(true);
    const opportunityId = z.uuid().parse(await findOpportunity());
    await web.goto(`/app/opportunities/${opportunityId}`);
    await web.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await expect(web).toHaveURL(/\/app\/drafts\/[a-f0-9-]+$/);
    const draftId = z.uuid().parse(new URL(web.url()).pathname.split('/').at(-1));
    const draftRow = async () =>
      (
        await sql`select current_content,current_version,status,inserted_version,published_version from public.drafts where id=${draftId}`
      )[0];
    await expect
      .poll(async () => String((await draftRow())?.status), { timeout: 45000 })
      .toMatch(/^(ready|warning)$/);
    await approveCurrentDraft(web, 1);
    await expect(
      web.getByRole('link', { name: 'Open mock discussion', exact: true }),
    ).toBeVisible();
    const fixtureUrl = await web
      .getByRole('link', { name: 'Open mock discussion', exact: true })
      .getAttribute('href');
    if (!fixtureUrl || !fixtureUrl.startsWith(appOrigin + '/extension-fixture/reddit/'))
      throw new Error('A local fixture discussion link is required.');
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 420, height: 950 });
    await panel.goto(`chrome-extension://${build.extensionId}/sidepanel/index.html`);
    await expect(
      panel.getByRole('button', { name: 'Connect workspace', exact: true }),
    ).toBeVisible();
    await connectFromSettings(web, panel, 'Phase 5 isolated Chrome');
    expect(await hasStoredConnection(panel)).toBe(true);
    const fixture = await context.newPage();
    await fixture.goto(fixtureUrl);
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Look up current tab', exact: true }).click();
    await expect(panel.getByLabel('Reply draft', { exact: true })).toBeVisible();
    const original = z.string().parse((await draftRow())?.current_content);
    await expect(panel.getByLabel('Reply draft', { exact: true })).toHaveValue(original);
    await expect(panel.locator('#score')).toContainText('/100');
    await expect(panel.locator('#evidence')).toContainText('verified');
    const firstSentence = original.match(/^[\s\S]*?[.!?](?:\s|$)/)?.[0].trim();
    if (!firstSentence) throw new Error('The synthetic approved draft must contain a sentence.');
    const edited = `${original}\n\n${firstSentence}`;
    await panel.getByLabel('Reply draft', { exact: true }).fill(edited);
    await expect(
      panel.getByRole('button', { name: 'Insert into comment box', exact: true }),
    ).toBeDisabled();
    await expect(
      panel.getByRole('button', { name: 'Copy approved draft', exact: true }),
    ).toBeDisabled();
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Save for verification', exact: true }).click();
    await expect(panel.locator('#status')).toContainText('Edit saved for verification');
    await expect(
      panel.getByRole('button', { name: 'Insert into comment box', exact: true }),
    ).toBeDisabled();
    await expect
      .poll(async () => String((await draftRow())?.status), { timeout: 45000 })
      .toMatch(/^(ready|warning)$/);
    await web.goto(`/app/drafts/${draftId}`);
    await expect(web.getByLabel('Editable draft')).toHaveValue(edited);
    await approveCurrentDraft(web, 2);
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Look up current tab', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Insert into comment box', exact: true }),
    ).toBeEnabled();
    await panel.getByRole('button', { name: 'Insert into comment box', exact: true }).click();
    await expect(fixture.getByLabel('Comment composer', { exact: true })).toHaveValue(edited);
    await expect(fixture.getByTestId('submit-attempts')).toHaveText('0');
    await expect.poll(async () => Number((await draftRow())?.inserted_version)).toBe(2);
    await fixture.screenshot({
      path: '.threadsignal/verification/phase5-fixture-inserted.png',
      fullPage: true,
    });
    await panel.getByRole('button', { name: 'Insert into comment box', exact: true }).click();
    await expect(panel.locator('#status')).toContainText('already contains text');
    await expect(fixture.getByLabel('Comment composer', { exact: true })).toHaveValue(edited);
    await fixture
      .getByRole('combobox', { name: 'Composer variant', exact: true })
      .selectOption('editable');
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Insert into comment box', exact: true }).click();
    await expect(
      fixture.getByRole('textbox', { name: 'Comment composer', exact: true }),
    ).toHaveText(edited);
    await expect(fixture.getByTestId('submit-attempts')).toHaveText('0');
    await fixture
      .getByRole('combobox', { name: 'Composer variant', exact: true })
      .selectOption('unknown');
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Insert into comment box', exact: true }).click();
    await expect(panel.locator('#status')).toContainText('Use Copy approved draft instead');
    await expect(fixture.getByLabel('Unsupported composer', { exact: true })).toHaveValue('');
    // Clipboard is replaced only inside this fresh extension page; the OS clipboard is untouched.
    await panel.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            Reflect.set(window, '__threadsignalFixtureCopy', text);
          },
        },
      }),
    );
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Copy approved draft', exact: true }).click();
    await expect
      .poll(async () =>
        panel.evaluate(() => String(Reflect.get(window, '__threadsignalFixtureCopy') ?? '')),
      )
      .toBe(edited);
    await expect(fixture.getByTestId('submit-attempts')).toHaveText('0');
    await fixture
      .getByRole('combobox', { name: 'Composer variant', exact: true })
      .selectOption('ambiguous');
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Insert into comment box', exact: true }).click();
    await expect(panel.locator('#status')).toContainText('Several comment boxes are open');
    await expect(fixture.getByLabel('Comment composer', { exact: true })).toHaveValue('');
    await expect(fixture.getByLabel('Second composer', { exact: true })).toHaveValue('');
    await expect(fixture.getByTestId('submit-attempts')).toHaveText('0');
    await panel.getByText('Already published it yourself?', { exact: true }).click();
    await panel
      .getByLabel('Resulting Reddit comment URL', { exact: true })
      .fill('https://www.reddit.com/r/saas/comments/fixture_001/thread/abc123/');
    await expect(
      panel.getByRole('button', { name: 'I published this', exact: true }),
    ).toBeDisabled();
    await panel
      .getByRole('checkbox', { name: 'I personally published this reply.', exact: true })
      .check();
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'I published this', exact: true }).click();
    await expect.poll(async () => Number((await draftRow())?.published_version)).toBe(2);
    await expect(fixture.getByTestId('submit-attempts')).toHaveText('0');
    await panel.screenshot({
      path: '.threadsignal/verification/phase5-extension-approved.png',
      fullPage: true,
    });
    await web.goto('/app/settings/integrations');
    await expect(
      web.getByRole('button', { name: 'Revoke Phase 5 isolated Chrome', exact: true }),
    ).toBeVisible();
    await web.screenshot({
      path: '.threadsignal/verification/phase5-connected-settings.png',
      fullPage: true,
    });
    web.once('dialog', (dialog) => dialog.accept());
    await web.getByRole('button', { name: 'Revoke Phase 5 isolated Chrome', exact: true }).click();
    await expect(web.getByText('Revoked', { exact: true })).toBeVisible();
    await fixture.bringToFront();
    await panel.getByRole('button', { name: 'Look up current tab', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Connect workspace', exact: true }),
    ).toBeVisible();
    expect(await hasStoredConnection(panel)).toBe(false);
    await connectFromSettings(web, panel, 'Phase 5 logout verification');
    expect(await hasStoredConnection(panel)).toBe(true);
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(
      panel.getByRole('button', { name: 'Connect workspace', exact: true }),
    ).toBeVisible();
    expect(await hasStoredConnection(panel)).toBe(false);
    await web.getByRole('button', { name: 'Refresh connections', exact: true }).click();
    await expect(web.getByText('Revoked', { exact: true })).toHaveCount(2);
    expect(
      Number(
        (
          await sql`select count(*) as n from public.extension_sessions where organization_id=${organization} and revoked_at is null`
        )[0]?.n,
      ),
    ).toBe(0);
  } finally {
    await context?.close();
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
    await rm(profilePath, { recursive: true, force: true });
  }
});
