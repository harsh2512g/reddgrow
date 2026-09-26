import { z } from 'zod';
declare const __THREADSIGNAL_EXTENSION_DEPLOYMENT__: boolean | undefined;

export type RedditLocation = {
  postId: string;
  subreddit: string;
  commentId: string | null;
  canonicalUrl: string;
};
/** Parse identifiers only. This function never fetches or scrapes Reddit. */
export function normalizeRedditUrl(
  input: string,
  options: { allowFixture?: boolean } = {},
): RedditLocation | null {
  if (input.length > 2048 || /[\s\\]/.test(input)) return null;
  try {
    const url = new URL(input);
    // A deployment artifact removes local fixture authority at bundle time.
    let allowFixture = false;
    let fixture = false;
    if (
      typeof __THREADSIGNAL_EXTENSION_DEPLOYMENT__ === 'undefined' ||
      !__THREADSIGNAL_EXTENSION_DEPLOYMENT__
    ) {
      allowFixture = options.allowFixture ?? false;
      fixture =
        allowFixture &&
        url.origin === 'http://127.0.0.1:3000' &&
        url.pathname.startsWith('/extension-fixture/reddit/');
    }
    if (url.username || url.password || (url.port && !fixture)) return null;
    if (
      !fixture &&
      (url.protocol !== 'https:' || !/^(www\.|old\.|new\.)?reddit\.com$/.test(url.hostname))
    )
      return null;
    const path = fixture ? url.pathname.slice('/extension-fixture/reddit'.length) : url.pathname;
    const match =
      /^\/r\/([A-Za-z0-9_]{2,21}|artificialintelligence)\/comments\/([A-Za-z0-9_]{1,40})(?:\/[^/]+)?(?:\/([A-Za-z0-9_]{1,40}))?\/?$/i.exec(
        path,
      );
    if (!match) return null;
    const subreddit = match[1]!.toLowerCase();
    const rawPostId = match[2]!.toLowerCase();
    // The original local provider used fixture_001 as its ID and fixture001 in
    // permalinks. Reconcile this synthetic alias only in explicitly local mode.
    const postId = allowFixture ? rawPostId.replace(/^fixture_?(\d{3})$/, 'fixture_$1') : rawPostId;
    const commentId = match[3]?.toLowerCase() ?? null;
    if (
      !allowFixture &&
      (!/^[a-z0-9]+$/.test(postId) || (commentId && !/^[a-z0-9]+$/.test(commentId)))
    )
      return null;
    return {
      subreddit,
      postId,
      commentId,
      canonicalUrl: `https://www.reddit.com/r/${subreddit}/comments/${postId}/thread/${commentId ? `${commentId}/` : ''}`,
    };
  } catch {
    return null;
  }
}

const text = z.string().max(12000);
const date = z.string().datetime({ offset: true });
const version = z.number().int().positive();
export const codeSchema = z.string().regex(/^tsc_[A-Za-z0-9_-]{43}$/);
export const tokenSchema = z.string().regex(/^tse_[A-Za-z0-9_-]{43}$/);
export const extensionSessionSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  name: z.string().max(80),
  created_at: date,
  last_used_at: date.nullable(),
  expires_at: date,
  revoked_at: date.nullable(),
});
export const exchangeResponseSchema = z.object({
  token: tokenSchema,
  session: z.object({
    id: z.uuid(),
    organizationId: z.uuid(),
    organizationName: z.string(),
    name: z.string(),
    expiresAt: date,
  }),
});
export const provenanceSchema = z.object({
  chunk_id: z.uuid(),
  source_id: z.uuid(),
  document_id: z.uuid(),
  title: text,
  source_url: z.string().max(2048).nullable(),
  filename: z.string().nullable(),
  page_number: z.number().nullable(),
  section_heading: z.string().nullable(),
  updated_at: date,
  excerpt: text,
});
export const currentResponseSchema = z.object({
  organization_id: z.uuid(),
  organization_name: z.string(),
  opportunity: z
    .object({
      id: z.uuid(),
      brand_id: z.uuid(),
      brand_name: z.string(),
      title: text,
      summary: text,
      final_score: z.coerce.number().min(0).max(100),
      risk_level: z.enum(['low', 'medium', 'high', 'blocked']),
      permalink: z.string().max(2048),
      subreddit: z.string(),
      post_id: z.string(),
    })
    .nullable(),
  draft: z
    .object({
      id: z.uuid(),
      version,
      content: text,
      strategy: z.string(),
      approved_at: date,
      disclosure_included: z.boolean(),
      compliance_status: z.string(),
      inserted_at: date.nullable(),
      inserted_version: version.nullable(),
      published_at: date.nullable(),
      published_version: version.nullable(),
      published_comment_url: z.string().max(2048).nullable(),
    })
    .nullable(),
  rules: z.array(z.object({ title: text, description: text })).max(100),
  claims: z
    .array(
      z.object({
        claim_text: text,
        status: z.string(),
        explanation: text,
        provenance: z.array(provenanceSchema).max(100),
      }),
    )
    .max(500),
  draft_unavailable_reason: z.string().nullable().default(null),
});
export const handoffResponseSchema = z.object({ content: text, version });
export const editInputSchema = z
  .object({ expectedVersion: version, content: text.min(1).refine((v) => v.trim().length > 0) })
  .strict();
export const handoffInputSchema = z
  .object({ expectedVersion: version, redditUrl: z.string().max(2048) })
  .strict();
export const publicationInputSchema = z
  .object({
    expectedVersion: version,
    commentUrl: z.string().max(2048),
    confirmed: z.literal(true),
  })
  .strict();
export type ExtensionCurrent = z.infer<typeof currentResponseSchema>;
export type ExtensionSession = z.infer<typeof extensionSessionSchema>;
