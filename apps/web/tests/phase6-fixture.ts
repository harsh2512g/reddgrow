import { brandSchema, demoBrand } from '@threadsignal/knowledge';
import { analyticsReportSchema } from '@threadsignal/analytics';
import { trackingLinkSchema, conversionKeyRecordSchema } from '../src/lib/phase6/schema';
export const p6ids = {
  organization: '11111111-1111-4111-8111-111111111111',
  brand: '22222222-2222-4222-8222-222222222222',
  draft: '33333333-3333-4333-8333-333333333333',
  link: '44444444-4444-4444-8444-444444444444',
  key: '55555555-5555-4555-8555-555555555555',
  opportunity: '66666666-6666-4666-8666-666666666666',
  subreddit: '77777777-7777-4777-8777-777777777777',
};
export const phase6Brand = brandSchema.parse({
  id: p6ids.brand,
  organization_id: p6ids.organization,
  name: demoBrand.name,
  website_url: demoBrand.website_url,
  profile: demoBrand,
  status: 'active',
  created_at: '2026-09-18T00:00:00Z',
});
export const phase6Link = trackingLinkSchema.parse({
  id: p6ids.link,
  organization_id: p6ids.organization,
  brand_id: p6ids.brand,
  opportunity_id: p6ids.opportunity,
  draft_id: p6ids.draft,
  draft_version: 3,
  code: 'unitTrackingCode123',
  destination_url: demoBrand.website_url,
  utm_config: { source: 'reddit', medium: 'community', campaign: 'threadsignal' },
  overwrite_utm: false,
  status: 'active',
  created_at: '2026-09-18T00:00:00Z',
  revoked_at: null,
});
export const phase6Key = conversionKeyRecordSchema.parse({
  id: p6ids.key,
  brand_id: p6ids.brand,
  name: 'Test server',
  key_prefix: 'tsk_unit',
  created_at: '2026-09-18T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
});
export const phase6Settings = {
  attribution_days: 30,
  consent_text: 'Allow attribution of this visit and consented conversion events.',
};
export function analyticsFixture() {
  const counts = {
    opportunities: 8,
    drafts: 4,
    published: 2,
    clicks: 6,
    signups: 2,
    purchases: 1,
    revenue: [
      { currency: 'USD', value: 99 },
      { currency: 'EUR', value: 25 },
    ],
  };
  const row = { ...counts, id: p6ids.subreddit, label: 'r/SaaS' };
  return analyticsReportSchema.parse({
    range: { from: '2026-09-01', to: '2026-09-18' },
    attribution_days: 30,
    metrics: {
      ...counts,
      high_intent: 3,
      approved_drafts: 2,
      approval_rate: 50,
      unique_clicks: 5,
      leads: 1,
      click_to_signup_rate: 33.3,
      signup_to_purchase_rate: 50,
    },
    funnel: [
      { stage: 'opportunities', count: 8 },
      { stage: 'clicks', count: 6 },
      { stage: 'purchases', count: 1 },
    ],
    timeseries: [{ ...counts, date: '2026-09-18' }],
    breakdowns: {
      brands: [{ ...row, id: p6ids.brand, label: 'ClarityScale AI' }],
      subreddits: [row],
      intents: [{ ...row, id: 'recommendation', label: 'recommendation' }],
      competitors: [],
      opportunities: [{ ...row, id: p6ids.opportunity, label: 'A useful conversation' }],
      styles: [{ ...row, id: 'helpful', label: 'helpful' }],
    },
  });
}
