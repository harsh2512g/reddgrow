import { z } from 'zod';
import { mockCommunities, mockCommunityRules, createMockPosts } from './fixtures.js';
import {
  subredditNameSchema,
  listPostsSchema,
  type RedditProvider,
  type RedditPost,
  type ListPostsInput,
} from './types.js';
export type MockRedditOptions = { now?: () => Date };
export class MockRedditProvider implements RedditProvider {
  readonly mode = 'mock';
  private readonly posts: RedditPost[];
  constructor(options: MockRedditOptions = {}) {
    this.posts = createMockPosts((options.now ?? (() => new Date()))());
  }
  async searchSubreddits(query: string) {
    const term = z.string().trim().max(100).parse(query).toLowerCase();
    return structuredClone(
      mockCommunities.filter((item) =>
        `${item.name} ${item.displayTitle} ${item.description}`.toLowerCase().includes(term),
      ),
    );
  }
  async getSubreddit(name: string) {
    const normalized = subredditNameSchema.parse(name).toLowerCase();
    const community = mockCommunities.find((item) => item.name.toLowerCase() === normalized);
    if (!community) throw new Error('Synthetic community not found.');
    return structuredClone(community);
  }
  async getSubredditRules(name: string) {
    return mockCommunityRules((await this.getSubreddit(name)).name);
  }
  async listPosts(input: ListPostsInput) {
    const request = listPostsSchema.parse(input);
    await this.getSubreddit(request.subreddit);
    const ordered = this.posts
      .filter((post) => post.subreddit.toLowerCase() === request.subreddit.toLowerCase())
      .sort(
        request.sort === 'new'
          ? (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
          : (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      );
    const previous = request.after ? ordered.findIndex((post) => post.id === request.after) : -1;
    if (request.after && previous < 0) throw new Error('Invalid fixture pagination cursor.');
    const selected = ordered.slice(previous + 1, previous + 1 + request.limit);
    return {
      posts: structuredClone(selected),
      after: previous + 1 + selected.length < ordered.length ? (selected.at(-1)?.id ?? null) : null,
    };
  }
  async getPostById(id: string) {
    const parsed = z
      .string()
      .regex(/^[a-zA-Z0-9_]{1,64}$/)
      .parse(id);
    return structuredClone(this.posts.find((post) => post.id === parsed) ?? null);
  }
}
