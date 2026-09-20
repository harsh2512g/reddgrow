import { PLANS } from '@threadsignal/config';
import type { PlanCard } from './types';

export function getPlanCards(): PlanCard[] {
  return Object.values(PLANS).map((plan) => ({
    id: plan.key,
    name: plan.name,
    price: plan.trialDays ? `$0 / ${plan.trialDays} days` : `$${plan.monthlyPriceUsd} / month`,
    description:
      plan.key === 'trial'
        ? 'A little room to find your signal. No card required.'
        : plan.key === 'solo'
          ? 'A focused workspace for one person and one product.'
          : 'More product context. More room for your team.',
    limits: [
      `${plan.limits.brands} ${plan.limits.brands === 1 ? 'brand' : 'brands'}`,
      `${plan.limits.monitoredSubreddits} monitored subreddits`,
      `${plan.limits.opportunities} opportunities / ${plan.opportunityPeriod}`,
      `${plan.limits.aiDrafts} AI drafts / ${plan.opportunityPeriod}`,
      `${plan.limits.members} ${plan.limits.members === 1 ? 'team member' : 'team members'}`,
      plan.features.conversionTracking ? 'Click and conversion tracking' : 'Click tracking',
      ...(plan.features.dailyDigest ? ['Daily digest'] : []),
      ...(plan.features.conversionApi ? ['Conversion API and advanced analytics'] : []),
    ],
  }));
}
