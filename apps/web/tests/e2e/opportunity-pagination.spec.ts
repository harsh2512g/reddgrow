import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';
import { demoBrand } from '@threadsignal/knowledge';
import { opportunityEvaluationSchema } from '@threadsignal/opportunities';
import { createWorkspace, signInWithMagicLink, uniqueIdentity } from './local-auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(
  process.env.THREADSIGNAL_SERVICES_READY !== '1',
  'Feed pagination requires verified project-local services.',
);
test.setTimeout(180_000);
const feedSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        id: z.uuid(),
        organization_id: z.uuid(),
        brand_id: z.uuid(),
        subreddit_id: z.uuid(),
        status: z.string(),
        risk_level: z.string(),
        intent_category: z.string(),
        final_score: z.number(),
        freshness: z.number(),
        engagement_velocity: z.number(),
        matched_competitor_ids: z.array(z.uuid()),
        post: z.object({ title: z.string(), created_at_provider: z.string() }),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
});
async function feed(page: Page, query: URLSearchParams) {
  const response = await page.request.get(`/api/opportunities?${query}`);
  expect(response.status()).toBe(200);
  return feedSchema.parse(await response.json()).data;
}

test('paginates tied scores through real PostgREST without gaps and applies combined filters', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'API pagination is identical across browser viewports.',
  );
  const databaseUrl = process.env.DATABASE_URL;
  if (
    process.env.THREADSIGNAL_LOCAL !== '1' ||
    !databaseUrl ||
    !/^postgresql:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/.test(databaseUrl)
  )
    throw new Error('Verified local test database required.');
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const identity = uniqueIdentity('pagination');
  const brandId = randomUUID();
  const subredditId = randomUUID();
  const competitorId = randomUUID();
  const communityName = `p3${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const anchor = new Date();
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  anchor.setUTCHours(12, 0, 0, 0);
  const filterDate = anchor.toISOString().slice(0, 10);
  const expected: {
    id: string;
    index: number;
    final_score: number;
    freshness: number;
    engagement_velocity: number;
  }[] = [];
  let organizationId: string | undefined;
  try {
    await signInWithMagicLink(page, identity.email);
    organizationId = await createWorkspace(page, identity);
    const ownedOrganizationId = organizationId;
    // All synthetic preparation is one transaction. The monitoring row is paused
    // before commit, so the live worker never schedules this test-only community.
    await sql.begin(async (tx) => {
      await tx`update public.subscriptions set plan_key='growth',status='active',current_period_end=now()+interval '30 days' where organization_id=${ownedOrganizationId}`;
      await tx`insert into public.brands(id,organization_id,name,website_url,profile) values(${brandId},${ownedOrganizationId},${demoBrand.name},${demoBrand.website_url},${tx.json(demoBrand)})`;
      await tx`insert into public.brand_competitors(id,organization_id,brand_id,name,domain,aliases,notes) values(${competitorId},${ownedOrganizationId},${brandId},'Pagination comparison fixture','https://comparison.example','[]','Synthetic filter context')`;
      await tx`insert into public.subreddits(id,name,display_name,description) values(${subredditId},${communityName},'Pagination fixture','An isolated synthetic community used only by this test.')`;
      await tx`insert into public.brand_subreddits(organization_id,brand_id,subreddit_id,minimum_score) values(${ownedOrganizationId},${brandId},${subredditId},0)`;
      for (let index = 0; index < 30; index++) {
        const postId = randomUUID();
        const providerId = `${communityName}_${index}`;
        const alpha = index % 2 === 0;
        const finalScore = 70 + Math.floor(index / 5) * 5; // Five-way ties cross page boundaries.
        const freshness = (index % 5) * 20;
        const engagement = Math.floor((29 - index) / 4) * 10;
        const postedAt = new Date(anchor.getTime() - (alpha ? 0 : 86400000)).toISOString();
        const title = `Pagination ${alpha ? 'alpha' : 'beta'} image API ${index}`;
        await tx`insert into public.reddit_posts(id,provider,provider_post_id,subreddit_id,title,body,permalink,created_at_provider) values(${postId},'mock',${providerId},${subredditId},${title},'Synthetic pagination body for a product discussion.',${`https://www.reddit.com/r/${communityName}/comments/${providerId}/`},${postedAt})`;
        const evaluation = opportunityEvaluationSchema.parse({
          summary: title,
          user_need: 'Synthetic pagination and filter regression',
          intent_category: alpha ? 'recommendation' : 'problem',
          semantic_relevance: 80,
          buying_intent: 80,
          freshness,
          engagement_velocity: engagement,
          rule_fit: 80,
          competitor_context: 80,
          penalty_score: 0,
          final_score: finalScore,
          suggested_action: 'reply',
          risk_level: alpha ? 'low' : 'medium',
          risk_reasons: [],
          matched_capabilities: ['Image processing'],
          missing_capabilities: [],
          matched_competitor_ids: alpha ? [competitorId] : [],
          reasoning_summary: 'Explicit synthetic fixture for pagination.',
          model_metadata: {
            provider: 'mock',
            version: 'pagination-fixture',
            evaluation_method: 'deterministic test fixture',
          },
          input_checksum: index.toString(16).padStart(64, '0'),
          is_blocked: false,
          knowledge_citations: [],
          evaluated_at: new Date().toISOString(),
        });
        const [published] =
          await tx`select private.publish_opportunity(${brandId}::uuid,${postId}::uuid,${tx.json(evaluation)}::jsonb) as id`;
        const id = z.uuid().parse(published?.id);
        if (index % 3 === 0)
          await tx`update public.opportunities set status='saved' where id=${id} and organization_id=${ownedOrganizationId}`;
        expected.push({
          id,
          index,
          final_score: finalScore,
          freshness,
          engagement_velocity: engagement,
        });
      }
      await tx`update public.brand_subreddits set status='paused' where brand_id=${brandId} and organization_id=${ownedOrganizationId} and subreddit_id=${subredditId}`;
    });
    for (const [sort, column] of [
      ['score', 'final_score'],
      ['freshness', 'freshness'],
      ['engagement', 'engagement_velocity'],
    ] as const) {
      const query = new URLSearchParams({ brandId, sort, minimumScore: '0' });
      const first = await feed(page, query);
      expect(first.items).toHaveLength(24);
      expect(first.nextCursor).not.toBeNull();
      query.set('cursor', z.string().parse(first.nextCursor));
      const second = await feed(page, query);
      expect(second.items).toHaveLength(6);
      expect(second.nextCursor).toBeNull();
      const items = [...first.items, ...second.items];
      const sorted = [...expected].sort(
        (a, b) => b[column] - a[column] || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
      expect(items.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
      expect(new Set(items.map((item) => item.id)).size).toBe(30);
      expect(
        items.every(
          (item) =>
            item.organization_id === ownedOrganizationId &&
            item.brand_id === brandId &&
            item.subreddit_id === subredditId,
        ),
      ).toBe(true);
    }
    const filters = new URLSearchParams({
      brandId,
      subreddit: subredditId,
      q: 'alpha',
      from: filterDate,
      to: filterDate,
      intent: 'recommendation',
      risk: 'low',
      status: 'new',
      minimumScore: '80',
      competitorId,
      sort: 'score',
    });
    const filtered = await feed(page, filters);
    const expectedFiltered = expected
      .filter((item) => item.index % 2 === 0 && item.index % 3 !== 0 && item.final_score >= 80)
      .sort((a, b) => b.final_score - a.final_score || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    expect(expectedFiltered.length).toBeGreaterThan(0);
    expect(filtered.items.map((item) => item.id)).toEqual(expectedFiltered.map((item) => item.id));
    expect(filtered.nextCursor).toBeNull();
    expect(
      filtered.items.every(
        (item) =>
          item.post.title.includes('alpha') &&
          item.post.created_at_provider.startsWith(filterDate) &&
          item.matched_competitor_ids.includes(competitorId),
      ),
    ).toBe(true);
    const mismatch = await feed(
      page,
      new URLSearchParams({ brandId, subreddit: randomUUID(), minimumScore: '0' }),
    );
    expect(mismatch.items).toEqual([]);
    expect(mismatch.nextCursor).toBeNull();
  } finally {
    try {
      if (organizationId)
        await sql`delete from public.organizations where id=${organizationId} and slug=${identity.slug}`;
      await sql`delete from public.subreddits where id=${subredditId} and name=${communityName}`;
      await sql`delete from auth.users where email=${identity.email}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
});
