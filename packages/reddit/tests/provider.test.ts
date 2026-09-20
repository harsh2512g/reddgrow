import { describe, expect, it } from 'vitest';
import {
  createRedditProvider,
  createMockPosts,
  mockCommunities,
  subredditNameSchema,
} from '../src/index.js';

describe('read-only Reddit fixture provider', () => {
  it('provides fresh deterministic fixtures with all four communities, deletion and an exact content duplicate', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const posts = createMockPosts(now);
    expect(posts).toEqual(createMockPosts(now));
    expect(posts).toHaveLength(26);
    expect(new Set(posts.map((post) => post.id)).size).toBe(26);
    expect(mockCommunities.map((item) => item.name)).toEqual([
      'SaaS',
      'webdev',
      'ecommerce',
      'ArtificialIntelligence',
    ]);
    const original = posts.find((post) => post.id === 'fixture_001')!;
    const duplicate = posts.find((post) => post.id === 'fixture_026')!;
    expect([duplicate.title, duplicate.body]).toEqual([original.title, original.body]);
    expect(posts.find((post) => post.isDeleted)).toMatchObject({
      title: '',
      body: '',
      authorName: null,
    });
    expect(subredditNameSchema.safeParse('ArtificialIntelligence').success).toBe(true);
    expect(subredditNameSchema.safeParse('x'.repeat(22)).success).toBe(false);
  });
  it('paginates deterministically without repeating posts', async () => {
    const provider = createRedditProvider();
    const first = await provider.listPosts({ subreddit: 'SaaS', sort: 'new', limit: 1 });
    expect(first.after).not.toBeNull();
    const second = await provider.listPosts({
      subreddit: 'SaaS',
      sort: 'new',
      limit: 1,
      ...(first.after ? { after: first.after } : {}),
    });
    expect(second.posts[0]?.id).not.toBe(first.posts[0]?.id);
    const identifiers = new Set(first.posts.map((post) => post.id));
    let page = second;
    for (;;) {
      for (const post of page.posts) {
        expect(identifiers.has(post.id)).toBe(false);
        identifiers.add(post.id);
      }
      if (!page.after) break;
      page = await provider.listPosts({
        subreddit: 'SaaS',
        sort: 'new',
        after: page.after,
        limit: 1,
      });
    }
    expect(identifiers.size).toBeGreaterThanOrEqual(7);
  });

  it('protects fixture data from caller mutation', async () => {
    const provider = createRedditProvider();
    const first = await provider.getPostById('fixture_001');
    if (first) first.title = 'mutated';
    expect((await provider.getPostById('fixture_001'))?.title).not.toBe('mutated');
    expect(await provider.getPostById('missing')).toBeNull();
  });

  it('rejects invalid cursors and unknown communities', async () => {
    const provider = createRedditProvider();
    await expect(
      provider.listPosts({ subreddit: 'SaaS', sort: 'new', after: 'fixture_999', limit: 1 }),
    ).rejects.toThrow('Invalid fixture');
    await expect(provider.getSubreddit('unknown')).rejects.toThrow('not found');
  });

  it('has no posting, voting, or messaging capability and denies external selection', () => {
    const provider = createRedditProvider();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(provider));
    expect(methods.sort()).toEqual(
      [
        'constructor',
        'getPostById',
        'getSubreddit',
        'getSubredditRules',
        'listPosts',
        'searchSubreddits',
      ].sort(),
    );
    expect(() => createRedditProvider('oauth')).toThrow('APPROVAL_REQUIRED');
  });
});
