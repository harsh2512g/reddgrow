import { z } from 'zod';
import { planKeySchema } from '@threadsignal/config';

const dateTime = z.string().datetime({ offset: true });
export const billingSubscriptionSchema = z.object({
  organization_id: z.uuid(),
  provider: z.enum(['mock', 'stripe']),
  plan_key: planKeySchema,
  status: z.enum([
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
    'incomplete_expired',
    'paused',
    'expired',
  ]),
  period_start: dateTime,
  period_end: dateTime,
  cancel_at_period_end: z.boolean(),
  grace_ends_at: dateTime.nullable(),
  trial_ends_at: dateTime.nullable(),
  can_manage: z.boolean(),
  active: z.boolean(),
  billing_email: z.string().email().nullable(),
  customer_id: z.string().nullable(),
  subscription_id: z.string().nullable(),
});
export const billingUsageSchema = z.object({
  period_start: dateTime,
  period_end: dateTime,
  meters: z.array(
    z.object({
      metric: z.enum(['brands', 'communities', 'members', 'opportunities', 'ai_drafts']),
      used: z.number().int().nonnegative(),
      limit: z.number().int().nonnegative(),
    }),
  ),
  features: z.object({
    clickTracking: z.boolean(),
    conversionTracking: z.boolean(),
    dailyDigest: z.boolean(),
    advancedAnalytics: z.boolean(),
    conversionApi: z.boolean(),
    fasterMonitoring: z.boolean(),
  }),
});
export const billingCheckoutSchema = z.object({
  id: z.uuid(),
  organization_id: z.uuid(),
  plan_key: z.enum(['solo', 'growth']),
  provider: z.enum(['mock', 'stripe']),
  status: z.enum(['pending', 'completed', 'expired']),
  expires_at: dateTime,
});
export const notificationCategoryLabels = {
  welcome: 'Welcome and onboarding',
  invitation: 'Team invitations',
  ingestion_complete: 'Knowledge ready',
  ingestion_failed: 'Knowledge processing failed',
  daily_digest: 'Daily opportunity digest',
  high_score_alert: 'High-score opportunities',
  trial_ending: 'Trial ending',
  usage_limit: 'Usage limits',
  payment_failed: 'Payment failed',
  subscription_changed: 'Subscription changes',
} as const;
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use a valid time.');
export const notificationPreferencesSchema = z
  .object({
    categories: z
      .object({
        welcome: z.boolean(),
        invitation: z.boolean(),
        ingestion_complete: z.boolean(),
        ingestion_failed: z.boolean(),
        daily_digest: z.boolean(),
        high_score_alert: z.boolean(),
        trial_ending: z.boolean(),
        usage_limit: z.boolean(),
        payment_failed: z.boolean(),
        subscription_changed: z.boolean(),
      })
      .strict(),
    digest_time: clockTime,
    minimum_score: z.number().int().min(0).max(100),
    quiet_start: clockTime.nullable(),
    quiet_end: clockTime.nullable(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid timezone.'),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.quiet_start === null) !== (value.quiet_end === null))
      context.addIssue({
        code: 'custom',
        path: ['quiet_end'],
        message: 'Set both quiet-hour times, or leave both empty.',
      });
    if (value.quiet_start !== null && value.quiet_start === value.quiet_end)
      context.addIssue({
        code: 'custom',
        path: ['quiet_end'],
        message: 'Quiet hours must have different start and end times.',
      });
  });
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;
export type BillingUsage = z.infer<typeof billingUsageSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type BillingOrganization = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
};
export type BillingDashboardProps = {
  enabled: boolean;
  organization: BillingOrganization;
  subscription: BillingSubscription | null;
  usage: BillingUsage | null;
  mock: boolean;
};
export type NotificationSettingsProps = {
  enabled: boolean;
  organization: BillingOrganization;
  preferences: NotificationPreferences | null;
  dailyDigestAvailable: boolean;
  consoleMode: boolean;
};
