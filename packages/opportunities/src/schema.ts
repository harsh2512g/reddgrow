import { z } from 'zod';

export const riskLevelSchema = z.enum(['low', 'medium', 'high', 'blocked']);
export const intentCategorySchema = z.enum([
  'recommendation',
  'alternative',
  'comparison',
  'problem',
  'research',
  'support',
  'other',
]);
export const opportunityStatusSchema = z.enum([
  'new',
  'saved',
  'monitoring',
  'dismissed',
  'archived',
  'blocked',
]);
export const dismissalReasonSchema = z.enum([
  'not_relevant',
  'low_intent',
  'already_answered',
  'community_risk',
  'product_cannot_help',
  'duplicate',
  'other',
]);
export const keywordKindSchema = z.enum([
  'category',
  'problem',
  'recommendation',
  'alternative',
  'competitor',
  'technical',
  'exclusion',
]);
export const keywordInputSchema = z.object({
  value: z.string().trim().min(2).max(200),
  kind: keywordKindSchema.default('category'),
  is_exclusion: z.boolean().default(false),
  status: z.enum(['active', 'paused']).default('active'),
  source: z.enum(['manual', 'suggested']).default('manual'),
});
export const communitySettingsSchema = z.object({
  status: z.enum(['active', 'paused']).default('active'),
  priority: z.number().int().min(1).max(5).default(3),
  minimum_score: z.number().int().min(0).max(100).default(40),
  allowed_reply_style: z
    .enum(['helpful', 'technical', 'no_links', 'answer_only'])
    .default('helpful'),
  internal_notes: z.string().trim().max(2000).default(''),
  internal_interpretation: z.string().trim().max(2000).default(''),
  monitor_new: z.boolean().default(true),
  monitor_hot: z.boolean().default(false),
  monitor_rising: z.boolean().default(false),
});
export const knowledgeCitationSchema = z.object({
  chunk_id: z.uuid(),
  source_id: z.uuid(),
  title: z.string().max(500),
  source_url: z.url().max(2048).nullable(),
  excerpt: z.string().max(300),
});
const score = z.number().finite().min(0).max(100);
const reasons = z.array(z.string().min(1).max(500)).max(20);
export const opportunityEvaluationSchema = z
  .object({
    summary: z.string().min(1).max(1000),
    user_need: z.string().min(1).max(1000),
    intent_category: intentCategorySchema,
    semantic_relevance: score,
    buying_intent: score,
    freshness: score,
    engagement_velocity: score,
    rule_fit: score,
    competitor_context: score,
    penalty_score: score,
    final_score: score,
    suggested_action: z.enum(['reply', 'monitor', 'ignore', 'blocked']),
    risk_level: riskLevelSchema,
    risk_reasons: reasons,
    matched_capabilities: reasons,
    missing_capabilities: reasons,
    matched_competitor_ids: z.array(z.uuid()).max(20),
    reasoning_summary: z.string().min(1).max(2000),
    model_metadata: z.object({
      provider: z.enum(['mock', 'openai']),
      version: z.string().max(100),
      evaluation_method: z.string().max(200),
    }),
    input_checksum: z.string().regex(/^[a-f0-9]{64}$/),
    is_blocked: z.boolean(),
    knowledge_citations: z.array(knowledgeCitationSchema).max(8),
    evaluated_at: z.iso.datetime(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.is_blocked &&
        (value.suggested_action !== 'blocked' || value.risk_level !== 'blocked')) ||
      (!value.is_blocked &&
        (value.suggested_action === 'blocked' || value.risk_level === 'blocked'))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['is_blocked'],
        message: 'Blocked opportunities must have a blocked action and risk.',
      });
  });
export type KeywordInput = z.infer<typeof keywordInputSchema>;
export type CommunitySettings = z.infer<typeof communitySettingsSchema>;
export type KnowledgeCitation = z.infer<typeof knowledgeCitationSchema>;
export type OpportunityEvaluation = z.infer<typeof opportunityEvaluationSchema>;
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type IntentCategory = z.infer<typeof intentCategorySchema>;
export type DismissalReason = z.infer<typeof dismissalReasonSchema>;
export function scoreLabel(value: number): 'High' | 'Medium' | 'Low' | 'Hidden' {
  const parsed = score.parse(value);
  return parsed >= 80 ? 'High' : parsed >= 60 ? 'Medium' : parsed >= 40 ? 'Low' : 'Hidden';
}
