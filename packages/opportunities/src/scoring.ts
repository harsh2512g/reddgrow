import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  createAIProvider,
  matchesPhrase,
  normalizedWords,
  opportunityAssessmentSchema,
  keywordSuggestionSchema,
  subredditSuggestionSchema,
  type AIProvider,
} from '@threadsignal/ai';
import { brandInputSchema, type BrandInput } from '@threadsignal/knowledge';
import { postSchema, ruleSchema, subredditNameSchema, type RedditPost } from '@threadsignal/reddit';
import {
  keywordInputSchema,
  intentCategorySchema,
  dismissalReasonSchema,
  opportunityEvaluationSchema,
  type KeywordInput,
  type OpportunityEvaluation,
} from './schema.js';
const SCORE_VERSION = 'opportunity-v1';
const keywordRecord = keywordInputSchema.pick({
  value: true,
  kind: true,
  is_exclusion: true,
  status: true,
});
const inputSchema = z.object({
  brand: z.object({ id: z.uuid(), organization_id: z.uuid(), profile: brandInputSchema }),
  post: postSchema,
  rules: z.array(ruleSchema).max(100),
  keywords: z.array(keywordRecord).max(100),
  competitors: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string().max(100),
        domain: z.string().max(2048),
        aliases: z.array(z.string().max(200)).max(30),
      }),
    )
    .max(20),
  knowledge: z
    .array(
      z.object({
        id: z.uuid(),
        source_id: z.uuid(),
        title: z.string().max(500),
        content: z.string().max(20000),
        source_url: z.url().max(2048).nullable(),
      }),
    )
    .max(8),
  now: z.date(),
  maxAgeDays: z.number().int().min(1).max(365).default(30),
  allowedReplyStyle: z.enum(['helpful', 'technical', 'no_links', 'answer_only']).default('helpful'),
  communityAllowed: z.boolean().default(true),
  duplicate: z.boolean().default(false),
  dismissalFeedback: z
    .array(
      z
        .object({
          subreddit: subredditNameSchema,
          intent_category: intentCategorySchema,
          reason: dismissalReasonSchema,
          count: z.number().int().min(0).max(1_000_000),
        })
        .strict(),
    )
    .max(50)
    .default([]),
});
export type EvaluateOpportunityInput = z.input<typeof inputSchema>;
export type ScoringResult =
  { kind: 'filtered'; reason: string } | { kind: 'scored'; evaluation: OpportunityEvaluation };
