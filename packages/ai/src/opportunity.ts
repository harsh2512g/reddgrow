import { z } from 'zod';
const phrases = z.array(z.string().min(1).max(500)).max(30);
export const opportunityAssessmentInputSchema = z.object({
  brand: z.object({
    name: z.string().max(100),
    description: z.string().max(2000),
    value_proposition: z.string().max(2000),
    category: z.string().max(100),
    use_cases: phrases,
    avoid_claims: phrases,
    countries: phrases,
  }),
  post: z.object({ title: z.string().max(1000), body: z.string().max(50000) }),
  keywords: phrases,
  competitors: z.array(z.object({ name: z.string().max(100), aliases: phrases })).max(20),
  knowledge: z
    .array(
      z.object({
        id: z.string().max(100),
        title: z.string().max(500),
        content: z.string().max(5000),
      }),
    )
    .max(8),
  rules: z
    .array(z.object({ title: z.string().max(500), description: z.string().max(10000) }))
    .max(100),
});
const score = z.number().finite().min(0).max(100);
export const opportunityAssessmentSchema = z.object({
  summary: z.string().min(1).max(1000),
  user_need: z.string().min(1).max(1000),
  intent_category: z.enum([
    'recommendation',
    'alternative',
    'comparison',
    'problem',
    'research',
    'support',
    'other',
  ]),
  semantic_relevance: score,
  buying_intent: score,
  rule_fit: score,
  competitor_context: score,
  suggested_action: z.enum(['reply', 'monitor', 'ignore', 'blocked']),
  risk_level: z.enum(['low', 'medium', 'high', 'blocked']),
  risk_reasons: phrases,
  matched_capabilities: phrases,
  missing_capabilities: phrases,
  reasoning_summary: z.string().min(1).max(2000),
});
export type OpportunityAssessment = z.infer<typeof opportunityAssessmentSchema>;
export const keywordSuggestionInputSchema = z.object({
  category: z.string().min(2).max(100),
  use_cases: phrases,
  keywords: phrases,
  competitors: z.array(z.object({ name: z.string().max(100) })).max(20),
});
export const keywordSuggestionSchema = z
  .array(
    z.object({
      value: z.string().trim().min(2).max(200),
      kind: z.enum([
        'category',
        'problem',
        'recommendation',
        'alternative',
        'competitor',
        'technical',
        'exclusion',
      ]),
    }),
  )
  .max(20);
export const subredditSuggestionSchema = z
  .array(
    z.object({
      name: z.string().regex(/^[A-Za-z0-9_]{2,21}$/),
      reason: z.string().min(1).max(500),
    }),
  )
  .max(10);
