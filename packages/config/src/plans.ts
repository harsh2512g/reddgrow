import { z } from 'zod';

export const planKeySchema = z.enum(['trial', 'solo', 'growth']);
export type PlanKey = z.infer<typeof planKeySchema>;

export interface PlanDefinition {
  readonly key: PlanKey;
  readonly name: string;
  readonly monthlyPriceUsd: number;
  readonly trialDays: number | null;
  readonly limits: {
    readonly organizations: number;
    readonly brands: number;
    readonly monitoredSubreddits: number;
    readonly opportunities: number;
    readonly aiDrafts: number;
    readonly members: number;
  };
  readonly opportunityPeriod: 'trial' | 'month';
  readonly features: {
    readonly clickTracking: boolean;
    readonly conversionTracking: boolean;
    readonly dailyDigest: boolean;
    readonly advancedAnalytics: boolean;
    readonly conversionApi: boolean;
    readonly fasterMonitoring: boolean;
  };
}

/** Specification §7.20. The database mirror is verified by integration tests. */
export const PLANS = {
  trial: {
    key: 'trial',
    name: 'Trial',
    monthlyPriceUsd: 0,
    trialDays: 7,
    limits: {
      organizations: 1,
      brands: 1,
      monitoredSubreddits: 3,
      opportunities: 20,
      aiDrafts: 10,
      members: 1,
    },
    opportunityPeriod: 'trial',
    features: {
      clickTracking: true,
      conversionTracking: false,
      dailyDigest: false,
      advancedAnalytics: false,
      conversionApi: false,
      fasterMonitoring: false,
    },
  },
  solo: {
    key: 'solo',
    name: 'Solo',
    monthlyPriceUsd: 29,
    trialDays: null,
    limits: {
      organizations: 1,
      brands: 1,
      monitoredSubreddits: 10,
      opportunities: 100,
      aiDrafts: 60,
      members: 1,
    },
    opportunityPeriod: 'month',
    features: {
      clickTracking: true,
      conversionTracking: true,
      dailyDigest: true,
      advancedAnalytics: false,
      conversionApi: false,
      fasterMonitoring: false,
    },
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    monthlyPriceUsd: 79,
    trialDays: null,
    limits: {
      organizations: 1,
      brands: 3,
      monitoredSubreddits: 40,
      opportunities: 500,
      aiDrafts: 300,
      members: 5,
    },
    opportunityPeriod: 'month',
    features: {
      clickTracking: true,
      conversionTracking: true,
      dailyDigest: true,
      advancedAnalytics: true,
      conversionApi: true,
      fasterMonitoring: true,
    },
  },
} as const satisfies Readonly<Record<PlanKey, PlanDefinition>>;

export function getPlan(key: PlanKey): PlanDefinition {
  return PLANS[key];
}

export function isTrialExpired(trialEndsAt: string | null, now: Date = new Date()): boolean {
  if (trialEndsAt === null) return false;
  const expiry = Date.parse(trialEndsAt);
  return !Number.isFinite(expiry) || expiry <= now.getTime();
}
