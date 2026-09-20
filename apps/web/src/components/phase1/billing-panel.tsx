import { Check, CircleDollarSign, CreditCard, Gauge, Sparkles } from 'lucide-react';
import { PermissionNotice } from './primitives';
import type { PlanCard } from './types';

export { getPlanCards } from './plan-cards-data';

export function PlanCards({ plans, activePlanId }: { plans: PlanCard[]; activePlanId?: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {plans.map((plan) => (
        <article
          key={plan.id}
          className={`relative flex flex-col rounded-2xl border p-6 ${plan.id === 'solo' ? 'border-primary/50 bg-[#f6f5fd] shadow-[0_8px_30px_-20px_#5144ca70]' : 'border-border bg-white'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{plan.name}</h3>
            {activePlanId === plan.id && (
              <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold text-white">
                Current plan
              </span>
            )}
          </div>
          <p className="mt-5 text-3xl font-semibold tracking-tight">{plan.price}</p>
          <p className="mt-3 min-h-10 text-xs leading-6 text-muted-foreground">
            {plan.description}
          </p>
          <ul className="mb-2 mt-6 space-y-3 border-t border-border pt-5">
            {plan.limits.map((limit) => (
              <li key={limit} className="flex items-start gap-2 text-xs leading-5">
                <Check aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-primary" />
                {limit}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export function BillingPanel({
  planName,
  status,
  trialEndsAt,
  usage,
  plans,
  canManage,
}: {
  planName: string;
  status: string;
  trialEndsAt: string;
  usage: { label: string; used: number; limit: number }[];
  plans: PlanCard[];
  canManage: boolean;
}) {
  const endDate = new Date(trialEndsAt).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <div className="space-y-7">
      {!canManage && (
        <PermissionNotice>
          Billing changes are reserved for the organization owner. You can review your
          organization’s plan here.
        </PermissionNotice>
      )}
      <section className="panel grid overflow-hidden md:grid-cols-[1.2fr_1fr]">
        <div className="p-6 sm:p-7">
          <p className="eyebrow">Your subscription</p>
          <div className="mt-5 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-violet-50 text-primary">
              <Sparkles size={22} />
            </span>
            <h2 className="text-2xl font-semibold tracking-tight">{planName}</h2>
            <span className="status-pill capitalize">{status.replaceAll('_', ' ')}</span>
          </div>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Trial record: ends {endDate}. Your workspace keeps its data when a limit is reached.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 border-t border-border bg-muted/40 p-6 md:border-l md:border-t-0 sm:p-7">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard size={18} className="text-primary" /> No payment method connected
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            Billing is in local mock mode. Paid checkout is not available, and no card or payment is
            collected.
          </p>
        </div>
      </section>
      <section className="panel p-6 sm:p-7">
        <h2 className="flex items-center gap-2 font-semibold">
          <Gauge size={18} className="text-primary" /> Plan allocation
        </h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          Current allocation from your organization’s records. Product usage begins when those
          workflows become available.
        </p>
        <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {usage.map((item) => (
            <div key={item.label}>
              <div className="mb-2.5 flex items-center justify-between gap-3 text-xs">
                <label htmlFor={`usage-${item.label.replaceAll(' ', '-')}`} className="font-medium">
                  {item.label}
                </label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {item.used} / {item.limit}
                </span>
              </div>
              <meter
                id={`usage-${item.label.replaceAll(' ', '-')}`}
                min={0}
                max={item.limit}
                value={item.used}
                className="usage-meter block h-1.5 w-full"
              >
                {item.used} of {item.limit}
              </meter>
            </div>
          ))}
        </div>
      </section>
      <div>
        <div className="mb-5 flex items-center gap-2">
          <CircleDollarSign size={18} className="text-primary" />
          <h2 className="font-semibold">A plan for your pace.</h2>
        </div>
        <PlanCards plans={plans} activePlanId={planName.toLowerCase()} />
        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          Published plan limits are shown for comparison. New usage above the active plan’s limit is
          blocked server-side; existing data is retained. Live checkout comes in the billing
          release.
        </p>
      </div>
    </div>
  );
}
