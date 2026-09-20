'use client';

import { useState } from 'react';
import { z } from 'zod';
import { ArrowUpRight, Check, CreditCard, FlaskConical, Layers3, ShieldCheck } from 'lucide-react';
import { PLANS } from '@threadsignal/config';
import { Button } from '@threadsignal/ui';
import { draftRequest, draftMessage } from '@/lib/phase4/client';
import { PermissionNotice, ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import { BillingConfirmation } from './confirmation';
import {
  billingCheckoutSchema,
  billingSubscriptionSchema,
  billingUsageSchema,
  type BillingDashboardProps,
} from './types';

const metricLabels = {
  brands: 'Active brands',
  communities: 'Monitored communities',
  members: 'Team seats',
  opportunities: 'Opportunities',
  ai_drafts: 'AI drafts',
} as const;
const featureLabels = {
  clickTracking: 'Click tracking',
  conversionTracking: 'Conversion tracking',
  dailyDigest: 'Daily digest',
  advancedAnalytics: 'Advanced analytics',
  conversionApi: 'Conversion API',
  fasterMonitoring: 'Faster monitoring',
} as const;
const date = (value: string) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
type Change =
  { kind: 'plan'; plan: 'solo' | 'growth'; key: string } | { kind: 'cancel' | 'resume' };

export function BillingDashboard(props: BillingDashboardProps) {
  const [snapshot, setSnapshot] = useState({
    subscription: props.subscription,
    usage: props.usage,
  });
  const [change, setChange] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const { subscription, usage } = snapshot;
  if (!props.enabled || !subscription || !usage)
    return (
      <section className="panel p-8">
        <h2 className="text-xl font-semibold">Billing is not available in this workspace yet.</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Your Supabase database needs the billing migration and a verified billing provider before
          plan changes can be enabled.
        </p>
      </section>
    );
  const plan = PLANS[subscription.plan_key];
  const canManage = subscription.can_manage && props.organization.role === 'owner';
  const mock = props.mock && subscription.provider === 'mock';
  async function confirm() {
    if (!change || !canManage || busy) return;
    setBusy(true);
    setResult(null);
    try {
      if (change.kind === 'plan') {
        const checkout = await draftRequest(
          '/api/billing/checkout',
          z.object({ request: billingCheckoutSchema.nullable(), url: z.string().nullable() }),
          props.organization.id,
          {
            method: 'POST',
            body: JSON.stringify({ planKey: change.plan, idempotencyKey: change.key }),
          },
        );
        if (checkout.request?.provider === 'mock' && mock) {
          await draftRequest(
            '/api/billing/mock/complete',
            z.object({ subscription: billingSubscriptionSchema }),
            props.organization.id,
            {
              method: 'POST',
              body: JSON.stringify({ requestId: checkout.request.id }),
            },
          );
        } else {
          const url = checkout.url ? new URL(checkout.url) : null;
          const expectedOrigin =
            checkout.request === null
              ? 'https://billing.stripe.com'
              : 'https://checkout.stripe.com';
          if (
            mock ||
            (checkout.request !== null && checkout.request.provider !== 'stripe') ||
            !url ||
            url.origin !== expectedOrigin ||
            url.username ||
            url.password
          )
            throw new Error(
              'A verified checkout destination was not returned. Refresh before trying again.',
            );
          window.location.assign(url.href);
          return;
        }
      } else {
        await draftRequest(
          '/api/billing/portal',
          z.object({ subscription: billingSubscriptionSchema }),
          props.organization.id,
          {
            method: 'POST',
            body: JSON.stringify({ action: change.kind }),
          },
        );
      }
      const [nextSubscription, nextUsage] = await Promise.all([
        draftRequest('/api/billing/subscription', billingSubscriptionSchema, props.organization.id),
        draftRequest('/api/billing/usage', billingUsageSchema, props.organization.id),
      ]);
      if (nextSubscription.organization_id !== props.organization.id)
        throw new Error(
          'The active workspace changed. Reload this page to view its plan and usage.',
        );
      setSnapshot({ subscription: nextSubscription, usage: nextUsage });
      setResult({
        status: 'success',
        message:
          change.kind === 'cancel'
            ? `Cancellation scheduled. Your current plan remains available until ${date(nextSubscription.period_end)}.`
            : change.kind === 'resume'
              ? 'Subscription resumed. Your plan continues after this period.'
              : `${PLANS[nextSubscription.plan_key].name} is active. Your usage limits have been updated.${mock ? ' No payment was charged.' : ''}`,
      });
      setChange(null);
    } catch (issue) {
      setResult({ status: 'error', message: draftMessage(issue) });
    } finally {
      setBusy(false);
    }
  }
  async function portal() {
    setBusy(true);
    setResult(null);
    try {
      const response = await draftRequest(
        '/api/billing/portal',
        z.object({ url: z.string() }),
        props.organization.id,
        { method: 'POST', body: JSON.stringify({ action: 'open' }) },
      );
      const url = new URL(response.url);
      if (url.origin !== 'https://billing.stripe.com' || url.username || url.password)
        throw new Error('A verified billing portal was not returned.');
      window.location.assign(url.href);
    } catch (issue) {
      setResult({ status: 'error', message: draftMessage(issue) });
    } finally {
      setBusy(false);
    }
  }
  const title =
    change?.kind === 'plan'
      ? `Switch to ${PLANS[change.plan].name}?`
      : change?.kind === 'cancel'
        ? 'Cancel at the end of this period?'
        : 'Resume your subscription?';
  return (
    <div className="space-y-7">
      {mock && (
        <p className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-xs leading-6 text-primary">
          <FlaskConical size={18} className="mt-0.5 shrink-0" />
          <span>
            <strong>Development billing.</strong> Plan changes are saved to this workspace. No card
            is collected and no payment is charged.
          </span>
        </p>
      )}
      {!canManage && (
        <PermissionNotice>
          Only the organization owner can change plans or manage billing. You can view the current
          plan and usage.
        </PermissionNotice>
      )}
      {!change && <ResultNotice result={result} />}
      <section
        aria-labelledby="current-plan-heading"
        className="relative overflow-hidden rounded-[26px] border border-[#dcd7f0] bg-[#f1eff8] p-6 sm:p-8"
      >
        <div
          aria-hidden
          className="absolute -right-12 -top-12 h-56 w-56 rounded-full border-[32px] border-white/40"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="eyebrow">Your workspace plan</p>
            <h2 id="current-plan-heading" className="mt-3 text-3xl font-semibold tracking-tight">
              {plan.name} plan
              <span className="ml-3 align-middle text-xs font-medium text-primary">
                {subscription.status.replaceAll('_', ' ')}
              </span>
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {props.organization.name} ·{' '}
              {plan.key === 'trial' ? 'Seven-day trial' : `$${plan.monthlyPriceUsd} USD / month`}
            </p>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              Current period: {date(subscription.period_start)} – {date(subscription.period_end)}{' '}
              (UTC)
            </p>
            {subscription.trial_ends_at && plan.key === 'trial' && (
              <p className="text-xs leading-6">Trial ends {date(subscription.trial_ends_at)}.</p>
            )}
            {subscription.cancel_at_period_end && (
              <p role="status" className="mt-3 text-sm font-semibold text-amber-900">
                Cancellation scheduled for {date(subscription.period_end)}. Access continues until
                then.
              </p>
            )}
            {subscription.status === 'past_due' && (
              <p role="alert" className="mt-3 text-sm text-amber-900">
                Payment needs attention.
                {subscription.grace_ends_at
                  ? ` Grace period ends ${date(subscription.grace_ends_at)}.`
                  : ''}{' '}
                {subscription.active
                  ? 'Your current access is still available.'
                  : 'New usage is paused.'}
              </p>
            )}
            {!subscription.active && subscription.status !== 'past_due' && (
              <p role="status" className="mt-3 text-sm text-amber-900">
                This subscription is inactive. Choose an available plan to restore access; your
                saved work remains here.
              </p>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-primary">
              <CreditCard size={24} />
            </div>
            {canManage && subscription.provider === 'stripe' && (
              <Button variant="outline" disabled={busy} onClick={() => void portal()}>
                Manage payment details <ArrowUpRight size={14} />
              </Button>
            )}
            {canManage && mock && plan.key !== 'trial' && subscription.status !== 'canceled' && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setResult(null);
                  setChange({ kind: subscription.cancel_at_period_end ? 'resume' : 'cancel' });
                }}
              >
                {subscription.cancel_at_period_end ? 'Resume subscription' : 'Cancel subscription'}
              </Button>
            )}
          </div>
        </div>
      </section>
      <section aria-labelledby="usage-heading" className="panel p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="usage-heading" className="flex items-center gap-2 text-lg font-semibold">
            <Layers3 size={19} className="text-primary" /> A clear view of your allowance
          </h2>
          <span className="text-xs text-muted-foreground">
            {date(usage.period_start)} – {date(usage.period_end)}
          </span>
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {usage.meters.map((meter) => {
            const full = meter.used >= meter.limit;
            return (
              <div key={meter.metric} data-testid={`usage-${meter.metric}`}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">{metricLabels[meter.metric]}</span>
                  <span className={full ? 'font-semibold text-amber-900' : 'text-muted-foreground'}>
                    {meter.used} / {meter.limit}
                  </span>
                </div>
                <div
                  role="meter"
                  aria-label={metricLabels[meter.metric]}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(meter.limit, meter.used, 1)}
                  aria-valuenow={meter.used}
                  aria-valuetext={`${meter.used} of ${meter.limit} used`}
                  className="h-2 overflow-hidden rounded-full bg-[#eeedf4]"
                >
                  <div
                    className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-primary'}`}
                    style={{
                      width: `${meter.limit ? Math.min(100, (meter.used / meter.limit) * 100) : 100}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  {meter.metric === 'members'
                    ? 'Includes pending invitations.'
                    : ['brands', 'communities'].includes(meter.metric)
                      ? 'Current active allocation.'
                      : 'Usage during this subscription period.'}
                  {full ? ' Allowance reached.' : ''}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-6 border-t border-border pt-4 text-xs leading-6 text-muted-foreground">
          Limits are enforced by the server. A plan change preserves current-period usage; scheduled
          cancellation keeps your current allowance through the period end.
        </p>
      </section>
      <section aria-labelledby="plans-heading">
        <p className="eyebrow">Find your pace</p>
        <h2 id="plans-heading" className="mt-2 text-2xl font-semibold tracking-tight">
          More room for thoughtful conversations.
        </h2>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {(['solo', 'growth'] as const).map((key) => {
            const choice = PLANS[key];
            const current = key === subscription.plan_key && subscription.active;
            return (
              <article
                key={key}
                aria-labelledby={`plan-${key}`}
                className={`relative rounded-[24px] border p-6 sm:p-7 ${key === 'growth' ? 'border-violet-300 bg-[#f7f5fc]' : 'border-border bg-white'}`}
              >
                <p className="eyebrow">
                  {key === 'solo' ? 'Focused participation' : 'Team momentum'}
                </p>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <h3 id={`plan-${key}`} className="text-xl font-semibold">
                    {choice.name}
                  </h3>
                  <p className="text-2xl font-semibold">
                    ${choice.monthlyPriceUsd}
                    <span className="text-xs font-normal text-muted-foreground"> USD / month</span>
                  </p>
                </div>
                <p className="mt-5 text-sm leading-7 text-muted-foreground">
                  {choice.limits.brands} {choice.limits.brands === 1 ? 'brand' : 'brands'} ·{' '}
                  {choice.limits.monitoredSubreddits} communities · {choice.limits.members}{' '}
                  {choice.limits.members === 1 ? 'seat' : 'seats'}
                </p>
                <p className="text-sm leading-7 text-muted-foreground">
                  {choice.limits.opportunities} opportunities · {choice.limits.aiDrafts} AI drafts
                  each month
                </p>
                <ul className="my-6 grid gap-2 text-xs sm:grid-cols-2">
                  {Object.entries(choice.features)
                    .filter(([, enabled]) => enabled)
                    .map(([feature]) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check size={14} className="shrink-0 text-primary" />
                        {featureLabels[feature as keyof typeof featureLabels]}
                      </li>
                    ))}
                </ul>
                <Button
                  className="w-full"
                  variant={key === 'growth' ? 'default' : 'outline'}
                  disabled={!canManage || busy || current}
                  onClick={() => {
                    setResult(null);
                    setChange({ kind: 'plan', plan: key, key: crypto.randomUUID() });
                  }}
                >
                  {current ? 'Current plan' : `Choose ${choice.name}`} <ArrowUpRight size={15} />
                </Button>
              </article>
            );
          })}
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs leading-6 text-muted-foreground">
          <ShieldCheck size={15} className="shrink-0 text-primary" /> Every plan keeps publication
          in human hands. ThreadSignal never submits Reddit replies.
        </p>
      </section>
      <BillingConfirmation
        open={change !== null}
        title={title}
        busy={busy}
        onClose={() => {
          setChange(null);
          setResult(null);
        }}
        onConfirm={() => void confirm()}
        confirmLabel={
          change?.kind === 'plan'
            ? mock
              ? change.plan === 'solo' && subscription.plan_key === 'growth'
                ? 'Confirm development downgrade'
                : 'Confirm development upgrade'
              : 'Continue to secure checkout'
            : change?.kind === 'cancel'
              ? 'Confirm cancellation'
              : 'Confirm resume'
        }
      >
        {change?.kind === 'plan' ? (
          <>
            <p>
              {PLANS[change.plan].name} includes {PLANS[change.plan].limits.aiDrafts} AI drafts,{' '}
              {PLANS[change.plan].limits.opportunities} opportunities, and{' '}
              {PLANS[change.plan].limits.monitoredSubreddits} monitored communities per month.
            </p>
            <p>
              {mock
                ? 'This development checkout updates the plan in your Supabase workspace without collecting payment details or charging money.'
                : `The plan is $${PLANS[change.plan].monthlyPriceUsd} USD per month. Review the total in Stripe before purchasing.`}
            </p>
            <p>
              Existing usage carries forward. Switching to a smaller plan can pause new work when
              your current usage exceeds its limits.
            </p>
          </>
        ) : change?.kind === 'cancel' ? (
          <p>
            Your current plan stays available until {date(subscription.period_end)}. Renewal will be
            canceled; you can resume before this date.
          </p>
        ) : (
          <p>
            Your {plan.name} plan will continue after {date(subscription.period_end)} with its
            existing limits.
          </p>
        )}
        <ResultNotice result={result} />
      </BillingConfirmation>
    </div>
  );
}