const bounded = (value: number) => Math.max(0, Math.min(100, Math.round(value * 100) / 100));
export function freshnessScore(createdAt: string, now: Date): number {
  const created = Date.parse(z.iso.datetime().parse(createdAt));
  const hours = (z.date().parse(now).getTime() - created) / 3600000;
  if (hours < 0) return 0;
  return hours <= 1
    ? 100
    : hours <= 6
      ? 90
      : hours <= 24
        ? 75
        : hours <= 72
          ? 50
          : hours <= 168
            ? 25
            : 10;
}
export function engagementScore(
  post: Pick<RedditPost, 'score' | 'commentCount' | 'createdAt'>,
  now: Date,
): number {
  z.object({
    score: z.number().int(),
    commentCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
  }).parse(post);
  z.date().parse(now);
  const hours = Math.max(1, (now.getTime() - Date.parse(post.createdAt)) / 3600000);
  // Positive votes and replies per hour, logarithmically bounded to avoid one
  // viral discussion overwhelming product relevance and actual buying intent.
  return bounded(Math.log2(1 + (Math.max(0, post.score) + post.commentCount * 2) / hours) * 16);
}
export function weightedOpportunityScore(input: {
  semantic_relevance: number;
  buying_intent: number;
  freshness: number;
  engagement_velocity: number;
  rule_fit: number;
  competitor_context: number;
  penalty_score: number;
}) {
  const score = z.number().finite().min(0).max(100);
  for (const value of Object.values(input)) score.parse(value);
  return bounded(
    input.semantic_relevance * 0.3 +
      input.buying_intent * 0.25 +
      input.freshness * 0.15 +
      input.engagement_velocity * 0.1 +
      input.rule_fit * 0.1 +
      input.competitor_context * 0.1 -
      input.penalty_score,
  );
}
export function previewKeywordMatches(input: {
  posts: z.input<typeof postSchema>[];
  keywords: Array<Pick<KeywordInput, 'value' | 'kind' | 'is_exclusion' | 'status'>>;
}) {
  const posts = z.array(postSchema).max(100).parse(input.posts);
  const keywords = z
    .array(keywordRecord)
    .max(100)
    .parse(input.keywords)
    .filter((item) => item.status === 'active');
  return posts.map((post) => {
    const text = `${post.title} ${post.body}`;
    const terms = keywords.filter((item) => !item.is_exclusion && matchesPhrase(text, item.value));
    const excluded = keywords.filter(
      (item) => item.is_exclusion && matchesPhrase(text, item.value),
    );
    return {
      post,
      matched_terms: terms.map((item) => item.value),
      excluded_terms: excluded.map((item) => item.value),
      matched:
        !post.isDeleted &&
        excluded.length === 0 &&
        (terms.length > 0 || !keywords.some((item) => !item.is_exclusion)),
    };
  });
}
export async function suggestKeywords(
  profile: BrandInput,
  provider: AIProvider = createAIProvider(),
): Promise<KeywordInput[]> {
  const brand = brandInputSchema.parse(profile);
  const result = await provider.generateStructured({
    task: 'keyword.suggest',
    input: JSON.stringify({
      category: brand.category,
      use_cases: brand.use_cases,
      keywords: brand.keywords,
      competitors: brand.competitors.map(({ name }) => ({ name })),
    }),
    schema: keywordSuggestionSchema,
  });
  return result.value.map((item) =>
    keywordInputSchema.parse({
      ...item,
      source: 'suggested',
      is_exclusion: item.kind === 'exclusion',
    }),
  );
}
export async function suggestSubreddits(
  profile: BrandInput,
  provider: AIProvider = createAIProvider(),
) {
  const brand = brandInputSchema.parse(profile);
  return (
    await provider.generateStructured({
      task: 'subreddit.suggest',
      input: JSON.stringify({
        category: brand.category,
        use_cases: brand.use_cases,
        keywords: brand.keywords,
        competitors: brand.competitors.map(({ name }) => ({ name })),
      }),
      schema: subredditSuggestionSchema,
    })
  ).value;
}
export async function evaluateOpportunity(
  value: EvaluateOpportunityInput,
  provider: AIProvider = createAIProvider(),
): Promise<ScoringResult> {
  const input = inputSchema.parse(value);
  const { post, now } = input;
  const text = `${post.title} ${post.body}`;
  const age = now.getTime() - Date.parse(post.createdAt);
  const reason = !input.communityAllowed
    ? 'unmonitored_community'
    : input.duplicate
      ? 'duplicate'
      : post.isDeleted
        ? 'deleted'
        : post.isNsfw
          ? 'nsfw'
          : post.isLocked
            ? 'locked'
            : post.isArchived
              ? 'archived'
              : text.trim().length < 40
                ? 'insufficient_text'
                : age < -300000
                  ? 'future_timestamp'
                  : age > input.maxAgeDays * 86400000
                    ? 'too_old'
                    : null;
  if (reason) return { kind: 'filtered', reason };
  const preview = previewKeywordMatches({ posts: [post], keywords: input.keywords })[0];
  if (preview?.excluded_terms.length) return { kind: 'filtered', reason: 'excluded_term' };
  const activeKeywords = input.keywords
    .filter((item) => item.status === 'active' && !item.is_exclusion)
    .map((item) => item.value);
  if (activeKeywords.length && !preview?.matched)
    return { kind: 'filtered', reason: 'no_keyword_match' };
  const profile = input.brand.profile;
  const assessmentInput = {
    brand: {
      name: profile.name,
      description: profile.description,
      value_proposition: profile.value_proposition,
      category: profile.category,
      use_cases: profile.use_cases.slice(0, 10),
      avoid_claims: profile.avoid_claims,
      countries: profile.countries,
    },
    post: { title: post.title, body: post.body.slice(0, 20000) },
    keywords: activeKeywords.slice(0, 30),
    competitors: input.competitors.map((item) => ({
      name: item.name,
      aliases: [...item.aliases.filter((alias) => matchesPhrase(text, alias)), ...item.aliases]
        .filter((alias, index, aliases) => aliases.indexOf(alias) === index)
        .slice(0, 3),
    })),
    rules: input.rules
      .slice(0, 10)
      .map((item) => ({ title: item.title, description: item.description.slice(0, 700) })),
    knowledge: input.knowledge.map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content.slice(0, 1000),
    })),
  };
  const response = await provider.generateStructured({
    task: 'opportunity.evaluate',
    input: JSON.stringify(assessmentInput),
    schema: opportunityAssessmentSchema,
  });
  const assessment = opportunityAssessmentSchema.parse(response.value);
  const hardBlocks: string[] = [];
  const rules = input.rules.map((item) => `${item.title} ${item.description}`).join(' ');
  if (
    /no commercial recommendations|commercial recommendations.{0,40}prohibited|no self[- ]promotion|product promotion.{0,30}prohibited/i.test(
      rules,
    )
  )
    hardBlocks.push('Community rules prohibit the planned commercial recommendation.');
  if (
    /pretend to be an independent customer|hide your affiliation|fake (?:customer|experience|identity)|no affiliated recommendations/i.test(
      text,
    )
  )
    hardBlocks.push('The requested response would misrepresent or conceal affiliation.');
  if (
    /target a vulnerable person|harassment|illegal (?:product|service)|stolen (?:accounts|credentials)/i.test(
      `${input.brand.profile.category} ${text}`,
    )
  )
    hardBlocks.push('This request conflicts with responsible-use safeguards.');
  const contradicted = input.brand.profile.avoid_claims.filter((claim) =>
    matchesPhrase(text, claim),
  );
  if (/need|require|must|mandatory/i.test(text)) {
    for (const document of input.knowledge) {
      for (const match of document.content.matchAll(
        /(?:does not|cannot|doesn't|do not)\s+(?:support|provide|offer|handle|process|guarantee)\s+([^.!?\n]{3,150})/gi,
      )) {
        const feature = match[1]?.trim();
        if (feature && matchesPhrase(text, feature)) contradicted.push(feature);
      }
    }
  }
  if (contradicted.length)
    hardBlocks.push(
      'The requested feature conflicts with the brand’s documented claim restrictions.',
    );
  if (assessment.risk_level === 'blocked' || assessment.suggested_action === 'blocked')
    hardBlocks.push(
      ...(assessment.risk_reasons.length
        ? assessment.risk_reasons
        : ['The provider assessment blocks the proposed reply.']),
    );
  const penalties: Array<{ reason: string; points: number }> = [];
  const feedbackCount = input.dismissalFeedback
    .filter(
      (feedback) =>
        feedback.subreddit.toLowerCase() === post.subreddit.toLowerCase() &&
        feedback.intent_category === assessment.intent_category &&
        ['not_relevant', 'low_intent', 'product_cannot_help', 'community_risk'].includes(
          feedback.reason,
        ),
    )
    .reduce((count, feedback) => count + feedback.count, 0);
  if (feedbackCount >= 3) {
    const points = Math.min(15, feedbackCount * 3);
    penalties.push({
      reason: `Brand feedback: ${feedbackCount} prior human dismissals for this community and intent reduce the score by ${points}.`,
      points,
    });
  }
  if (/no vendor responses/i.test(text))
    penalties.push({ reason: 'The author requests no vendor responses.', points: 40 });
  if (/satire|\bmeme\b/i.test(text))
    penalties.push({ reason: 'The post appears to be satire or a meme.', points: 30 });
  if (/already answered|no additional recommendations|selected a provider/i.test(text))
    penalties.push({
      reason: 'The question is already answered or the selection is complete.',
      points: 15,
    });
  if (assessment.intent_category === 'support')
    penalties.push({
      reason: 'This is support for an existing customer, not a buying decision.',
      points: 25,
    });
  if (contradicted.length)
    penalties.push({ reason: 'The product cannot support the requested claim.', points: 50 });
  if (hardBlocks.some((item) => item.startsWith('Community rules')))
    penalties.push({ reason: 'The community prohibits the planned commercial reply.', points: 50 });
  const countries = input.brand.profile.countries.map(normalizedWords);
  const requestedRegion =
    /(?:only|located|available|served|based) in (united states|united kingdom|canada|germany|india|australia|france)\b/i.exec(
      text,
    )?.[1];
  if (
    requestedRegion &&
    countries.length &&
    !countries.some((country) =>
      ['worldwide', 'global', normalizedWords(requestedRegion)].includes(country),
    )
  )
    penalties.push({
      reason: 'The requested country is outside the brand’s listed service area.',
      points: 25,
    });
  const isBlocked = hardBlocks.length > 0;
  const scores = {
    semantic_relevance: assessment.semantic_relevance,
    buying_intent: assessment.buying_intent,
    freshness: freshnessScore(post.createdAt, now),
    engagement_velocity: engagementScore(post, now),
    rule_fit: assessment.rule_fit,
    competitor_context: assessment.competitor_context,
    penalty_score: Math.min(
      100,
      penalties.reduce((sum, item) => sum + item.points, 0),
    ),
  };
  const finalScore = weightedOpportunityScore(scores);
  const matchedCompetitors = input.competitors
    .filter((item) => [item.name, ...item.aliases].some((term) => matchesPhrase(text, term)))
    .map((item) => item.id);
  const citations = input.knowledge
    .filter((item) =>
      normalizedWords(text)
        .split(' ')
        .filter((word) => word.length > 4)
        .some((word) => matchesPhrase(item.content, word)),
    )
    .map((item) => ({
      chunk_id: item.id,
      source_id: item.source_id,
      title: item.title,
      source_url: item.source_url,
      excerpt: item.content.slice(0, 300),
    }))
    .slice(0, 8);
  const checksum = createHash('sha256')
    .update(
      JSON.stringify({ ...input, now: Math.floor(now.getTime() / 600000), version: SCORE_VERSION }),
    )
    .digest('hex');
  return {
    kind: 'scored',
    evaluation: opportunityEvaluationSchema.parse({
      ...assessment,
      ...scores,
      final_score: finalScore,
      is_blocked: isBlocked,
      suggested_action: isBlocked
        ? 'blocked'
        : finalScore < 40
          ? 'ignore'
          : input.allowedReplyStyle === 'answer_only' || /no vendor responses/i.test(text)
            ? 'monitor'
            : assessment.suggested_action,
      risk_level: isBlocked ? 'blocked' : penalties.length ? 'high' : assessment.risk_level,
      risk_reasons: [
        ...new Set([
          ...assessment.risk_reasons,
          ...hardBlocks,
          ...penalties.map((item) => item.reason),
        ]),
      ].slice(0, 20),
      missing_capabilities: [
        ...new Set([
          ...assessment.missing_capabilities,
          ...contradicted.map((item) => `Unsupported claim: ${item}`),
        ]),
      ].slice(0, 20),
      matched_capabilities: assessment.matched_capabilities.slice(0, 20),
      matched_competitor_ids: matchedCompetitors,
      reasoning_summary: `${assessment.reasoning_summary.slice(0, 1700)} Freshness ${scores.freshness}/100; engagement ${scores.engagement_velocity}/100; penalties ${scores.penalty_score}. ${isBlocked ? 'Blocked: do not recommend a reply.' : `Weighted score ${finalScore}/100.`}`,
      model_metadata: {
        provider: provider.mode,
        version: SCORE_VERSION,
        evaluation_method:
          provider.mode === 'mock'
            ? 'deterministic lexical development assessment'
            : 'validated structured provider assessment',
      },
      input_checksum: checksum,
      knowledge_citations: citations,
      evaluated_at: now.toISOString(),
    }),
  };
}
