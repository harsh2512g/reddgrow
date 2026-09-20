import { measuredProviderRequest } from '@threadsignal/shared';
import { z } from 'zod';
import {
  subredditSchema,
  subredditNameSchema,
  ruleSchema,
  postSchema,
  listPostsSchema,
  type RedditProvider,
  type ListPostsInput,
} from './types.js';
export type OAuthRedditOptions = {
  commercialApprovalConfirmed: boolean;
  clientId: string;
  clientSecret: string;
  userAgent: string;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};
const configSchema = z.object({
  commercialApprovalConfirmed: z.literal(true),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{4,200}$/),
  clientSecret: z
    .string()
    .min(8)
    .max(500)
    .regex(/^[\x21-\x7e]+$/),
  userAgent: z
    .string()
    .max(200)
    .regex(/^web:threadsignal:v[0-9][A-Za-z0-9._-]* \(by \/u\/[A-Za-z0-9_-]{3,20}\)$/),
});
export class RedditProviderError extends Error {
  constructor(
    readonly code:
      | 'APPROVAL_REQUIRED'
      | 'INVALID_RESPONSE'
      | 'UNAVAILABLE'
      | 'AUTHORIZATION_FAILED'
      | 'PROVIDER_PAUSED'
      | 'RATE_LIMITED'
      | 'NOT_FOUND',
    readonly retryAt?: string,
  ) {
    super(code);
    this.name = 'RedditProviderError';
  }
}
const listingSchema = z.object({
  data: z.object({
    children: z.array(z.object({ data: z.unknown() })).max(100),
    after: z.string().max(100).nullable().optional(),
  }),
});
const communityInput = z.object({
  name: z.string().max(100),
  display_name: subredditNameSchema,
  title: z.string().max(500),
  public_description: z.string().max(10000).default(''),
  over18: z.boolean().default(false),
  subscribers: z.number().int().nonnegative().nullable().optional(),
});
const postInput = z.object({
  id: z.string().regex(/^[a-z0-9]{1,32}$/),
  subreddit: subredditNameSchema,
  permalink: z.string().max(2048),
  title: z.string().max(1000),
  selftext: z.string().max(50000).default(''),
  created_utc: z.number().finite().nonnegative(),
  score: z.number().int(),
  num_comments: z.number().int().nonnegative(),
  over_18: z.boolean(),
  locked: z.boolean(),
  archived: z.boolean(),
  author: z.string().max(100).nullable().optional(),
  upvote_ratio: z.number().min(0).max(1).nullable().optional(),
  link_flair_text: z.string().max(200).nullable().optional(),
  edited: z.union([z.boolean(), z.number()]).default(false),
  removed_by_category: z.string().nullable().optional(),
});
function parseResult<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RedditProviderError('INVALID_RESPONSE');
  return parsed.data;
}
function community(value: unknown) {
  const item = parseResult(communityInput, value);
  return parseResult(subredditSchema, {
    id: item.name,
    name: item.display_name,
    displayTitle: item.title,
    description: item.public_description,
    isNsfw: item.over18,
    subscriberCount: item.subscribers ?? null,
  });
}
function post(value: unknown) {
  const item = parseResult(postInput, value);
  if (
    !URL.canParse(item.permalink, 'https://www.reddit.com') ||
    !Number.isFinite(new Date(item.created_utc * 1000).getTime())
  )
    throw new RedditProviderError('INVALID_RESPONSE');
  const deleted =
    item.selftext === '[deleted]' ||
    item.selftext === '[removed]' ||
    Boolean(item.removed_by_category);
  // Discard identifying/content fields before returning a deleted provider item.
  return parseResult(postSchema, {
    id: item.id,
    subreddit: item.subreddit,
    permalink: new URL(item.permalink, 'https://www.reddit.com').toString(),
    title: deleted ? '' : item.title,
    body: deleted ? '' : item.selftext,
    createdAt: new Date(item.created_utc * 1000).toISOString(),
    score: item.score,
    commentCount: item.num_comments,
    authorName: null,
    upvoteRatio: item.upvote_ratio ?? null,
    flair: deleted ? null : (item.link_flair_text ?? null),
    isNsfw: item.over_18,
    isLocked: item.locked,
    isArchived: item.archived,
    isDeleted: deleted,
    isEdited: Boolean(item.edited),
  });
}
/** Application-only OAuth; no customer Reddit account or password is involved. */
export class OAuthRedditProvider implements RedditProvider {
  readonly mode = 'oauth';
  private readonly config: z.infer<typeof configSchema>;
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private token: { value: string; expiresAt: number } | undefined;
  private tokenRequest: Promise<string> | undefined;
  private failures = 0;
  private nextRequestAt = 0;
  private remaining: number | null = null;
  constructor(options: OAuthRedditOptions) {
    const parsed = configSchema.safeParse(options);
    if (!parsed.success) throw new RedditProviderError('APPROVAL_REQUIRED');
    this.config = parsed.data;
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  get health() {
    return {
      paused: this.failures >= 3,
      remaining: this.remaining,
      nextRequestAt: this.nextRequestAt ? new Date(this.nextRequestAt).toISOString() : null,
    };
  }
  private guard() {
    if (this.failures >= 3) throw new RedditProviderError('PROVIDER_PAUSED');
    if (this.nextRequestAt > this.now().getTime())
      throw new RedditProviderError('RATE_LIMITED', new Date(this.nextRequestAt).toISOString());
  }
  private async json(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new RedditProviderError('INVALID_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2_000_000) throw new RedditProviderError('INVALID_RESPONSE');
        chunks.push(part.value);
      }
      return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    } catch {
      throw new RedditProviderError('INVALID_RESPONSE');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  private async fetchJson(
    url: URL,
    headers: Record<string, string>,
    body?: string,
  ): Promise<unknown> {
    // Every caller constructs a fixed documented endpoint; never follow a response URL.
    if (
      url.origin !== 'https://oauth.reddit.com' &&
      url.href !== 'https://www.reddit.com/api/v1/access_token'
    )
      throw new RedditProviderError('UNAVAILABLE');
    for (let attempt = 0; attempt < 3; attempt++) {
      this.guard();
      let response: Response;
      try {
        response = await measuredProviderRequest('reddit', () =>
          this.request(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers,
            ...(body === undefined ? {} : { body }),
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          }),
        );
      } catch {
        if (attempt < 2) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
        throw new RedditProviderError('UNAVAILABLE');
      }
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const resetHeader = response.headers.get('x-ratelimit-reset');
      if (remainingHeader !== null && Number.isFinite(Number(remainingHeader)))
        this.remaining = Math.max(0, Number(remainingHeader));
      if (this.remaining === 0 && resetHeader !== null && Number.isFinite(Number(resetHeader)))
        this.nextRequestAt =
          this.now().getTime() + Math.max(1, Math.min(86400, Number(resetHeader))) * 1000;
      if (response.status === 401 || response.status === 403) {
        this.failures++;
        this.token = undefined;
        await response.body?.cancel();
        throw new RedditProviderError(
          this.failures >= 3 ? 'PROVIDER_PAUSED' : 'AUTHORIZATION_FAILED',
        );
      }
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds =
          retry && /^\d+(?:\.\d+)?$/.test(retry)
            ? Number(retry)
            : retry
              ? (Date.parse(retry) - this.now().getTime()) / 1000
              : 60;
        this.nextRequestAt = Math.max(
          this.nextRequestAt,
          this.now().getTime() +
            Math.max(1, Math.min(86400, Number.isFinite(seconds) ? seconds : 60)) * 1000,
        );
        await response.body?.cancel();
        throw new RedditProviderError('RATE_LIMITED', new Date(this.nextRequestAt).toISOString());
      }
      if (response.status === 404) {
        await response.body?.cancel();
        throw new RedditProviderError('NOT_FOUND');
      }
      if (response.status >= 500 && attempt < 2) {
        await response.body?.cancel();
        await this.sleep(250 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new RedditProviderError('UNAVAILABLE');
      }
      const result = await this.json(response);
      if (url.origin === 'https://oauth.reddit.com') this.failures = 0;
      return result;
    }
    throw new RedditProviderError('UNAVAILABLE');
  }
  private async accessToken() {
    this.guard();
    if (this.token && this.token.expiresAt > this.now().getTime() + 30000) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const result = parseResult(
        z.object({
          access_token: z.string().min(1).max(4096),
          token_type: z.literal('bearer'),
          expires_in: z.number().min(1).max(86400),
        }),
        await this.fetchJson(
          new URL('https://www.reddit.com/api/v1/access_token'),
          {
            Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
            'User-Agent': this.config.userAgent,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          new URLSearchParams({ grant_type: 'client_credentials', scope: 'read' }).toString(),
        ),
      );
      this.token = {
        value: result.access_token,
        expiresAt: this.now().getTime() + result.expires_in * 1000,
      };
      return result.access_token;
    })();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = undefined;
    }
  }
  private async api(path: string, query: Record<string, string> = {}) {
    const url = new URL(path, 'https://oauth.reddit.com');
    for (const [key, value] of Object.entries({ raw_json: '1', ...query }))
      url.searchParams.set(key, value);
    return this.fetchJson(url, {
      Authorization: `Bearer ${await this.accessToken()}`,
      'User-Agent': this.config.userAgent,
    });
  }
  async searchSubreddits(query: string) {
    const term = z.string().trim().min(1).max(100).parse(query);
    const result = parseResult(
      listingSchema,
      await this.api('/subreddits/search', { q: term, limit: '25', include_over_18: 'off' }),
    );
    return result.data.children.map((item) => community(item.data)).filter((item) => !item.isNsfw);
  }
  async getSubreddit(name: string) {
    const result = parseResult(
      z.object({ data: z.unknown() }),
      await this.api(`/r/${subredditNameSchema.parse(name)}/about`),
    );
    const details = community(result.data);
    if (details.name.toLowerCase() !== name.toLowerCase())
      throw new RedditProviderError('INVALID_RESPONSE');
    return details;
  }
  async getSubredditRules(name: string) {
    const result = parseResult(
      z.object({
        rules: z
          .array(
            z.object({
              short_name: z.string().max(100),
              description: z.string().max(10000),
              kind: z.string().max(100).default('all'),
              priority: z.number().int().optional(),
            }),
          )
          .max(100),
      }),
      await this.api(`/r/${subredditNameSchema.parse(name)}/about/rules`),
    );
    return result.rules.map((item) =>
      ruleSchema.parse({
        id: item.short_name,
        title: item.short_name,
        description: item.description,
        kind: item.kind,
        appliesTo: item.kind,
      }),
    );
  }
  async listPosts(input: ListPostsInput) {
    const request = listPostsSchema.parse(input);
    if (request.after && !/^t3_[a-z0-9]+$/.test(request.after))
      throw new RedditProviderError('INVALID_RESPONSE');
    const result = parseResult(
      listingSchema,
      await this.api(`/r/${request.subreddit}/${request.sort}`, {
        limit: String(request.limit),
        ...(request.after ? { after: request.after } : {}),
      }),
    );
    const posts = result.data.children.map((item) => post(item.data));
    if (posts.some((item) => item.subreddit.toLowerCase() !== request.subreddit.toLowerCase()))
      throw new RedditProviderError('INVALID_RESPONSE');
    const after = result.data.after ?? null;
    if (after !== null && !/^t3_[a-z0-9]+$/.test(after))
      throw new RedditProviderError('INVALID_RESPONSE');
    return { posts, after };
  }
  async getPostById(id: string) {
    const bare = z
      .string()
      .regex(/^(?:t3_)?[a-z0-9]{1,32}$/)
      .parse(id)
      .replace(/^t3_/, '');
    const result = parseResult(listingSchema, await this.api('/api/info', { id: `t3_${bare}` }));
    if (!result.data.children.length) return null;
    const found = post(result.data.children[0]?.data);
    if (found.id !== bare) throw new RedditProviderError('INVALID_RESPONSE');
    return found;
  }
}
