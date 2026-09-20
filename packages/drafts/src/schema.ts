import { z } from 'zod';
import { brandInputSchema } from '@threadsignal/knowledge';

export const DRAFT_ENGINE_VERSION = 'threadsignal-draft-v1';
export const DRAFT_COMPLIANCE_CODES = [
  'RELEVANCE',
  'UNSUPPORTED_CLAIMS',
  'FAKE_CUSTOMER_EXPERIENCE',
  'AFFILIATION_DISCLOSURE',
  'EXCESSIVE_PROMOTION',
  'MISLEADING_COMPARISON',
  'DISALLOWED_LINK',
  'SUBREDDIT_RULE_CONFLICT',
  'HARASSMENT_MANIPULATION',
  'PERSONAL_DATA',
  'LIMITATION_OMITTED',
  'NO_VENDORS_REQUEST',
] as const;
const phrases = z.array(z.string().trim().min(1).max(500)).max(30);
export const personaInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  real_role: z.enum([
    'founder',
    'employee',
    'developer advocate',
    'support',
    'contractor',
    'agency',
    'consultant',
    'other',
  ]),
  tone: z.enum([
    'Helpful and concise',
    'Technical',
    'Founder voice',
    'Product specialist',
    'Customer-support style',
    'Custom',
  ]),
  custom_tone: z.string().trim().max(500).default(''),
  reply_length: z.enum(['concise', 'standard', 'detailed']).default('standard'),
  technical_depth: z.enum(['general', 'balanced', 'technical']),
  default_disclosure: z.string().trim().min(10).max(500),
  allowed_first_person_statements: phrases.default([]),
  prohibited_statements: phrases.default([]),
});
export const draftControlsSchema = z.object({
  length: z.enum(['concise', 'standard', 'detailed']).optional(),
  action: z
    .enum([
      'shorter',
      'more_technical',
      'less_promotional',
      'no_brand',
      'add_disclosure',
      'focus_capability',
      'custom',
    ])
    .optional(),
  instruction: z.string().trim().max(1500).optional(),
  capability: z.string().trim().max(200).optional(),
});
export const draftKnowledgeSchema = z.object({
  id: z.uuid(),
  source_id: z.uuid().optional(),
  document_id: z.uuid().optional(),
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(12000),
  source_url: z.string().max(2048).nullable(),
  filename: z.string().max(200).nullable(),
  page_number: z.number().int().positive().nullable(),
  section_heading: z.string().max(500).nullable(),
  updated_at: z.iso.datetime({ offset: true }),
  is_stale: z.boolean().default(false),
  is_inferred: z.boolean().default(false),
});
export const draftContextSchema = z.object({
  brand: brandInputSchema,
  persona: personaInputSchema.optional(),
  post: z.object({
    id: z.string().min(1).max(100),
    title: z.string().max(1000),
    body: z.string().max(50000),
    subreddit: z.string().max(100),
    deleted: z.boolean().optional(),
    locked: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
  rules: z
    .array(z.object({ title: z.string().max(500), description: z.string().max(10000) }))
    .max(100),
  knowledge: z.array(draftKnowledgeSchema).max(8),
  now: z.iso.datetime({ offset: true }),
  controls: draftControlsSchema.default({}),
});
export const draftGenerationSchema = z.object({
  draft: z.string().trim().min(1).max(12000),
  strategy: z.string().min(1).max(1000),
  affiliation_disclosure_included: z.boolean(),
  brand_mentioned: z.boolean(),
  suggested_link: z.string().max(2048).nullable(),
  claims: z
    .array(
      z.object({
        text: z.string().min(1).max(2000),
        source_chunk_ids: z.array(z.uuid()).max(8),
        confidence: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(60),
  limitations_mentioned: phrases,
  uncertainties: phrases,
});
export const draftClaimSchema = z.object({
  claim_text: z.string().min(1).max(2000),
  status: z.enum(['verified', 'partial', 'unsupported', 'contradicted', 'general_advice']),
  confidence: z.enum(['high', 'medium', 'low']),
  source_chunk_ids: z.array(z.uuid()).max(8),
  explanation: z.string().min(1).max(1000),
  evidence_kind: z
    .enum(['current_documentation', 'inferred', 'stale', 'none', 'advice'])
    .optional(),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
});
export const draftVerificationSchema = z.object({
  overall_status: z.enum(['pass', 'warning', 'fail']),
  claims: z.array(draftClaimSchema).max(100),
});
export const draftComplianceCheckSchema = z.object({
  code: z.enum(DRAFT_COMPLIANCE_CODES),
  status: z.enum(['pass', 'warning', 'fail']),
  message: z.string().min(1).max(1000),
  suggested_fix: z.string().max(1000).nullable(),
});
export const draftComplianceSchema = z.object({
  status: z.enum(['pass', 'warning', 'blocked']),
  checks: z.array(draftComplianceCheckSchema).length(12),
  safe_to_approve: z.boolean(),
});
export const extractedClaimsSchema = z.object({
  claims: z.array(z.object({ claim_text: z.string().min(1).max(2000) })).max(100),
});
export type DraftContext = z.infer<typeof draftContextSchema>;
export type DraftControls = z.infer<typeof draftControlsSchema>;
export type DraftKnowledge = z.infer<typeof draftKnowledgeSchema>;
export type DraftGeneration = z.infer<typeof draftGenerationSchema>;
export type DraftVerification = z.infer<typeof draftVerificationSchema>;
export type DraftClaim = z.infer<typeof draftClaimSchema>;
export type DraftCompliance = z.infer<typeof draftComplianceSchema>;
export type DraftComplianceCheck = z.infer<typeof draftComplianceCheckSchema>;
export type DraftPersona = z.infer<typeof personaInputSchema>;
