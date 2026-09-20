import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Opportunity journeys require verified project-local services.',
);
test.setTimeout(180_000);
const origin = 'http://127.0.0.1:3000';

test('monitors a community, scores real local records, explains signals and preserves review actions', async ({
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
  const identity = uniqueIdentity('signals');
  let organization: string | undefined;
  let brand: string | undefined;
  try {
    await signInWithMagicLink(page, identity.email);
    organization = await createWorkspace(page, identity);
    await page.goto('/app/brands/new');
    await page.getByRole('button', { name: 'Use synthetic demo', exact: true }).click();
    await page.getByRole('button', { name: 'Create brand', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/knowledge\?brandId=/);
    brand = z.uuid().parse(new URL(page.url()).searchParams.get('brandId'));
    await page.getByLabel('Source name', { exact: true }).fill('Opportunity product evidence');
    await page.getByRole('button', { name: 'Find approved pages', exact: true }).click();
    const pages = page.locator('input[name="approved-pages"]');
    await expect(pages).toHaveCount(6);
    for (const input of await pages.all()) await input.check();
    await page.getByRole('button', { name: 'Add knowledge source', exact: true }).click();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 45000 });
    await page.goto(`/app/subreddits?brandId=${brand}`);
    await page.getByLabel('Community name', { exact: true }).fill('SaaS');
    await page.getByRole('button', { name: 'Search communities', exact: true }).click();
    await page.getByRole('button', { name: 'Monitor community', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'r/saas', exact: true })).toBeVisible();
    await expect
      .poll(
        async () => {
          const rows =
            await sql`select final_score,is_blocked from public.opportunities where brand_id=${brand!}`;
          return (
            rows.some((r) => !r.is_blocked && Number(r.final_score) >= 90) &&
            rows.some((r) => r.is_blocked) &&
            rows.some(
              (r) => !r.is_blocked && Number(r.final_score) >= 40 && Number(r.final_score) < 60,
            )
          );
        },
        { timeout: 45000 },
      )
      .toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase3-communities-${test.info().project.name}.png`,
      fullPage: true,
    });
    const [high] =
      await sql`select o.id,p.title from public.opportunities o join public.reddit_posts p on p.id=o.reddit_post_id where o.brand_id=${brand} and not o.is_blocked order by o.final_score desc limit 1`;
    const highId = z.uuid().parse(high?.id);
    const highTitle = z.string().parse(high?.title);
    const listSchema = z.object({
      items: z.array(z.object({ id: z.uuid(), post: z.object({ title: z.string().nullable() }) })),
      nextCursor: z.string().nullable(),
    });
    for (const sort of ['score', 'freshness', 'engagement']) {
      const query = new URLSearchParams({
        brandId: brand,
        sort,
        minimumScore: '0',
        q: 'image',
        from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      });
      const response = await page.request.get(`/api/opportunities?${query}`);
      expect(response.status()).toBe(200);
      const result = z.object({ data: listSchema }).parse(await response.json()).data;
      expect(result.items.some((item) => item.id === highId)).toBe(true);
      expect(result.items.every((item) => item.post.title?.toLowerCase().includes('image'))).toBe(
        true,
      );
    }
    const [competitor] =
      await sql`select id from public.brand_competitors where brand_id=${brand} and name='SharpPixel'`;
    const competitorResponse = await page.request.get(
      `/api/opportunities?brandId=${brand}&competitorId=${z.uuid().parse(competitor?.id)}&minimumScore=0`,
    );
    expect(competitorResponse.status()).toBe(200);
    expect(
      z
        .object({ data: listSchema })
        .parse(await competitorResponse.json())
        .data.items.some((item) => item.id === highId),
    ).toBe(true);
    expect(
      (await page.request.get(`/api/opportunities?brandId=${brand}&cursor=invalid`)).status(),
    ).toBe(400);
    await page.goto(`/app/opportunities?brandId=${brand}&minimumScore=0`);
    await expect(page.getByRole('link', { name: highTitle, exact: true })).toBeVisible();
    await expect(page.locator('article').getByText('High', { exact: true }).first()).toBeVisible();
    await expect(
      page.locator('article').getByText('Medium', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('article').getByText('Low', { exact: true }).first()).toBeVisible();
    await expect(
      page.locator('article').getByText('Blocked', { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.threadsignal/verification/phase3-opportunities-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole('link', { name: highTitle, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'An explainable score.', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Supporting knowledge', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Review source', exact: true }).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Monitor', exact: true }).click();
    await expect
      .poll(async () =>
        String((await sql`select status from public.opportunities where id=${highId}`)[0]?.status),
      )
      .toBe('monitoring');
    await page.getByText('Dismiss with a reason', { exact: true }).click();
    await page
      .getByLabel(`Dismissal reason for ${highTitle}`, { exact: true })
      .selectOption('not_relevant');
    await page.getByRole('button', { name: 'Dismiss opportunity', exact: true }).click();
    await expect
      .poll(async () =>
        String((await sql`select status from public.opportunities where id=${highId}`)[0]?.status),
      )
      .toBe('dismissed');
    const usage =
      await sql`select quantity from public.usage_counters where organization_id=${organization}`;
    const rescore = await page.request.post(`/api/opportunities/${highId}/rescore`, {
      headers: { origin, 'X-ThreadSignal-Organization': organization },
    });
    expect(rescore.status()).toBe(200);
    await expect
      .poll(
        async () =>
          Number(
            (
              await sql`select count(*) as n from public.reddit_jobs where opportunity_id=${highId} and status='completed'`
            )[0]?.n,
          ),
        { timeout: 20000 },
      )
      .toBeGreaterThan(0);
    expect(
      await sql`select quantity from public.usage_counters where organization_id=${organization}`,
    ).toEqual(usage);
    expect((await sql`select status from public.opportunities where id=${highId}`)[0]?.status).toBe(
      'dismissed',
    );
    await page.screenshot({
      path: `.threadsignal/verification/phase3-detail-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.goto(`/app/opportunities?brandId=${brand}&risk=blocked`);
    await expect(
      page.locator('article').getByText('Blocked', { exact: true }).first(),
    ).toBeVisible();
    const [blocked] =
      await sql`select id from public.opportunities where brand_id=${brand} and is_blocked limit 1`;
    const blockedId = z.uuid().parse(blocked?.id);
    const forbidden = await page.request.post(`/api/opportunities/${blockedId}/save`, {
      headers: { origin, 'X-ThreadSignal-Organization': organization },
    });
    expect(forbidden.ok()).toBe(false);
    await page.goto(`/app/opportunities?brandId=${brand}&view=table&minimumScore=0`);
    await expect(page.getByRole('table')).toBeVisible();
    await page.goto(`/app/keywords?brandId=${brand}`);
    await expect(
      page.getByRole('heading', { name: /keyword|language|terms/i }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: `.threadsignal/verification/phase3-keywords-${test.info().project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  } finally {
    if (organization) await sql`delete from public.organizations where id=${organization}`;
    // Only this newly created synthetic Auth identity is removed; no account enumeration.
    await sql`delete from auth.users where email=${identity.email}`;
    await sql.end({ timeout: 5 });
  }
});
