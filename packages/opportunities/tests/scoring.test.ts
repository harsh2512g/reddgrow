import { describe, expect, it } from 'vitest';
import { createMockPosts, mockCommunityRules } from '@threadsignal/reddit';
import { demoBrand } from '@threadsignal/knowledge';
import { MockAIProvider } from '@threadsignal/ai';
import {
  evaluateOpportunity,
  freshnessScore,
  engagementScore,
  weightedOpportunityScore,
  previewKeywordMatches,
  suggestKeywords,
  suggestSubreddits,
  type EvaluateOpportunityInput,
} from '../src/scoring.js';
import { scoreLabel, opportunityEvaluationSchema } from '../src/schema.js';
const now = new Date('2026-09-15T12:00:00Z');
const posts = createMockPosts(now);
function input(id = 'fixture_001'): EvaluateOpportunityInput {
  const post = posts.find((item) => item.id === id)!;
  return {
    brand: {
      id: '10000000-0000-4000-8000-000000000001',
      organization_id: '20000000-0000-4000-8000-000000000001',
      profile: demoBrand,
    },
    post,
    rules: mockCommunityRules(post.subreddit),
    keywords: demoBrand.keywords.map((value) => ({
      value,
      kind: 'category',
      is_exclusion: false,
      status: 'active',
    })),
    competitors: demoBrand.competitors.map((item, index) => ({
      ...item,
      id: `30000000-0000-4000-8000-00000000000${index + 1}`,
    })),
    knowledge: [
      {
        id: '40000000-0000-4000-8000-000000000001',
        source_id: '50000000-0000-4000-8000-000000000001',
        title: 'Synthetic product source',
        content:
          'ClarityScale supports product photography, image optimization, an image upscaling API and batch processing.',
        source_url: 'https://clarityscale.example/docs',
      },
    ],
    now,
  };
}
describe('deterministic opportunity scoring', () => {
  it.each([
    [0, 100],
    [1, 100],
    [1.001, 90],
    [6, 90],
    [6.001, 75],
    [24, 75],
    [24.001, 50],
    [72, 50],
    [72.001, 25],
    [168, 25],
    [168.001, 10],
  ])('scores %s-hour freshness as %s', (hours, expected) => {
    expect(freshnessScore(new Date(now.getTime() - hours * 3600000).toISOString(), now)).toBe(
      expected,
    );
  });
  it('rejects invalid dates and gives future content no freshness', () => {
    expect(() => freshnessScore('invalid', now)).toThrow();
    expect(freshnessScore(new Date(now.getTime() + 1000).toISOString(), now)).toBe(0);
  });
  it('bounds engagement and declines as the same interactions age', () => {
    const post = input().post;
    expect(engagementScore(post, now)).toBeGreaterThan(
      engagementScore(post, new Date(now.getTime() + 86400000)),
    );
    expect(engagementScore({ ...post, score: -20, commentCount: 0 }, now)).toBe(0);
    expect(engagementScore({ ...post, score: 100000000 }, now)).toBe(100);
    expect(() => engagementScore({ ...post, commentCount: -1 }, now)).toThrow();
  });
  it('uses exact weights, clamps penalties and retains the specified labels', () => {
    const all = {
      semantic_relevance: 100,
      buying_intent: 100,
      freshness: 100,
      engagement_velocity: 100,
      rule_fit: 100,
      competitor_context: 100,
      penalty_score: 0,
    };
    expect(weightedOpportunityScore(all)).toBe(100);
    expect(weightedOpportunityScore({ ...all, penalty_score: 100 })).toBe(0);
    expect(weightedOpportunityScore({ ...all, semantic_relevance: 0 })).toBe(70);
    expect([0, 39.99, 40, 59.99, 60, 79.99, 80, 100].map(scoreLabel)).toEqual([
      'Hidden',
      'Hidden',
      'Low',
      'Low',
      'Medium',
      'Medium',
      'High',
      'High',
    ]);
    expect(() => weightedOpportunityScore({ ...all, semantic_relevance: NaN })).toThrow();
  });
  it.each([
    ['fixture_001', 'High'],
    ['fixture_002', 'Medium'],
    ['fixture_003', 'Low'],
  ])('renders %s as %s with real score components and explanations', async (id, label) => {
    const result = await evaluateOpportunity(input(id));
    expect(result.kind).toBe('scored');
    if (result.kind === 'scored') {
      expect(scoreLabel(result.evaluation.final_score)).toBe(label);
      expect(result.evaluation.reasoning_summary).toContain('Mock lexical');
      expect(result.evaluation.knowledge_citations.length).toBeGreaterThan(0);
      if (label === 'High') expect(result.evaluation.final_score).toBeGreaterThanOrEqual(90);
    }
  });
  it.each(['fixture_010', 'fixture_019', 'fixture_021', 'fixture_022', 'fixture_025'])(
    'hard blocks %s independently of a high relevance score',
    async (id) => {
      const result = await evaluateOpportunity(input(id));
      expect(result.kind).toBe('scored');
      if (result.kind === 'scored')
        expect(result.evaluation).toMatchObject({
          is_blocked: true,
          risk_level: 'blocked',
          suggested_action: 'blocked',
        });
    },
  );
  it.each([
    ['fixture_011', 'too_old'],
    ['fixture_012', 'deleted'],
    ['fixture_016', 'locked'],
    ['fixture_017', 'archived'],
    ['fixture_018', 'nsfw'],
    ['fixture_024', 'insufficient_text'],
  ])('filters %s (%s)', async (id, reason) => {
    expect(await evaluateOpportunity(input(id))).toEqual({ kind: 'filtered', reason });
  });
  it('filters duplicates/unmonitored communities without evaluating and respects paused/excluded terms', async () => {
    expect(await evaluateOpportunity({ ...input(), duplicate: true })).toEqual({
      kind: 'filtered',
      reason: 'duplicate',
    });
    expect(await evaluateOpportunity({ ...input(), communityAllowed: false })).toEqual({
      kind: 'filtered',
      reason: 'unmonitored_community',
    });
    const value = input();
    value.keywords = [
      { value: 'nonmatching term', kind: 'category', is_exclusion: false, status: 'active' },
      { value: 'image optimization', kind: 'category', is_exclusion: false, status: 'paused' },
    ];
    expect(await evaluateOpportunity(value)).toEqual({
      kind: 'filtered',
      reason: 'no_keyword_match',
    });
    value.keywords = [
      { value: 'image optimization', kind: 'exclusion', is_exclusion: true, status: 'active' },
    ];
    expect(await evaluateOpportunity(value)).toEqual({ kind: 'filtered', reason: 'excluded_term' });
  });
  it('produces identical assessments/checksums for identical inputs and records competitor matches', async () => {
    const first = await evaluateOpportunity(input('fixture_004'));
    expect(first).toEqual(await evaluateOpportunity(input('fixture_004')));
    if (first.kind === 'scored')
      expect(first.evaluation.matched_competitor_ids).toEqual([
        '30000000-0000-4000-8000-000000000002',
      ]);
  });
  it('retains matched aliases beyond the first three in bounded assessment context', async () => {
    const value = input();
    value.competitors[1]!.aliases = [
      'Unused Alpha',
      'Unused Beta',
      'Unused Gamma',
      'Legacy Raster',
    ];
    value.post = { ...value.post, body: `${value.post.body} We currently use Legacy Raster.` };
    const result = await evaluateOpportunity(value);
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(result.evaluation.competitor_context).toBe(100);
    expect(result.evaluation.matched_competitor_ids).toContain(value.competitors[1]!.id);
  });
  it('blocks required capabilities contradicted by included knowledge', async () => {
    const value = input();
    value.post = { ...value.post, body: value.post.body + ' We require video processing.' };
    value.knowledge[0]!.content += ' The API does not support video processing.';
    const result = await evaluateOpportunity(value);
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(result.evaluation.is_blocked).toBe(true);
    expect(result.evaluation.missing_capabilities).toContain('Unsupported claim: video processing');
  });
  it('validates provider outputs rather than trusting synthetic or real provider data', async () => {
    await expect(
      evaluateOpportunity(
        input(),
        new MockAIProvider({ 'opportunity.evaluate': { semantic_relevance: 1000 } }),
      ),
    ).rejects.toThrow();
    const result = await evaluateOpportunity(input());
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(() =>
      opportunityEvaluationSchema.parse({ ...result.evaluation, is_blocked: true }),
    ).toThrow();
  });
  it('retains a provider hard block even if its reason list is empty', async () => {
    const initial = await evaluateOpportunity(input());
    if (initial.kind !== 'scored') throw new Error('Expected assessment');
    const result = await evaluateOpportunity(
      input(),
      new MockAIProvider({
        'opportunity.evaluate': {
          ...initial.evaluation,
          risk_level: 'blocked',
          suggested_action: 'blocked',
          risk_reasons: [],
        },
      }),
    );
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(result.evaluation.is_blocked).toBe(true);
    expect(result.evaluation.risk_reasons).toContain(
      'The provider assessment blocks the proposed reply.',
    );
  });
  it('applies the no-vendor penalty and highlights completed choices', async () => {
    const value = input();
    value.post = { ...value.post, body: value.post.body + ' Please no vendor responses.' };
    const result = await evaluateOpportunity(value);
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(result.evaluation.penalty_score).toBe(40);
    const completed = await evaluateOpportunity(input('fixture_023'));
    if (completed.kind === 'scored') expect(completed.evaluation.penalty_score).toBe(15);
  });
  it('offers deterministic brand-specific suggestions and exact normalized phrase previews', async () => {
    expect(await suggestKeywords(demoBrand)).toEqual(await suggestKeywords(demoBrand));
    expect(
      (await suggestKeywords(demoBrand)).some(
        (item) => item.value === 'SharpPixel' && item.source === 'suggested',
      ),
    ).toBe(true);
    expect((await suggestSubreddits(demoBrand)).map((item) => item.name)).toContain('ecommerce');
    const preview = previewKeywordMatches({
      posts: [input().post],
      keywords: [
        { value: 'IMAGE optimization', kind: 'category', is_exclusion: false, status: 'active' },
      ],
    });
    expect(preview[0]?.matched).toBe(true);
    expect(
      previewKeywordMatches({
        posts: [input().post],
        keywords: [{ value: 'api', kind: 'exclusion', is_exclusion: true, status: 'active' }],
      })[0]?.matched,
    ).toBe(false);
  });
  it('supports maximal brand lists without passing unused competitor notes into AI input', async () => {
    const largeProfile = {
      ...demoBrand,
      use_cases: ['x', ...Array.from({ length: 29 }, (_, index) => `${index} ${'a'.repeat(195)}`)],
      keywords: Array.from({ length: 30 }, (_, index) => `${index} ${'b'.repeat(195)}`),
      competitors: Array.from({ length: 20 }, (_, index) => ({
        name: `Competitor ${index}`,
        domain: `https://competitor${index}.example`,
        notes: 'Private research note '.repeat(90),
        aliases: Array.from({ length: 30 }, () => 'a'.repeat(200)),
      })),
    };
    const suggestions = await suggestKeywords(largeProfile);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.value.length >= 2)).toBe(true);
    await expect(suggestSubreddits(largeProfile)).resolves.toHaveLength(3);
  });
  it.each([
    [0, 0],
    [2, 0],
    [3, 9],
    [4, 12],
    [5, 15],
    [1000, 15],
  ])(
    'applies the bounded brand-feedback threshold for %s prior dismissals',
    async (count, penalty) => {
      const baseline = await evaluateOpportunity(input());
      if (baseline.kind !== 'scored') throw new Error('Expected assessment');
      const result = await evaluateOpportunity({
        ...input(),
        dismissalFeedback: [
          {
            subreddit: 'saas',
            intent_category: baseline.evaluation.intent_category,
            reason: 'low_intent',
            count,
          },
        ],
      });
      if (result.kind !== 'scored') throw new Error('Expected assessment');
      expect(result.evaluation.penalty_score).toBe(penalty);
      expect(result.evaluation.final_score).toBeCloseTo(
        baseline.evaluation.final_score - penalty,
        2,
      );
      expect(
        result.evaluation.risk_reasons.some((reason) => reason.startsWith('Brand feedback:')),
      ).toBe(penalty > 0);
    },
  );
  it('ignores feedback for other communities, intents and administrative reasons', async () => {
    const baseline = await evaluateOpportunity(input());
    if (baseline.kind !== 'scored') throw new Error('Expected assessment');
    const result = await evaluateOpportunity({
      ...input(),
      dismissalFeedback: [
        {
          subreddit: 'webdev',
          intent_category: baseline.evaluation.intent_category,
          reason: 'low_intent',
          count: 20,
        },
        { subreddit: 'SaaS', intent_category: 'support', reason: 'not_relevant', count: 20 },
        {
          subreddit: 'SaaS',
          intent_category: baseline.evaluation.intent_category,
          reason: 'duplicate',
          count: 20,
        },
      ],
    });
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(result.evaluation.final_score).toBe(baseline.evaluation.final_score);
    expect(result.evaluation.penalty_score).toBe(0);
  });
  it('validates feedback bounds and never relaxes a hard block', async () => {
    const group = {
      subreddit: 'SaaS',
      intent_category: 'recommendation' as const,
      reason: 'community_risk' as const,
      count: 3,
    };
    await expect(
      evaluateOpportunity({
        ...input(),
        dismissalFeedback: Array.from({ length: 51 }, () => group),
      }),
    ).rejects.toThrow();
    await expect(
      evaluateOpportunity({ ...input(), dismissalFeedback: [{ ...group, count: -1 }] }),
    ).rejects.toThrow();
    await expect(
      evaluateOpportunity({ ...input(), dismissalFeedback: [{ ...group, count: 1.5 }] }),
    ).rejects.toThrow();
    const baseline = await evaluateOpportunity(input('fixture_025'));
    if (baseline.kind !== 'scored') throw new Error('Expected assessment');
    const result = await evaluateOpportunity({
      ...input('fixture_025'),
      dismissalFeedback: [
        {
          ...group,
          intent_category: baseline.evaluation.intent_category,
          count: 20,
        },
      ],
    });
    if (result.kind !== 'scored') throw new Error('Expected assessment');
    expect(result.evaluation).toMatchObject({
      is_blocked: true,
      risk_level: 'blocked',
      suggested_action: 'blocked',
    });
    expect(result.evaluation.final_score).toBeLessThanOrEqual(baseline.evaluation.final_score);
  });
});
