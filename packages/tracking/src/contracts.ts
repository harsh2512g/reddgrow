import { z } from 'zod';
import { supportedCurrencies, validMonetaryAmount } from './currency.js';

export const conversionEventNameSchema = z.enum([
  'signup',
  'lead',
  'trial_started',
  'purchase',
  'custom',
]);
export type ConversionEventName = z.infer<typeof conversionEventNameSchema>;
export const trackingCurrencySchema = z.enum(supportedCurrencies);
export const trackingCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{12,64}$/);
export const clickTokenSchema = z.string().regex(/^tsp_[A-Za-z0-9_-]{43}$/);
export const conversionKeySchema = z.string().regex(/^tsk_[A-Za-z0-9_-]{43}$/);
const opaqueId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const label = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9 _.-]+$/);
export const conversionMetadataSchema = z
  .object({ plan: label.optional(), customName: label.optional() })
  .strict();
export const utmConfigSchema = z
  .object({
    source: z.string().trim().min(1).max(120).default('reddit'),
    medium: z.string().trim().min(1).max(120).default('community'),
    campaign: z.string().trim().min(1).max(120).default('threadsignal'),
    content: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type UtmConfig = z.infer<typeof utmConfigSchema>;
export const trackingLinkInputSchema = z
  .object({
    draftId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    destinationUrl: z.string().min(1).max(2048),
    utm: utmConfigSchema.default({
      source: 'reddit',
      medium: 'community',
      campaign: 'threadsignal',
    }),
    overwriteUtm: z.boolean().default(false),
  })
  .strict();
export type TrackingLinkInput = z.infer<typeof trackingLinkInputSchema>;
const conversionShape = {
  clickId: z.uuid(),
  event: conversionEventNameSchema,
  externalId: opaqueId.optional(),
  idempotencyKey: z.uuid().optional(),
  value: z.number().finite().min(0).max(1_000_000_000).default(0),
  currency: trackingCurrencySchema.default('USD'),
  occurredAt: z.iso.datetime({ offset: true }),
  metadata: conversionMetadataSchema.default({}),
};
function validateConversion(
  value: {
    externalId?: string | undefined;
    idempotencyKey?: string | undefined;
    value: number;
    currency: string;
    event: string;
    metadata: { customName?: string | undefined };
  },
  ctx: z.RefinementCtx,
) {
  if (!value.externalId && !value.idempotencyKey)
    ctx.addIssue({
      code: 'custom',
      message: 'Provide an external ID or idempotency key.',
      path: ['idempotencyKey'],
    });
  if (!validMonetaryAmount(value.value, value.currency))
    ctx.addIssue({
      code: 'custom',
      message: 'Use the currency’s supported decimal precision.',
      path: ['value'],
    });
  if (value.event === 'custom' && !value.metadata.customName)
    ctx.addIssue({
      code: 'custom',
      message: 'Custom events require a custom name.',
      path: ['metadata', 'customName'],
    });
}
export const conversionInputSchema = z
  .object(conversionShape)
  .strict()
  .superRefine(validateConversion);
export const browserEventInputSchema = z
  .object({
    ...conversionShape,
    brandId: z.uuid(),
    clickToken: clickTokenSchema,
    consent: z.literal(true),
  })
  .strict()
  .superRefine(validateConversion);
export type ConversionInput = z.infer<typeof conversionInputSchema>;
export type BrowserEventInput = z.infer<typeof browserEventInputSchema>;
export const createConversionKeyInputSchema = z
  .object({
    brandId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    rotateKeyId: z.uuid().optional(),
  })
  .strict();
export const attributionSettingsSchema = z
  .object({
    attributionDays: z.number().int().min(1).max(90),
    consentText: z.string().trim().min(20).max(500),
  })
  .strict();
