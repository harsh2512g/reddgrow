import {
  expect,
  test,
  request as playwrightRequest,
  type APIRequestContext,
} from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 15000 });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Attribution journeys require verified project-local services.',
);
test.setTimeout(240_000);
test('attributes a consented signup and one USD 99 purchase to a reviewed reply', async ({
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
    connection: { statement_timeout: 10000, application_name: 'threadsignal-phase6-e2e' },
  });
  const identity = uniqueIdentity('attribution');
  let organization: string | undefined;
  let serverClient: APIRequestContext | undefined;
  try {
    console.info('Attribution journey: sign-in.');
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    console.info('Attribution journey: workspace created.');
    // Test-only entitlement setup for this disposable identity. There is no plan-changing customer UI or billing side effect.
    await sql`update public.subscriptions set plan_key='growth',status='active',current_period_end=now()+interval '30 days' where organization_id=${organization}`;
    await page.goto('/app/brands/new');
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    const brand = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));
    await page.getByLabel('Source name', { exact: true }).fill('Attribution journey evidence');
    await page.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    const sources = page.locator('input[name="approved-pages"]');
    await expect(sources).toHaveCount(6);
    for (const input of await sources.all()) await input.check();
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45000 });
    console.info('Attribution journey: knowledge ready.');
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
    const opportunityRecord = z
      .object({ id: z.uuid(), summary: z.string().min(1) })
      .parse(
        (
          await sql`select o.id,o.summary from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and p.provider_post_id='fixture_001'`
        )[0],
      );
    const opportunity = opportunityRecord.id;
    await page.goto(`/app/opportunities/${opportunity}`);
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/drafts\/[a-f0-9-]+$/);
    const draft = z.uuid().parse(new URL(page.url()).pathname.split('/').at(-1));
    const row = async () =>
      (await sql`select status,current_version from public.drafts where id=${draft}`)[0];
    await expect
      .poll(async () => String((await row())?.status), { timeout: 45000 })
      .toMatch(/^(ready|warning)$/);
    await expect(
      page.getByRole('button', { name: 'Verify current version', exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    const warning = page.getByRole('checkbox', { name: /I reviewed the warnings/ });
    if (await warning.isVisible()) await warning.check();
    const responsible = page.getByRole('checkbox', { name: /I will disclose my affiliation/ });
    if (await responsible.isVisible()) await responsible.check();
    await page.getByRole('button', { name: 'Approve version 1', exact: true }).click();
    await expect.poll(async () => String((await row())?.status)).toBe('approved');
    console.info('Attribution journey: draft approved.');
    const trackedLinkAction = page.getByRole('link', { name: 'Create tracked link', exact: true });
    await expect(trackedLinkAction).toBeVisible({ timeout: 15000 });
    await trackedLinkAction.click();
    await expect(page.getByRole('combobox', { name: 'Approved draft', exact: true })).toHaveValue(
      draft,
    );
    await expect(
      page.getByRole('heading', { name: 'Give each conversation a destination.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Create tracking link', exact: true }).click();
    const trackingUrl = await page.getByLabel('New tracking URL', { exact: true }).inputValue();
    if (!/^http:\/\/127\.0\.0\.1:3000\/go\/[A-Za-z0-9_-]{12,64}$/.test(trackingUrl))
      throw new Error('Expected a verified local tracking link.');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `.threadsignal/verification/phase6-links-${test.info().project.name}.png`,
      fullPage: true,
    });
    // The redirect receipt is never put into a step title, screenshot or trace. The real snippet scrubs it after initialization.
    const redirectResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/go/') && response.status() === 302,
    );
    await page.evaluate((destination) => window.location.assign(destination), trackingUrl);
    const redirect = await redirectResponse;
    const timing = await redirect.headerValue('server-timing');
    const duration = Number(/^redirect;dur=([0-9.]+)$/.exec(timing ?? '')?.[1]);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeLessThan(2000);
    await test.info().attach('redirect-latency', {
      body: JSON.stringify({ status: 302, durationMs: duration }),
      contentType: 'application/json',
    });
    await expect(
      page.getByRole('heading', { name: 'ClarityScale AI demo', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('status')).toContainText('No conversion event has been sent');
    const events = async () =>
      await sql`select event_type,value,currency from public.conversion_events where organization_id=${organization!} order by event_type`;
    expect(await events()).toHaveLength(0);
    expect(
      Number(
        (
          await sql`select count(*) as n from public.tracking_clicks where organization_id=${organization!}`
        )[0]?.n,
      ),
    ).toBe(1);
    expect(
      await page.evaluate(
        () =>
          !new URL(location.href).searchParams.has('ts_click_token') &&
          !new URL(location.href).searchParams.has('ts_click_id'),
      ),
    ).toBe(true);
    await expect(
      page.getByRole('button', { name: 'Record demo signup', exact: true }),
    ).toBeDisabled();
    console.info('Attribution journey: tracked visit ready; no conversion before consent.');
    await page.getByRole('checkbox', { name: /Allow this local demo/ }).check();
    const failedRequests: string[] = [];
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname === '/api/v1/browser-events') {
        const error = request.failure()?.errorText;
        if (error && /^net::[A-Z_]+$/.test(error)) failedRequests.push(error);
      }
    });
    const signupResponse = page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/browser-events' &&
          response.request().method() === 'POST',
        { timeout: 12000 },
      )
      .catch(() => null);
    await page.getByRole('button', { name: 'Record demo signup', exact: true }).click();
    const signup = await signupResponse;
    console.info(`Attribution journey: signup HTTP ${signup?.status() ?? 'no_response'}.`);
    if (!signup) {
      throw new Error(
        `No browser signup response; network: ${failedRequests.join(',') || 'none'}.`,
      );
    }
    const contentType = signup.headers()['content-type'];
    const responseKind = contentType?.includes('application/json')
      ? 'json'
      : contentType?.includes('text/html')
        ? 'html'
        : contentType?.includes('text/plain')
          ? 'text'
          : contentType
            ? 'other'
            : 'absent';
    const hasRequestId = Boolean(signup.headers()['x-request-id']);
    console.info(
      `Attribution response metadata: Content-Type=${responseKind}; X-Request-ID present=${hasRequestId}.`,
    );
    if (signup.status() !== 201) {
      const bytes = await Promise.race([
        signup.body().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      let payload: unknown = null;
      if (bytes) {
        try {
          payload = JSON.parse(bytes.toString('utf8'));
        } catch {
          /* Do not print error body. */
        }
        const isHtml = /^\s*(<!doctype html|<html)/i.test(bytes.toString('utf8'));
        console.info(
          `Attribution response body: bytes=${bytes.length}; JSON=${payload !== null}; HTML=${isHtml}.`,
        );
      } else console.info('Attribution response body: unavailable within diagnostic bound.');
      const failure = z
        .object({ error: z.object({ code: z.string().regex(/^[A-Z_]{1,80}$/) }) })
        .safeParse(payload);
      throw new Error(
        `Local browser signup failed: HTTP ${signup.status()}, ${failure.success ? failure.data.error.code : 'UNKNOWN_ERROR'}.`,
      );
    }
    await expect(page.getByRole('status')).toHaveText('Demo signup recorded.');
    console.info('Attribution journey: browser signup accepted.');
    await page.getByRole('button', { name: 'Record demo purchase', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Demo USD 99 purchase recorded.');
    await page.getByRole('button', { name: 'Repeat the same demo purchase', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('No duplicate was added');
    expect(
      (await events()).map((event) => ({
        event: event.event_type,
        value: Number(event.value),
        currency: event.currency,
      })),
    ).toEqual([
      { event: 'purchase', value: 99, currency: 'USD' },
      { event: 'signup', value: 0, currency: 'USD' },
    ]);
    await page.getByRole('checkbox', { name: /Allow this local demo/ }).uncheck();
    await expect(
      page.getByRole('button', { name: 'Record demo signup', exact: true }),
    ).toBeDisabled();
    console.info('Attribution journey: browser purchase and repeat verified.');
    await page.goto(`/app/analytics?brandId=${brand}`);
    await expect(
      page.getByRole('heading', { name: 'Follow the conversation further.' }),
    ).toBeVisible();
    for (const metric of ['clicks', 'unique-attributed-clicks', 'signups', 'purchases'])
      await expect(page.getByTestId(`metric-${metric}`).locator('dd').first()).toHaveText('1');
    await expect(page.getByTestId('revenue-USD')).toContainText('99.00');
    const funnel = page.getByRole('region', { name: 'From conversation to conversion' });
    await expect(
      funnel
        .getByRole('listitem')
        .filter({ hasText: 'Signups attributed' })
        .locator('.tabular-nums'),
    ).toHaveText('1');
    await expect(
      funnel
        .getByRole('listitem')
        .filter({ hasText: 'Purchases attributed' })
        .locator('.tabular-nums'),
    ).toHaveText('1');
    await expect(page.getByTestId('metric-click-to-signup-rate').locator('dd').first()).toHaveText(
      '100%',
    );
    await expect(
      page.getByTestId('metric-signup-to-purchase-rate').locator('dd').first(),
    ).toHaveText('100%');
    await expect(
      page.getByRole('table', { name: 'Recorded activity by selected breakdown' }),
    ).toContainText(/saas/i);
    const conversations = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Conversations worth following', exact: true }),
    });
    await expect(conversations).toContainText(opportunityRecord.summary);
    await expect(conversations).not.toContainText(opportunity);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `.threadsignal/verification/phase6-analytics-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `.threadsignal/verification/phase6-analytics-top-${test.info().project.name}.png`,
    });
    await page.goto('/app');
    await expect(page.getByTestId('metric-purchases').locator('dd').first()).toHaveText('1');
    await page.goto(`/app/settings/integrations?brandId=${brand}#conversion-settings`);
    await expect(
      page.getByRole('heading', { name: 'Connect actions to conversations.' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create conversion key', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Key name', { exact: true }).fill('Journey C server');
    await page.getByRole('button', { name: 'Create conversion key', exact: true }).click();
    const keyInput = page.getByLabel('One-time conversion key', { exact: true });
    await expect(keyInput).toBeVisible();
    let serverKey = await keyInput.inputValue();
    if (!/^tsk_[A-Za-z0-9_-]{43}$/.test(serverKey))
      throw new Error('The new server conversion key was not available.');
    await page.getByRole('button', { name: 'Hide key', exact: true }).click();
    await expect(keyInput).toHaveCount(0);
    serverClient = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3000',
      extraHTTPHeaders: { Authorization: `Bearer ${serverKey}` },
    });
    serverKey = '';
    const clickId = z
      .uuid()
      .parse(
        (await sql`select id from public.tracking_clicks where organization_id=${organization}`)[0]
          ?.id,
      );
    const serverEvent = {
      clickId,
      event: 'lead',
      externalId: 'journey-c-server-lead',
      value: 0,
      currency: 'USD',
      occurredAt: new Date().toISOString(),
    };
    const sendServerEvent = async () => {
      try {
        return (
          await serverClient!.post('/api/v1/conversions', { data: serverEvent, timeout: 15000 })
        ).status();
      } catch {
        throw new Error('The local server conversion request failed.');
      }
    };
    expect(await sendServerEvent()).toBe(201);
    console.info('Attribution journey: server lead accepted.');
    expect(await sendServerEvent()).toBe(200);
    expect(
      Number(
        (
          await sql`select count(*) as n from public.conversion_events where organization_id=${organization} and event_type='lead'`
        )[0]?.n,
      ),
    ).toBe(1);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Revoke Journey C server', exact: true }).click();
    await expect(
      page.getByText('Conversion key revoked. Existing analytics are retained.', { exact: true }),
    ).toBeVisible();
    expect(await sendServerEvent()).toBe(401);
    await serverClient.dispose();
    serverClient = undefined;
    await page.getByText('View installation snippet', { exact: true }).click();
    await expect(page.getByLabel('Browser tracking installation snippet')).toContainText(
      'consent: false',
    );
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `.threadsignal/verification/phase6-integrations-${test.info().project.name}.png`,
      fullPage: true,
    });
  } finally {
    console.info('Attribution journey: cleaning disposable records.');
    if (serverClient) await serverClient.dispose();
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
    console.info('Attribution journey: cleanup finished.');
  }
});
