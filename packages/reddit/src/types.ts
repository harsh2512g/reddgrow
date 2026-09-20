import { z } from 'zod';
export const subredditNameSchema = z
  .string()
  .trim()
  .regex(/^(?:[a-zA-Z0-9_]{2,21}|ArtificialIntelligence)$/i);
export const subredditSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  name: subredditNameSchema,
  displayTitle: z.string().max(500),
  description: z.string().max(10000),
  isNsfw: z.boolean(),
  subscriberCount: z.number().int().nonnegative().nullable().default(null),
  metadata: z
    .record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
    .default({}),
});
export const ruleSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(500),
  description: z.string().max(10000),
  kind: z.string().max(100).default('all'),
  appliesTo: z.string().max(100).default('all'),
});
export const redditPermalinkSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['www.reddit.com', 'reddit.com', 'old.reddit.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/r\/(?:[a-zA-Z0-9_]{2,21}|ArtificialIntelligence)\/comments\/[a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_-]*)?\/?$/i.test(
        url.pathname,
      )
    );
  }, 'Invalid Reddit post permalink');
export const postSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_]{1,64}$/),
  subreddit: subredditNameSchema,
  permalink: redditPermalinkSchema,
  title: z.string().max(1000),
  body: z.string().max(50000),
  createdAt: z.iso.datetime(),
  score: z.number().int(),
  commentCount: z.number().int().nonnegative(),
  authorName: z.string().max(100).nullable().default(null),
  upvoteRatio: z.number().min(0).max(1).nullable().default(null),
  flair: z.string().max(200).nullable().default(null),
  isNsfw: z.boolean(),
  isLocked: z.boolean(),
  isArchived: z.boolean(),
  isDeleted: z.boolean(),
  isEdited: z.boolean().default(false),
  metadata: z
    .record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
    .default({}),
});
export const postPageSchema = z.object({
  posts: z.array(postSchema).max(100),
  after: z.string().max(100).nullable(),
});
export const listPostsSchema = z.object({
  subreddit: subredditNameSchema,
  sort: z.enum(['new', 'hot', 'rising']),
  after: z
    .string()
    .regex(/^[a-zA-Z0-9_]{1,100}$/)
    .optional(),
  limit: z.number().int().min(1).max(100),
});
export type SubredditSearchResult = z.infer<typeof subredditSchema>;
export type SubredditDetails = SubredditSearchResult;
export type SubredditRule = z.infer<typeof ruleSchema>;
export type RedditPost = z.infer<typeof postSchema>;
export type RedditPostPage = z.infer<typeof postPageSchema>;
export type ListPostsInput = z.infer<typeof listPostsSchema>;
/** No posting, voting, messaging, account creation, or password methods. */
export interface RedditProvider {
  readonly mode: 'mock' | 'oauth';
  searchSubreddits(query: string): Promise<SubredditSearchResult[]>;
  getSubreddit(name: string): Promise<SubredditDetails>;
  getSubredditRules(name: string): Promise<SubredditRule[]>;
  listPosts(input: ListPostsInput): Promise<RedditPostPage>;
  getPostById(id: string): Promise<RedditPost | null>;
}