export const normalizedWords = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export function matchesPhrase(text: string, phrase: string) {
  const term = normalizedWords(phrase);
  return term.length > 0 && ` ${normalizedWords(text)} `.includes(` ${term} `);
}
/** Deterministic lexical assessment for development, never represented as real LLM inference. */
export function mockOpportunityAssessment(value: unknown): OpportunityAssessment {
  const input = opportunityAssessmentInputSchema.parse(value);
  const text = `${input.post.title} ${input.post.body}`;
  const keywords = input.keywords.filter((word) => matchesPhrase(text, word));
  const support = /existing customer support|billing support|my .{0,30} invoice/i.test(text);
  const news = /news:|market report|retrospective|experiment|general lessons/i.test(text);
  const alternative = /alternative|switching from|too expensive/i.test(text);
  const recommendation = /recommend|which api|looking for software|need.{0,35} api/i.test(text);
  const research = /research|has anyone used|comparing|exploring/i.test(text);
  const intent = support
    ? 'support'
    : alternative
      ? 'alternative'
      : recommendation
        ? 'recommendation'
        : research
          ? 'research'
          : /how do|problem|solve/i.test(text)
            ? 'problem'
            : 'other';
  const competitor = input.competitors.some((item) =>
    [item.name, ...item.aliases].some((name) => matchesPhrase(text, name)),
  );
  const domainWords = normalizedWords(`${input.brand.category} ${input.brand.use_cases.join(' ')}`)
    .split(' ')
    .filter((word) => word.length > 3);
  const domainMatches = new Set(domainWords.filter((word) => matchesPhrase(text, word))).size;
  const relevance = Math.min(
    100,
    keywords.length
      ? 45 + keywords.length * 18 + Math.min(19, domainMatches * 4)
      : Math.min(40, domainMatches * 10),
  );
  const ruleText = input.rules.map((rule) => `${rule.title} ${rule.description}`).join(' ');
  const prohibited =
    /no commercial recommendations|commercial recommendations.{0,40}prohibited|no self[- ]promotion|product promotion.{0,30}prohibited/i.test(
      ruleText,
    );
  const reasons = prohibited ? ['Community rules prohibit commercial recommendations.'] : [];
  const knowledgeText = input.knowledge.map((item) => `${item.title} ${item.content}`).join(' ');
  const matched = input.brand.use_cases
    .filter(
      (item) =>
        matchesPhrase(text, item) &&
        normalizedWords(item)
          .split(' ')
          .some((word) => word.length > 3 && matchesPhrase(knowledgeText, word)),
    )
    .slice(0, 20);
  const missing =
    input.knowledge.length === 0
      ? ['No included knowledge was supplied to verify product capabilities.']
      : [];
  return opportunityAssessmentSchema.parse({
    summary: input.post.title.slice(0, 1000) || 'Community discussion',
    user_need: input.post.body.split(/[.!?](?:\s|$)/)[0]?.slice(0, 1000) || input.post.title,
    intent_category: intent,
    semantic_relevance: relevance,
    buying_intent: support
      ? 25
      : news
        ? 15
        : alternative
          ? 100
          : recommendation
            ? 96
            : research
              ? 65
              : 30,
    rule_fit: prohibited ? 0 : 95,
    competitor_context: competitor ? 100 : Math.min(90, relevance),
    suggested_action: prohibited
      ? 'blocked'
      : news || support
        ? 'monitor'
        : relevance >= 60 && recommendation
          ? 'reply'
          : 'monitor',
    risk_level: prohibited ? 'blocked' : support ? 'medium' : 'low',
    risk_reasons: reasons,
    matched_capabilities: matched,
    missing_capabilities: missing,
    reasoning_summary: `Mock lexical evaluation: ${keywords.length} monitored term${keywords.length === 1 ? '' : 's'} matched; intent is ${intent}${competitor ? '; a configured competitor is mentioned' : ''}. Product claims still require verified sources and human review.`,
  });
}
export function mockKeywordSuggestions(value: unknown) {
  const input = keywordSuggestionInputSchema.parse(value);
  const candidates = [
    { value: input.category, kind: 'category' },
    ...input.use_cases.map((value) => ({ value, kind: 'problem' })),
    ...input.keywords.map((value) => ({ value, kind: 'technical' })),
    ...input.competitors.map((item) => ({ value: item.name, kind: 'competitor' })),
    { value: 'recommend a', kind: 'recommendation' },
    { value: 'alternative to', kind: 'alternative' },
    { value: 'which API', kind: 'technical' },
  ];
  const seen = new Set<string>();
  return keywordSuggestionSchema.parse(
    candidates
      .filter((item) => {
        const key = normalizedWords(item.value);
        if (item.value.trim().length < 2 || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20),
  );
}
export function mockSubredditSuggestions(value: unknown) {
  const input = keywordSuggestionInputSchema.parse(value);
  const text = `${input.category} ${input.use_cases.join(' ')}`;
  const items = [
    { name: 'SaaS', reason: 'Synthetic software selection and alternative discussions.' },
    { name: 'webdev', reason: 'Synthetic API and developer integration discussions.' },
  ];
  if (/ecommerce|product photography|images?/i.test(text))
    items.push({
      name: 'ecommerce',
      reason: 'Synthetic ecommerce product photography discussions match the supplied use cases.',
    });
  return subredditSuggestionSchema.parse(items);
}
