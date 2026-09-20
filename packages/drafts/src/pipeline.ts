import { createHash } from 'node:crypto';
import { createAIProvider, type AIProvider } from '@threadsignal/ai';
import {
  DRAFT_COMPLIANCE_CODES,
  DRAFT_ENGINE_VERSION,
  draftContextSchema,
  draftGenerationSchema,
  draftVerificationSchema,
  draftComplianceSchema,
  extractedClaimsSchema,
  type DraftContext,
  type DraftGeneration,
  type DraftVerification,
  type DraftCompliance,
  type DraftClaim,
  type DraftKnowledge,
  type DraftComplianceCheck,
} from './schema.js';

const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'%]+/gu, ' ')
    .trim();
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const unsafeSource =
  /ignore.{0,30}(?:previous|prior|instruction)|system prompt|assistant:|classify.{0,40}(?:verified|safe)|pretend (?:to be|you)|you must (?:say|claim|ignore)|override.{0,30}(?:rule|check|policy)/i;
const deception =
  /\b(?:i(?:'m| am) (?:an? )?(?:independent|unaffiliated|paying) (?:customer|user)|(?:not|no way) affiliated|no (?:connection|relationship) (?:to|with)|as (?:an? )?(?:independent|paying) customer|i (?:bought|purchased|switched to|used|tried)|i(?:'ve| have) been using|in my experience|as a long[- ]time (?:user|customer)|my (?:sales|revenue|customers) (?:grew|increased|doubled)|we (?:pretend|pose) to be)\b/i;
