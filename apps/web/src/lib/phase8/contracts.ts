import { z } from 'zod';

const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
export const jobFamilySchema = z.enum(['knowledge', 'reddit', 'draft', 'notification', 'privacy']);
export const jobStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'sent',
  'suppressed',
]);
export const operationReasonSchema = z.enum([
  'security_review',
  'provider_failure',
  'customer_request',
  'maintenance',
  'recovered',
]);
export const pageCursorSchema = z.object({ created_at: timestamp, id: z.uuid() }).strict();
export const organizationSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().max(100),
    slug: z.string().max(48),
    status: z.enum(['active', 'suspended', 'deleted']),
    created_at: timestamp,
    plan: z.enum(['trial', 'solo', 'growth']).nullable(),
    subscription_status: z.string().max(40).nullable(),
    member_count: count,
    brand_count: count,
  })
  .strict();
export const organizationsPageSchema = z
  .object({ items: z.array(organizationSummarySchema).max(50), next_cursor: z.uuid().nullable() })
  .strict();
export const jobSummarySchema = z
  .object({
    id: z.uuid(),
    family: jobFamilySchema,
    kind: z.string().max(40),
    organization_id: z.uuid().nullable(),
    status: jobStatusSchema,
    attempts: count.max(3),
    error_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,79}$/)
      .nullable(),
    created_at: timestamp,
    updated_at: timestamp,
    available_at: timestamp,
    retry_available: z.boolean(),
  })
  .strict();
export const jobsPageSchema = z
  .object({ items: z.array(jobSummarySchema).max(50), next_cursor: pageCursorSchema.nullable() })
  .strict();
export const jobCountSchema = z
  .object({ family: jobFamilySchema, status: jobStatusSchema, count })
  .strict();
export const operationalMetricsSchema = z
  .object({
    jobs: z.array(jobCountSchema),
    knowledge_ready: count,
    knowledge_failed: count,
    draft_pass: count,
    draft_warning: count,
    draft_blocked: count,
    ai_input_tokens: count,
    ai_output_tokens: count,
    ai_estimated_cost_usd: z.number().nonnegative(),
    billing_applied: count,
    billing_stale: count,
    billing_last_received_at: timestamp.nullable(),
  })
  .strict();
export const overviewSchema = z
  .object({
    organizations: z.object({ total: count, active: count, suspended: count }).strict(),
    metrics: operationalMetricsSchema,
    generated_at: timestamp,
  })
  .strict();
export const organizationDetailSchema = z
  .object({
    organization: organizationSummarySchema,
    timezone: z.string().max(100),
    currency: z.string().length(3),
    usage: z
      .array(
        z
          .object({
            metric: z.enum(['opportunities', 'ai_drafts']),
            quantity: count,
            period_start: timestamp,
            period_end: timestamp,
          })
          .strict(),
      )
      .max(100),
    metrics: operationalMetricsSchema,
  })
  .strict();
export const retryResultSchema = z.object({ job_id: z.uuid(), replayed: z.boolean() }).strict();
export const statusResultSchema = z
  .object({
    organization_id: z.uuid(),
    status: z.enum(['active', 'suspended']),
    replayed: z.boolean(),
  })
  .strict();
export const activityPageSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            action: z.string().max(100),
            target_type: z.string().max(100),
            target_id: z.uuid().nullable(),
            actor_user_id: z.uuid().nullable(),
            actor_type: z.enum(['user', 'system']),
            created_at: timestamp,
          })
          .strict(),
      )
      .max(50),
    next_cursor: pageCursorSchema.nullable(),
  })
  .strict();
export type JobFamily = z.infer<typeof jobFamilySchema>;
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type OperationsOverview = z.infer<typeof overviewSchema>;
export type ActivityPage = z.infer<typeof activityPageSchema>;
