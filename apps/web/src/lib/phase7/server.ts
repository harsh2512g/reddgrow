import 'server-only';
import { requireOrganization } from '../organizations/server';
import { localOpportunitiesEnabled } from '../phase3/server';
import { getServerEnv } from '../env/server';
import {
  billingSubscriptionSchema,
  billingUsageSchema,
  notificationPreferencesSchema,
} from '@/components/phase7/types';
import { checked } from './errors';

export const billingEnabled = localOpportunitiesEnabled;
export async function loadBilling() {
  const { organization, supabase } = await requireOrganization();
  const enabled = billingEnabled();
  if (!enabled) return { enabled, organization, subscription: null, usage: null, mock: true };
  const [subscription, usage] = await Promise.all([
    supabase.rpc('get_billing_subscription', { p_organization_id: organization.id }),
    supabase.rpc('get_billing_usage', { p_organization_id: organization.id }),
  ]);
  return {
    enabled,
    organization,
    subscription: billingSubscriptionSchema.parse(checked(subscription)),
    usage: billingUsageSchema.parse(checked(usage)),
    mock: getServerEnv().BILLING_PROVIDER === 'mock',
  };
}
export async function loadNotificationPreferences() {
  const { organization, supabase } = await requireOrganization();
  const enabled = billingEnabled();
  if (!enabled)
    return {
      enabled,
      organization,
      preferences: null,
      dailyDigestAvailable: false,
      consoleMode: true,
    };
  const [preferences, usage] = await Promise.all([
    supabase.rpc('get_notification_preferences', { p_organization_id: organization.id }),
    supabase.rpc('get_billing_usage', { p_organization_id: organization.id }),
  ]);
  return {
    enabled,
    organization,
    preferences: notificationPreferencesSchema.parse(checked(preferences)),
    dailyDigestAvailable: billingUsageSchema.parse(checked(usage)).features.dailyDigest,
    consoleMode: getServerEnv().EMAIL_PROVIDER === 'console',
  };
}
