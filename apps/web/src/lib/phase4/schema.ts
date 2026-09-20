import { z } from 'zod';
import { draftComplianceCheckSchema, personaInputSchema } from '@threadsignal/drafts';
import { opportunitySchema, ruleSchema } from '../phase3/schema';
export const draftStatusSchema = z.enum([
  'generating',
  'ready',
  'editing',
  'warning',
  'blocked',
  'approved',
  'rejected',
  'error',
]);
export const draftRecordSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  opportunity_id: z.uuid(),
  persona_id: z.uuid(),
  status: draftStatusSchema,
  current_version: z.number().int().nonnegative(),
  verified_version: z.number().int().nullable(),
  current_content: z.string().max(12000),
  strategy: z.string(),
  brand_mentioned: z.boolean(),
  disclosure_included: z.boolean(),
  verification_status: z.enum(['pending', 'pass', 'warning', 'fail']),
  compliance_status: z.enum(['pending', 'pass', 'warning', 'blocked']),
  approved_by: z.uuid().nullable(),
  approved_at: z.string().nullable(),
  inserted_at: z.string().nullable().default(null),
  inserted_version: z.number().int().positive().nullable().default(null),
  published_at: z.string().nullable().default(null),
  published_version: z.number().int().positive().nullable().default(null),
  published_comment_url: z.string().nullable().default(null),
  rejection_reason: z.string().nullable(),
  error_code: z.string().nullable(),
  purged_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export const draftVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  content: z.string(),
  source: z.enum(['ai', 'user', 'system_fix']),
  instruction: z.string(),
  created_by: z.uuid().nullable(),
  created_at: z.string(),
});
export const provenanceSchema = z.object({
  chunk_id: z.uuid(),
  source_id: z.uuid(),
  document_id: z.uuid(),
  title: z.string(),
  source_url: z.string().nullable(),
  filename: z.string().nullable(),
  page_number: z.number().nullable(),
  section_heading: z.string().nullable(),
  updated_at: z.string(),
  excerpt: z.string(),
});
export const claimRecordSchema = z.object({
  id: z.uuid(),
  draft_version_id: z.uuid(),
  claim_text: z.string(),
  status: z.enum(['verified', 'partial', 'unsupported', 'contradicted', 'general_advice']),
  confidence: z.enum(['high', 'medium', 'low']),
  explanation: z.string(),
  source_chunk_ids: z.array(z.uuid()),
  provenance: z.array(provenanceSchema),
  evidence_kind: z.enum(['current_documentation', 'inferred', 'stale', 'none', 'advice']),
});
export const checkRecordSchema = z.object({
  id: z.uuid(),
  draft_version_id: z.uuid(),
  status: z.enum(['pass', 'warning', 'blocked']),
  checks: z.array(draftComplianceCheckSchema),
  safe_to_approve: z.boolean(),
  created_at: z.string(),
});
export const jobRecordSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['generate', 'verify', 'compliance']),
  version: z.number().int(),
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  attempts: z.number().int(),
  error_code: z.string().nullable(),
  created_at: z.string(),
});
export const draftReviewSchema = z.object({
  context_current: z.boolean(),
  responsible_use_accepted: z.boolean(),
});
export const draftDetailSchema = z.object({
  draft: draftRecordSchema,
  versions: z.array(draftVersionSchema),
  claims: z.array(claimRecordSchema),
  checks: z.array(checkRecordSchema),
  jobs: z.array(jobRecordSchema),
  persona: personaInputSchema,
  opportunity: opportunitySchema,
  rules: z.array(ruleSchema),
  review: draftReviewSchema,
});
export type DraftDetail = z.infer<typeof draftDetailSchema>;
export type DraftRecord = z.infer<typeof draftRecordSchema>;
export type DraftClaimRecord = z.infer<typeof claimRecordSchema>;
export const draftFiltersSchema = z.object({
  brandId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  status: z.preprocess((v) => (v === '' ? undefined : v), draftStatusSchema.optional()),
  q: z.string().trim().max(100).default(''),
  cursor: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(512).optional()),
});
export function approvalAvailable(detail: DraftDetail, unsaved: boolean) {
  const { draft, review, checks, claims } = detail;
  const version = detail.versions.find((v) => v.version === draft.current_version);
  const check = checks.find((c) => c.draft_version_id === version?.id);
  return (
    !unsaved &&
    review.context_current &&
    draft.verified_version === draft.current_version &&
    ['ready', 'warning'].includes(draft.status) &&
    Boolean(check?.safe_to_approve) &&
    !claims.some(
      (c) =>
        c.draft_version_id === version?.id && ['unsupported', 'contradicted'].includes(c.status),
    ) &&
    !detail.jobs.some((j) => ['queued', 'processing'].includes(j.status))
  );
}
