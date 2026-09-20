import { describe, expect, it } from 'vitest';
import { normalizeRedditUrl } from '../src/index';

describe('Reddit identifier normalization', () => {
  it('reconciles legacy synthetic permalink aliases only in explicit local mode', () => {
    const url = 'https://www.reddit.com/r/SaaS/comments/fixture001/title/abc123/';
    expect(normalizeRedditUrl(url)?.postId).toBe('fixture001');
    expect(normalizeRedditUrl(url, { allowFixture: true })).toEqual({
      subreddit: 'saas',
      postId: 'fixture_001',
      commentId: 'abc123',
      canonicalUrl: 'https://www.reddit.com/r/saas/comments/fixture_001/thread/abc123/',
    });
  });
  it('normalizes supported hosts, case, query, fragment and comment permalinks', () => {
    for (const host of ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com']) {
      expect(
        normalizeRedditUrl(`https://${host}/r/SaaS/comments/Ab123/title/Cd456/?context=3#reply`),
      ).toEqual({
        subreddit: 'saas',
        postId: 'ab123',
        commentId: 'cd456',
        canonicalUrl: 'https://www.reddit.com/r/saas/comments/ab123/thread/cd456/',
      });
    }
  });
  it.each([
    'http://reddit.com/r/saas/comments/abc/thread',
    'https://reddit.com.evil.test/r/saas/comments/abc/thread',
    'https://u:p@reddit.com/r/saas/comments/abc/thread',
    'https://www.reddit.com:444/r/saas/comments/abc/thread',
    'https://reddit.com/r/saas/comments/abc/thread/comment/extra',
    'https://reddit.com/r/saas/comments/%61bc/thread',
    'https://reddit.com/r/saas/comments/fixture_001/thread',
    'http://127.0.0.1:3000/app/drafts',
    'javascript:alert(1)',
  ])('rejects unrelated/malformed URL %s', (input) => {
    expect(normalizeRedditUrl(input)).toBeNull();
  });
  it('requires explicit fixture mode and the exact local fixture route', () => {
    const url =
      'http://127.0.0.1:3000/extension-fixture/reddit/r/SaaS/comments/fixture_001/fixture';
    expect(normalizeRedditUrl(url)).toBeNull();
    expect(normalizeRedditUrl(url, { allowFixture: true })?.postId).toBe('fixture_001');
    expect(
      normalizeRedditUrl('http://127.0.0.1:3000/r/SaaS/comments/abc/thread', {
        allowFixture: true,
      }),
    ).toBeNull();
  });
});
