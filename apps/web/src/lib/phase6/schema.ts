import { z } from 'zod';
export const trackingLinkSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  brand_id: z.uuid(),
  opportunity_id: z.uuid(),
  draft_id: z.uuid(),
  draft_version: z.number().int(),
  code: z.string(),
  destination_url: z.string(),
  utm_config: z.record(z.string(), z.string()),
  overwrite_utm: z.boolean(),
  status: z.enum(['active', 'revoked']),
  created_at: z.string(),
  revoked_at: z.string().nullable(),
});
export const conversionKeyRecordSchema = z.object({
  id: z.uuid(),
  brand_id: z.uuid(),
  name: z.string(),
  key_prefix: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
});
export const trackingSettingsSchema = z.object({
  attribution_days: z.number().int().min(1).max(90),
  consent_text: z.string(),
});