const sales =
  /\b(?:buy now|sign up now|limited time|act now|best ever|game.?changer|guaranteed results|don't miss out)\b/i;
const factRisk =
  /\b(?:guarantee(?:d|s)?|promises?|cures?|recovery|reconstructs?|results|outcomes|revenue|doubled|unlimited|always|never|supports?|provides?|costs?|dollars?|cheaper|better|faster|percent|million|customers?|pricing|plan|features?|certified|compliant|latency|uptime|accuracy|security|free|api|product|tool)\b|\d|[%$€£]/i;
const negative = /\b(?:no|not|never|cannot|can't|doesn't|unavailable|unsupported|without)\b/i;
const limitation =
  /\b(?:cannot|can't|does not|do not|not available|not supported|no .{0,30} supported|limitations?|may still|artifacts|expire|at most|up to|not accepted|not provide)\b/i;
const current = (item: DraftKnowledge, now: string) =>
  !item.is_stale &&
  !item.is_inferred &&
  Date.parse(item.updated_at) <= Date.parse(now) + 60000 &&
  Date.parse(now) - Date.parse(item.updated_at) <= 90 * 24 * 60 * 60 * 1000;

/** Retains exact text offsets. Semicolons and newlines also delimit independently reviewable assertions. */
export function extractDraftSentences(
  text: string,
): { text: string; start: number; end: number }[] {
  const segments: { text: string; start: number; end: number }[] = [];
  const expression = /[^\n;.!?]+(?:[.!?](?!\s|$)[^\n;.!?]+)*(?:[.!?]+(?=\s|$)|[;\n]|$)/g;
  for (const match of text.matchAll(expression)) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const sentence = raw
      .trim()
      .replace(/[;]$/, '')
      .replace(/^[-*#]+\s*/, '')
      .trim();
    if (!sentence) continue;
    const start = (match.index ?? 0) + leading + raw.trimStart().indexOf(sentence);
    segments.push({
      text: sentence,
      start: Math.max(0, start),
      end: Math.max(0, start) + sentence.length,
    });
  }
  return segments;
}
function knowledgeSentences(context: DraftContext) {
  return context.knowledge.flatMap((source) =>
    extractDraftSentences(source.content)
      .filter(
        ({ text }) =>
          words(text).length >= 4 && words(text).length <= 60 && !unsafeSource.test(text),
      )
      .map((sentence) => ({ source, ...sentence })),
  );
}
function disclosure(context: DraftContext) {
  return context.persona?.default_disclosure ?? context.brand.disclosure_text;
}
function honestDisclosure(text: string, context: DraftContext) {
  const required = disclosure(context);
  const parts = extractDraftSentences(required).map((part) => normalize(part.text));
  const actual = extractDraftSentences(text).map((part) => normalize(part.text));
  const role = context.persona?.real_role ?? context.brand.real_role;
  const roleMatches =
    (!/\bfounder|founded\b/i.test(required) || role === 'founder') &&
    (!/\bdeveloper advocate\b/i.test(required) || role === 'developer advocate');
  return (
    parts.length > 0 &&
    parts.every((part) => actual.includes(part)) &&
    roleMatches &&
    normalize(required).includes(normalize(context.brand.name)) &&
    /\b(?:work (?:with|for|at)|founder|founded|team (?:behind|at|of)|employee|employed|developer advocate|support (?:team|engineer)|contractor|agency|consult (?:for|with)|affiliated|represent)\b/i.test(
      required,
    ) &&
    !/\b(?:not|never|no|unaffiliated|independent customer)\b/i.test(required)
  );
}
const advice = {
  image:
    'Start by testing representative product images, including compressed originals and transparent backgrounds, before choosing an image workflow.',
  technical:
    'For a batch workflow, check how job status, retries and output retention fit your application before committing to an integration.',
  generic:
    'Start with a small, representative test of your actual workflow and compare the results against your requirements before choosing a solution.',
  evaluate:
    'Compare quality, failure handling and total cost against your current approach, and keep a human review step for results that affect customers.',
  closing:
    'If the documented limits do not fit your requirements, keep evaluating alternatives rather than assuming that a missing capability is supported.',
  concise: 'Test a representative sample and check the documented limits before deciding.',
  detail:
    'Write down your acceptance criteria first, keep the original inputs, and inspect difficult examples alongside the ordinary cases so your comparison reflects the work you actually need to do.',
  technicalDetail:
    'Treat retry handling and completion checks as explicit integration requirements, and test failure cases as well as successful requests before relying on the workflow.',
};
const knownAdvice = new Set(Object.values(advice).map(normalize));
const adviceVocabulary = new Set(
  'a an the and or to of in on for from with by your our their these those this that it its you before after first then consider compare check test ask review evaluate measure inspect try start make sure keep remember sample representative small against requirements workflow workflows outputs inputs original examples difficult cases assumptions alternatives options documentation documented tradeoffs constraints limits retention quality failure failures handling baseline needs human review step criteria acceptance compare comparison ownership permission permissions budget business team existing current approach risk risks time together separately carefully independently'.split(
    ' ',
  ),
);
function mockGenerate(context: DraftContext): DraftGeneration {
  const instruction = context.controls.instruction ?? '';
  const focus =
    context.controls.capability ?? `${context.post.title} ${context.post.body} ${instruction}`;
  const tokens = new Set(
    normalize(focus)
      .split(' ')
      .filter((word) => word.length > 3),
  );
  const candidates = knowledgeSentences(context).filter(
    ({ source, text }) =>
      current(source, context.now) &&
      !deception.test(text) &&
      !sales.test(text) &&
      !/(?:https?:\/\/|www\.)/i.test(text),
  );
  const rank = (item: (typeof candidates)[number]) =>
    normalize(item.text)
      .split(' ')
      .filter((token) => tokens.has(token)).length +
    (/docs|documentation/i.test(`${item.source.title} ${item.source.source_url}`) ? 2 : 0);
  candidates.sort(
    (a, b) => rank(b) - rank(a) || a.source.id.localeCompare(b.source.id) || a.start - b.start,
  );
  const length =
    context.controls.action === 'shorter' || /\b(?:shorter|concise)\b/i.test(instruction)
      ? 'concise'
      : (context.controls.length ?? context.persona?.reply_length ?? context.brand.reply_length);
  const noBrand =
    context.controls.action === 'no_brand' ||
    /\b(?:no brand|without (?:a )?brand|do not mention (?:the )?brand)\b/i.test(instruction);
  const facts = noBrand
    ? []
    : candidates
        .filter(
          ({ text }) =>
            !limitation.test(text) && !/fictional|synthetic|local (?:demo|test)/i.test(text),
        )
        .slice(0, length === 'concise' ? 1 : 2);
  const limits = noBrand ? [] : candidates.filter(({ text }) => limitation.test(text)).slice(0, 1);
  const image = /image|photograph|upscal/i.test(focus);
  const technical =
    /\btechnical\b/i.test(instruction) ||
    context.controls.action === 'more_technical' ||
    context.persona?.technical_depth === 'technical' ||
    context.brand.tone === 'Technical';
  const opening = image ? advice.image : advice.generic;
  const parts = [
    opening,
    technical ? advice.technical : advice.evaluate,
    disclosure(context),
    ...facts.map((item) => item.text),
    ...limits.map((item) => item.text),
    advice.closing,
  ];
  if (length === 'concise') parts.splice(1, 1);
  if (length === 'detailed') parts.push(technical ? advice.technicalDetail : advice.detail);
  if (noBrand) parts.push(advice.detail);
  const maximumWords = length === 'detailed' ? 260 : length === 'concise' ? 110 : 180;
  while (words(parts.join(' ')).length > maximumWords && facts.length > 1) {
    const removed = facts.pop()!;
    parts.splice(parts.indexOf(removed.text), 1);
  }
  for (const optional of [
    advice.closing,
    technical ? advice.technical : advice.evaluate,
    advice.detail,
    advice.technicalDetail,
  ]) {
    if (words(parts.join(' ')).length > maximumWords && parts.includes(optional))
      parts.splice(parts.indexOf(optional), 1);
  }
  if (words(parts.join(' ')).length > maximumWords && facts.length && limits.length) {
    const removed = facts.pop()!;
    parts.splice(parts.indexOf(removed.text), 1);
  }
  if (length === 'standard' && words(parts.join(' ')).length < 70) parts.push(advice.detail);
  if (words(parts.join(' ')).length > maximumWords)
    throw new Error('Shorten the configured disclosure or select a longer draft preference.');
  const draft = parts.join('\n\n');
  return draftGenerationSchema.parse({
    draft,
    strategy: noBrand
      ? 'Give practical selection advice without a product recommendation; retain truthful affiliation.'
      : 'Answer the workflow question first, quote current source-backed capabilities and limitations, and disclose affiliation.',
    affiliation_disclosure_included: honestDisclosure(draft, context),
    brand_mentioned: normalize(draft).includes(normalize(context.brand.name)),
    suggested_link: null,
    claims: [...facts, ...limits].map(({ text, source }) => ({
      text,
      source_chunk_ids: [source.id],
      confidence: 'high',
    })),
    limitations_mentioned: limits.map(({ text }) => text),
    uncertainties: [
      ...(!facts.length && !limits.length && !noBrand
        ? [
            'No current, directly supported product facts were available; this draft offers general advice only.',
          ]
        : []),
      ...(context.controls.instruction
        ? [
            'Custom instructions affect source ranking and recognized length/style preferences; the deterministic mock cannot promise arbitrary rewriting.',
          ]
        : []),
    ],
  });
}
function obviousAdvice(sentence: string, context: DraftContext) {
  if (knownAdvice.has(normalize(sentence))) return true;
  if (
    context.persona?.allowed_first_person_statements.some(
      (statement) => normalize(statement) === normalize(sentence),
    ) &&
    !factRisk.test(sentence) &&
    !deception.test(sentence) &&
    !sales.test(sentence) &&
    !/\b(?:independent|unaffiliated|customer|founder)\b/i.test(sentence)
  )
    return true;
  if (normalize(sentence) === normalize(disclosure(context)) && honestDisclosure(sentence, context))
    return true;
  const safeImperative =
    /^(?:consider|compare|check|test|ask|review|evaluate|measure|inspect|try|start by|make sure|keep|remember to)\b/i.test(
      sentence,
    );
  return (
    safeImperative &&
    normalize(sentence)
      .split(' ')
      .every((word) => adviceVocabulary.has(word)) &&
    !factRisk.test(sentence) &&
    !normalize(sentence).includes(normalize(context.brand.name)) &&
    !deception.test(sentence) &&
    !sales.test(sentence) &&
    !/\b(?:because|since|as it|which|that (?:is|has|can)|will|guarantees?)\b/i.test(sentence)
  );
}
function contradiction(claim: string, source: string) {
  const plan = (value: string) =>
    value.match(/\b(?:the )?([a-z][a-z-]*) plan\b/i)?.[1]?.toLowerCase();
  if (plan(claim) && plan(source) && plan(claim) !== plan(source)) return false;
  const stop = new Set(
    'the a an our their this that it is are be been being no not never cannot can could will does do supports support supported provides provide available unavailable without to from of for and or with only'.split(
      ' ',
    ),
  );
  const tokens = (value: string) =>
    new Set(
      normalize(value)
        .split(' ')
        .filter((word) => word.length > 2 && !stop.has(word)),
    );
  const a = tokens(claim);
  const b = tokens(source);
  const overlap = [...a].filter((word) => b.has(word)).length;
  if (overlap < 2) return false;
  const coverage = overlap / Math.max(1, Math.min(a.size, b.size));
  const numberWords =
    /\b(?:\d+(?:\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/gi;
  const claimNumbers = claim.match(numberWords)?.join(' ').toLowerCase();
  const sourceNumbers = source.match(numberWords)?.join(' ').toLowerCase();
  return (
    coverage >= 0.65 &&
    (negative.test(claim) !== negative.test(source) ||
      (!!claimNumbers && !!sourceNumbers && claimNumbers !== sourceNumbers))
  );
}
function classifySentence(
  sentence: { text: string; start: number; end: number },
  context: DraftContext,
): DraftClaim {
  const base = { claim_text: sentence.text, start: sentence.start, end: sentence.end };
  if (obviousAdvice(sentence.text, context))
    return {
      ...base,
      status: 'general_advice',
      confidence: 'high',
      source_chunk_ids: [],
      explanation:
        'General workflow advice or the configured truthful affiliation; no product capability is asserted.',
      evidence_kind: 'advice',
    };
  const sources = knowledgeSentences(context);
  const conflicting = sources.filter(
    (item) => current(item.source, context.now) && contradiction(sentence.text, item.text),
  );
  const exact = sources.filter((item) => normalize(item.text) === normalize(sentence.text));
  if (conflicting.length)
    return {
      ...base,
      status: 'contradicted',
      confidence: 'high',
      source_chunk_ids: [...new Set(conflicting.map((item) => item.source.id))].slice(0, 8),
      explanation:
        'Current knowledge contains a conflicting limitation, negation or quantity. Remove the claim or correct the underlying verified sources; approval cannot override a contradiction.',
      evidence_kind: 'current_documentation',
    };
  const verified = exact.filter((item) => current(item.source, context.now));
  if (verified.length)
    return {
      ...base,
      status: 'verified',
      confidence: 'high',
      source_chunk_ids: [...new Set(verified.map((item) => item.source.id))].slice(0, 8),
      explanation:
        'The complete assertion matches a sentence in current included documentation. This is conservative mock evidence matching, not a guarantee that the source is true.',
      evidence_kind: 'current_documentation',
    };
  if (exact.length)
    return {
      ...base,
      status: 'partial',
      confidence: 'low',
      source_chunk_ids: [...new Set(exact.map((item) => item.source.id))].slice(0, 8),
      explanation:
        'The assertion appears only in stale, future-dated or inferred material; it has not been verified against current documentation.',
      evidence_kind: exact.some((item) => item.source.is_inferred) ? 'inferred' : 'stale',
    };
  return {
    ...base,
    status: 'unsupported',
    confidence: 'low',
    source_chunk_ids: [],
    explanation:
      'The full assertion is not established by the supplied current sources. Remove it, use the documented wording, or add a verified source; matching keywords alone are insufficient.',
    evidence_kind: 'none',
  };
}
function normalizeVerification(claims: DraftClaim[]): DraftVerification {
  return draftVerificationSchema.parse({
    overall_status: claims.some((claim) => ['unsupported', 'contradicted'].includes(claim.status))
      ? 'fail'
      : claims.some((claim) => claim.status === 'partial')
        ? 'warning'
        : 'pass',
    claims,
  });
}
export async function generateDraft(
  value: unknown,
  ai: AIProvider = createAIProvider(),
): Promise<DraftGeneration> {
  const context = draftContextSchema.parse(value);
  if (ai.mode === 'mock') return mockGenerate(context);
  const result = await ai.generateStructured({
    task: 'draft.generate',
    input: JSON.stringify(context),
    schema: draftGenerationSchema,
  });
  const generation = draftGenerationSchema.parse(result.value);
  const ids = new Set(
    context.knowledge.filter((item) => current(item, context.now)).map((item) => item.id),
  );
  if (generation.claims.some((claim) => claim.source_chunk_ids.some((id) => !ids.has(id))))
    throw new Error('Draft generation returned an unavailable source reference.');
  return {
    ...generation,
    affiliation_disclosure_included: honestDisclosure(generation.draft, context),
    brand_mentioned: normalize(generation.draft).includes(normalize(context.brand.name)),
  };
}
export async function verifyDraft(
  value: unknown,
  ai: AIProvider = createAIProvider(),
): Promise<DraftVerification> {
  const input = draftContextSchema.extend({ text: draftGenerationSchema.shape.draft }).parse(value);
  const sentences = extractDraftSentences(input.text);
  if (sentences.length > 100 || sentences.some((sentence) => sentence.text.length > 2000))
    throw new Error('Draft has too many or overlong assertions to verify safely.');
  const guarded = sentences.map((sentence) => classifySentence(sentence, input));
  if (ai.mode === 'mock') return normalizeVerification(guarded);
  // Extraction and verification are independent tasks, never the generator's self-reported claims.
  const extracted = await ai.generateStructured({
    task: 'draft.extract',
    input: JSON.stringify({ text: input.text, brand: input.brand.name }),
    schema: extractedClaimsSchema,
  });
  const verified = await ai.generateStructured({
    task: 'draft.verify',
    input: JSON.stringify({ ...input, extracted_claims: extracted.value.claims }),
    schema: draftVerificationSchema,
  });
  const modelClaims = draftVerificationSchema.parse(verified.value).claims;
  const ids = new Set(input.knowledge.map((item) => item.id));
  for (const claim of modelClaims)
    if (!input.text.includes(claim.claim_text) || claim.source_chunk_ids.some((id) => !ids.has(id)))
      throw new Error('Draft verification returned an invalid claim or source reference.');
  // A model may make the result more conservative, but cannot turn weak lexical evidence into verification.
  const severity: Record<DraftClaim['status'], number> = {
    general_advice: 0,
    verified: 0,
    partial: 1,
    unsupported: 2,
    contradicted: 3,
  };
  return normalizeVerification(
    guarded.map((claim) => {
      const additional = modelClaims.find(
        (other) =>
          claim.claim_text.includes(other.claim_text) &&
          severity[other.status] > severity[claim.status],
      );
      return additional
        ? {
            ...claim,
            status: additional.status,
            explanation: additional.explanation,
            source_chunk_ids: additional.source_chunk_ids,
          }
        : claim;
    }),
  );
}
function localCompliance(
  context: DraftContext,
  text: string,
  verification: DraftVerification,
): DraftCompliance {
  const checks: DraftComplianceCheck[] = DRAFT_COMPLIANCE_CODES.map((code) => ({
    code,
    status: 'pass',
    message: 'No conflict found by the configured deterministic checks.',
    suggested_fix: null,
  }));
  const set = (
    code: DraftComplianceCheck['code'],
    status: DraftComplianceCheck['status'],
    message: string,
    suggested_fix: string,
  ) => {
    const check = checks.find((item) => item.code === code)!;
    Object.assign(check, { status, message, suggested_fix });
  };
  const post = `${context.post.title} ${context.post.body}`;
  const ruleText = context.rules.map((rule) => `${rule.title} ${rule.description}`).join('\n');
  const brandMentioned = normalize(text).includes(normalize(context.brand.name));
  const recommendation =
    (brandMentioned &&
      normalize(text.replace(disclosure(context), '')).includes(normalize(context.brand.name))) ||
    verification.claims.some((claim) => claim.status !== 'general_advice');
  const postWords = new Set(
    normalize(post)
      .split(' ')
      .filter((word) => word.length > 4),
  );
  if (![...postWords].some((word) => normalize(text).split(' ').includes(word)))
    set(
      'RELEVANCE',
      'warning',
      'The reply may not address the specific question.',
      'Explain how the answer helps with the original request.',
    );
  if (verification.overall_status === 'fail')
    set(
      'UNSUPPORTED_CLAIMS',
      'fail',
      'Unsupported or contradicted claims must be corrected before approval.',
      'Remove the highlighted claims or add current verified evidence.',
    );
  else if (verification.overall_status === 'warning')
    set(
      'UNSUPPORTED_CLAIMS',
      'warning',
      'Some claims rely on stale or inferred evidence.',
      'Use current documentation or acknowledge the explicit evidence uncertainty.',
    );
  if (
    deception.test(text) ||
    context.persona?.prohibited_statements.some((item) => normalize(text).includes(normalize(item)))
  )
    set(
      'FAKE_CUSTOMER_EXPERIENCE',
      'fail',
      'The reply includes deceptive identity, unverified experience or a prohibited statement.',
      'Describe your actual role and remove invented customer experience.',
    );
  if (!honestDisclosure(text, context))
    set(
      'AFFILIATION_DISCLOSURE',
      'fail',
      'A truthful, explicit disclosure of your relationship to the product is required.',
      'Include the configured truthful affiliation disclosure; removing the product recommendation does not remove this requirement.',
    );
  if (
    sales.test(text) ||
    (text.match(/\b(?:buy|subscribe|sign up|try it|check it out)\b/gi)?.length ?? 0) > 1
  )
    set(
      'EXCESSIVE_PROMOTION',
      'warning',
      'The reply uses sales language or repeated calls to action.',
      'Lead with useful advice and remove promotional pressure.',
    );
  if (
    context.brand.competitors.some((competitor) =>
      [competitor.name, ...competitor.aliases].some((name) =>
        normalize(text).includes(normalize(name)),
      ),
    ) &&
    /\b(?:better|worse|cheaper|faster|inferior|unreliable|best|only)\b/i.test(text)
  )
    set(
      'MISLEADING_COMPARISON',
      'fail',
      'A competitor comparison needs directly verified, current evidence.',
      'Remove the comparison or describe documented differences without superiority claims.',
    );
  const links = text.match(/(?:https?:\/\/|www\.)[^\s<>\])]+/gi) ?? [];
  const allowed = new Set(context.brand.allowed_links.map((link) => link.replace(/\/$/, '')));
  if (links.some((link) => !allowed.has(link.replace(/[.,!?]+$/, '').replace(/\/$/, ''))))
    set(
      'DISALLOWED_LINK',
      'fail',
      'The reply contains a link outside the approved product links.',
      'Remove the link or use an exact approved HTTPS link.',
    );
  if (
    context.post.deleted ||
    context.post.locked ||
    context.post.archived ||
    (/no self[- ]promotion|self[- ]promotion.{0,40}(?:not allowed|prohibited|banned)|do not promote (?:your|a) product|no commercial recommendations|commercial recommendations.{0,40}prohibited|product promotion.{0,30}prohibited/i.test(
      ruleText,
    ) &&
      recommendation) ||
    (/no (?:external )?links|links.{0,20}(?:not allowed|prohibited)/i.test(ruleText) &&
      links.length > 0)
  )
    set(
      'SUBREDDIT_RULE_CONFLICT',
      'fail',
      'The reply conflicts with a community restriction or the post cannot accept replies.',
      'Respect the community restriction; do not attempt to reply to deleted, locked or archived posts.',
    );
  if (
    /\b(?:upvote (?:me|this)|downvote|brigade|harass|idiot|moron|kill yourself|evade (?:the )?(?:ban|moderator)|pretend to be|hide (?:my|our|your) affiliation)\b/i.test(
      text,
    )
  )
    set(
      'HARASSMENT_MANIPULATION',
      'fail',
      'The reply contains harassment or manipulative participation language.',
      'Remove harassment, vote requests and attempts to hide identity or evade rules.',
    );
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\d ()-]{7,}\d)\b|\b(?:password|api[_ -]?key|secret token)\s*[:=]\s*\S+/i.test(
      text,
    )
  )
    set(
      'PERSONAL_DATA',
      'fail',
      'The reply may expose personal contact data or a credential.',
      'Remove personal contact details and credentials.',
    );
  const limits = knowledgeSentences(context).filter(
    ({ source, text: sentence }) => current(source, context.now) && limitation.test(sentence),
  );
  if (
    recommendation &&
    limits.length &&
    !verification.claims.some(
      (claim) => claim.status === 'verified' && limitation.test(claim.claim_text),
    )
  )
    set(
      'LIMITATION_OMITTED',
      'warning',
      'Relevant current documentation includes limitations absent from the reply.',
      'Mention a documented limitation relevant to the request.',
    );
  if (
    /no vendors?|no (?:vendor|commercial) (?:responses|replies|recommendations)|vendors? (?:please )?(?:do not|don't) (?:reply|respond)|no self[- ]promotion|don't recommend your own (?:tools|products)|do not recommend your own (?:tools|products)/i.test(
      post,
    )
  )
    set(
      'NO_VENDORS_REQUEST',
      'fail',
      'The author explicitly requested no vendors or promotional participation.',
      'Respect the request and do not submit an affiliated reply.',
    );
  const status = checks.some((check) => check.status === 'fail')
    ? 'blocked'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'pass';
  return { status, checks, safe_to_approve: status !== 'blocked' };
}
export async function checkDraftCompliance(
  value: unknown,
  ai: AIProvider = createAIProvider(),
): Promise<DraftCompliance> {
  const input = draftContextSchema
    .extend({ text: draftGenerationSchema.shape.draft, verification: draftVerificationSchema })
    .parse(value);
  const local = localCompliance(input, input.text, input.verification);
  if (ai.mode === 'mock') return draftComplianceSchema.parse(local);
  const result = await ai.generateStructured({
    task: 'draft.compliance',
    input: JSON.stringify(input),
    schema: draftComplianceSchema,
  });
  const modeled = draftComplianceSchema.parse(result.value);
  if (new Set(modeled.checks.map((check) => check.code)).size !== DRAFT_COMPLIANCE_CODES.length)
    throw new Error('Compliance validation omitted required checks.');
  const severity = { pass: 0, warning: 1, fail: 2 };
  const checks = local.checks.map((check) => {
    const other = modeled.checks.find((item) => item.code === check.code)!;
    return severity[other.status] > severity[check.status] ? other : check;
  });
  const status = checks.some((check) => check.status === 'fail')
    ? 'blocked'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'pass';
  return draftComplianceSchema.parse({ status, checks, safe_to_approve: status !== 'blocked' });
}
export async function processDraft(value: unknown, ai: AIProvider = createAIProvider()) {
  const input = draftContextSchema
    .extend({ text: draftGenerationSchema.shape.draft.optional() })
    .parse(value);
  const generation = input.text === undefined ? await generateDraft(input, ai) : null;
  const text = input.text ?? generation!.draft;
  const verification = await verifyDraft({ ...input, text }, ai);
  const compliance = await checkDraftCompliance({ ...input, text, verification }, ai);
  return {
    text,
    generation,
    verification,
    compliance,
    content_checksum: createHash('sha256').update(text).digest('hex'),
    input_checksum: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    provider: ai.mode,
    model_version: `${ai.mode}:${DRAFT_ENGINE_VERSION}`,
  };
}
