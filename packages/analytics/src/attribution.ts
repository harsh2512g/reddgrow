import { z } from 'zod';
const count = z.number().int().nonnegative();
export const revenueSchema = z.array(
  z.object({ currency: z.string().regex(/^[A-Z]{3}$/), value: z.number().finite().nonnegative() }),
);
const counts = {
  opportunities: count,
  drafts: count,
  published: count,
  clicks: count,
  signups: count,
  purchases: count,
  revenue: revenueSchema,
};
const breakdownSchema = z.array(z.object({ id: z.string(), label: z.string(), ...counts }));
export const analyticsReportSchema = z.object({
  range: z.object({ from: z.iso.date(), to: z.iso.date() }),
  attribution_days: z.number().int().min(1).max(90),
  metrics: z.object({
    ...counts,
    high_intent: count,
    approved_drafts: count,
    approval_rate: z.number().nonnegative(),
    unique_clicks: count,
    leads: count,
    click_to_signup_rate: z.number().nonnegative(),
    signup_to_purchase_rate: z.number().nonnegative(),
  }),
  funnel: z.array(z.object({ stage: z.string(), count })),
  timeseries: z.array(z.object({ date: z.iso.date(), ...counts })),
  breakdowns: z.object({
    brands: breakdownSchema,
    subreddits: breakdownSchema,
    intents: breakdownSchema,
    competitors: breakdownSchema,
    opportunities: breakdownSchema,
    styles: breakdownSchema,
  }),
});
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;
export const analyticsFiltersSchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    brandId: z.uuid().optional(),
    subredditId: z.uuid().optional(),
    opportunityId: z.uuid().optional(),
    competitorId: z.uuid().optional(),
    event: z.enum(['signup', 'lead', 'trial_started', 'purchase', 'custom']).optional(),
    intent: z
      .enum([
        'recommendation',
        'alternative',
        'comparison',
        'problem',
        'research',
        'support',
        'other',
      ])
      .optional(),
    style: z
      .enum([
        'Helpful and concise',
        'Technical',
        'Founder voice',
        'Product specialist',
        'Customer-support style',
        'Custom',
        'Unspecified',
      ])
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.from && v.to && (v.from > v.to || Date.parse(v.to) - Date.parse(v.from) > 89 * 86400000))
      c.addIssue({ code: 'custom', message: 'Choose up to 90 consecutive days.' });
  });
export type AnalyticsFilters = z.infer<typeof analyticsFiltersSchema>;
