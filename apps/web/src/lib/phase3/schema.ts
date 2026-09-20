import { z } from 'zod';
import {
  opportunityStatusSchema,
  riskLevelSchema,
  intentCategorySchema,
  knowledgeCitationSchema,
} from '@threadsignal/opportunities';

export const idSchema = z.uuid();
export const communitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  subscriber_count: z.coerce.number().nonnegative().nullable(),
  is_nsfw: z.boolean(),
  last_synced_at: z.string().nullable(),
});
export const ruleSchema = z.object({
  id: z.uuid(),
  subreddit_id: z.uuid(),
  title: z.string(),
  description: z.string(),
  last_synced_at: z.string().nullable(),
});
export const monitoringSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  subreddit_id: z.uuid(),
  status: z.enum(['active', 'paused']),
  priority: z.number().int(),
  minimum_score: z.coerce.number(),
  risk_level: riskLevelSchema,
  product_relevance: z.coerce.number().nullable(),
  allowed_reply_style: z.enum(['helpful', 'technical', 'no_links', 'answer_only']),
  internal_notes: z.string(),
  internal_interpretation: z.string(),
  monitor_new: z.boolean(),
  monitor_hot: z.boolean(),
  monitor_rising: z.boolean(),
  subreddit: communitySchema,
  sync: z
    .object({
      paused: z.boolean(),
      failed: z.boolean(),
      last_success_at: z.string().nullable(),
      next_sync_at: z.string(),
    })
    .nullable()
    .default(null),
  assessment: z
    .object({
      count: z.number().int().positive(),
      product_relevance: z.number(),
      risk_level: riskLevelSchema,
    })
    .nullable()
    .default(null),
});
export const keywordRecordSchema = z.object({
  id: z.uuid(),
  brand_id: z.uuid(),
  value: z.string(),
  kind: z.enum([
    'category',
    'problem',
    'recommendation',
    'alternative',
    'competitor',
    'technical',
    'exclusion',
  ]),
  is_exclusion: z.boolean(),
  status: z.enum(['active', 'paused']),
  source: z.enum(['manual', 'suggested']),
});
export const postSchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  body: z.string().nullable().optional(),
  permalink: z.string().nullable(),
  created_at_provider: z.string(),
  score: z.number(),
  num_comments: z.number(),
  is_deleted: z.boolean(),
  is_locked: z.boolean(),
  is_archived: z.boolean(),
});
export const opportunitySchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  subreddit_id: z.uuid(),
  status: opportunityStatusSchema,
  summary: z.string().nullable(),
  user_need: z.string().nullable(),
  intent_category: intentCategorySchema,
  risk_level: riskLevelSchema,
  semantic_relevance: z.coerce.number(),
  buying_intent: z.coerce.number(),
  freshness: z.coerce.number(),
  engagement_velocity: z.coerce.number(),
  rule_fit: z.coerce.number(),
  competitor_context: z.coerce.number(),
  penalty_score: z.coerce.number(),
  final_score: z.coerce.number(),
  suggested_action: z.enum(['reply', 'monitor', 'ignore', 'blocked']),
  is_blocked: z.boolean(),
  risk_reasons: z.array(z.string()),
  matched_capabilities: z.array(z.string()),
  missing_capabilities: z.array(z.string()),
  matched_competitor_ids: z.array(z.uuid()),
  reasoning_summary: z.string().nullable(),
  knowledge_citations: z.array(knowledgeCitationSchema),
  evaluated_at: z.string(),
  created_at: z.string(),
  post: postSchema,
  subreddit: communitySchema,
});
const optionalFilter = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
export const feedFilterSchema = z
  .object({
    brandId: optionalFilter(z.uuid()),
    q: z.string().trim().max(150).default(''),
    status: optionalFilter(opportunityStatusSchema),
    risk: optionalFilter(riskLevelSchema),
    intent: optionalFilter(intentCategorySchema),
    minimumScore: z.preprocess(
      (value) => (value === '' || value === undefined ? 40 : value),
      z.coerce.number().min(0).max(100),
    ),
    subreddit: optionalFilter(z.uuid()),
    competitorId: optionalFilter(z.uuid()),
    from: optionalFilter(z.iso.date()),
    to: optionalFilter(z.iso.date()),
    sort: z.enum(['score', 'freshness', 'engagement']).default('score'),
    view: z.enum(['cards', 'table']).default('cards'),
    cursor: optionalFilter(z.string().max(512)),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'Start date must precede end date.',
  });
export const usageSchema = z.object({
  quantity: z.coerce.number().nonnegative(),
  limit: z.coerce.number().nonnegative(),
  plan_key: z.string(),
  period_start: z.string(),
  period_end: z.string(),
});
export type Monitoring = z.infer<typeof monitoringSchema>;
export type KeywordRecord = z.infer<typeof keywordRecordSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type FeedFilters = z.infer<typeof feedFilterSchema>;
export type CommunityRule = z.infer<typeof ruleSchema>;
