import { describe, expect, it, vi } from 'vitest';
import { OAuthRedditProvider, createRedditProvider } from '../src/index.js';
const config = {
  commercialApprovalConfirmed: true,
  clientId: 'synthetic_client',
  clientSecret: 'synthetic_test_secret',
  userAgent: 'web:threadsignal:v0.1.0 (by /u/synthetic_owner)',
};
const token = { access_token: 'synthetic_token', token_type: 'bearer', expires_in: 3600 };
const community = {
  name: 't5_saas',
  display_name: 'SaaS',
  title: 'Software discussions',
  public_description: 'A synthetic API response',
  subscribers: 10,
  over18: false,
};
const post = {
  id: 'abc123',
  subreddit: 'SaaS',
  permalink: '/r/SaaS/comments/abc123/sample/',
  title: 'A synthetic post',
  selftext: 'Synthetic request for an API recommendation',
  created_utc: 1789473600,
  score: 10,
  num_comments: 2,
  over_18: false,
  locked: false,
  archived: false,
  author: 'unneeded_identity',
  edited: false,
};
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init);
const listing = (data: unknown, after: string | null = null) => ({
  data: { children: [{ data }], after },
});
describe('approved read-only OAuth adapter with injected transport', () => {
  it('fails before network access without exact approval, secrets and truthful user agent', () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const changes of [
      { commercialApprovalConfirmed: false },
      { clientSecret: '' },
      { userAgent: 'browser' },
      { userAgent: 'web:other:v1 (by /u/test)' },
      { clientId: 'x:y' },
    ])
      expect(() => new OAuthRedditProvider({ ...config, ...changes, fetch })).toThrow(
        'APPROVAL_REQUIRED',
      );
    expect(() => createRedditProvider('oauth')).toThrow('APPROVAL_REQUIRED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses application-only tokens, fixed API endpoints, read scope and no redirects', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json({ data: community }))
      .mockResolvedValueOnce(json(listing(community)));
    const provider = new OAuthRedditProvider({ ...config, fetch });
    expect((await provider.getSubreddit('SaaS')).subscriberCount).toBe(10);
    expect((await provider.searchSubreddits('software'))[0]?.name).toBe('SaaS');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://www.reddit.com/api/v1/access_token');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: 'grant_type=client_credentials&scope=read',
      redirect: 'error',
    });
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      'https://oauth.reddit.com/r/SaaS/about?raw_json=1',
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'GET',
      headers: { Authorization: 'Bearer synthetic_token', 'User-Agent': config.userAgent },
      redirect: 'error',
    });
    for (const [, request] of fetch.mock.calls) expect(request?.signal).toBeInstanceOf(AbortSignal);
  });
  it('validates normalized pagination, strips unnecessary authors, and purges deleted contents', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(json(listing(post, 't3_def456')))
      .mockResolvedValueOnce(
        json(listing({ ...post, selftext: '[removed]', removed_by_category: 'moderator' })),
      );
    const provider = new OAuthRedditProvider({ ...config, fetch });
    const first = await provider.listPosts({ subreddit: 'SaaS', sort: 'new', limit: 10 });
    expect(first.after).toBe('t3_def456');
    expect(first.posts[0]?.authorName).toBeNull();
    const deleted = await provider.getPostById('abc123');
    expect(deleted).toMatchObject({
      isDeleted: true,
      title: '',
      body: '',
      authorName: null,
      flair: null,
      metadata: {},
    });
  });
  it('refuses invalid subreddit names and cursors before network calls', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = new OAuthRedditProvider({ ...config, fetch });
    await expect(provider.getSubreddit('../api/submit')).rejects.toThrow();
    await expect(
      provider.listPosts({
        subreddit: 'SaaS',
        sort: 'new',
        limit: 10,
        after: 'https://evil.example',
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses hostile post links and wrong-community responses without fallback', async () => {
    for (const changes of [
      { permalink: 'https://example.com/r/SaaS/comments/abc123' },
      { subreddit: 'webdev' },
    ]) {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(json(token))
        .mockResolvedValueOnce(json(listing({ ...post, ...changes })));
      await expect(
        new OAuthRedditProvider({ ...config, fetch }).listPosts({
          subreddit: 'SaaS',
          sort: 'new',
          limit: 10,
        }),
      ).rejects.toThrow('INVALID_RESPONSE');
      expect(fetch).toHaveBeenCalledTimes(2);
    }
  });
  it('defers requests according to rate limit headers and resumes after the reset', async () => {
    let now = new Date('2026-09-15T12:00:00Z');
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(
        json(
          { data: community },
          { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '120' } },
        ),
      )
      .mockResolvedValueOnce(json({ data: community }));
    const provider = new OAuthRedditProvider({ ...config, fetch, now: () => now });
    await provider.getSubreddit('SaaS');
    await expect(provider.getSubreddit('SaaS')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAt: '2026-09-15T12:02:00.000Z',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    now = new Date('2026-09-15T12:02:01Z');
    await provider.getSubreddit('SaaS');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('honors HTTP Retry-After without busy-looping or retrying earlier', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json(token))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '90' } }));
    const provider = new OAuthRedditProvider({
      ...config,
      fetch,
      now: () => new Date('2026-09-15T12:00:00Z'),
    });
    await expect(provider.getSubreddit('SaaS')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAt: '2026-09-15T12:01:30.000Z',
    });
    await expect(provider.getSubreddit('SaaS')).rejects.toThrow('RATE_LIMITED');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('pauses permanently after three authorization failures until configuration is reviewed', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => new Response(null, { status: 401 }));
    const provider = new OAuthRedditProvider({ ...config, fetch });
    for (let i = 0; i < 4; i++)
      await expect(provider.getSubreddit('SaaS')).rejects.toThrow(
        i < 2 ? 'AUTHORIZATION_FAILED' : 'PROVIDER_PAUSED',
      );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(provider.health.paused).toBe(true);
  });
  it('caps transient retries and sanitizes transport errors', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error('sensitive transport detail'));
    const sleep = vi.fn(async () => undefined);
    await expect(
      new OAuthRedditProvider({ ...config, fetch, sleep }).getSubreddit('SaaS'),
    ).rejects.toThrow(/^UNAVAILABLE$/);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
  });
  it('caps response bytes even when content length is missing', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2_000_001));
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
    await expect(
      new OAuthRedditProvider({ ...config, fetch }).getSubreddit('SaaS'),
    ).rejects.toThrow('INVALID_RESPONSE');
    expect(cancel).toHaveBeenCalled();
  });
  it('single-flights token retrieval for concurrent read requests', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url) =>
        String(url).includes('access_token') ? json(token) : json({ data: community }),
      );
    const provider = new OAuthRedditProvider({ ...config, fetch });
    await Promise.all([provider.getSubreddit('SaaS'), provider.getSubreddit('SaaS')]);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('access_token'))).toHaveLength(
      1,
    );
  });
});
