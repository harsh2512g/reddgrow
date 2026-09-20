'use client';

import { useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Coins,
  Filter,
  Link2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import type { AnalyticsReport } from '@threadsignal/analytics';
import type { Role } from '../phase1/types';
import { PageHeading } from '../phase1/primitives';
import { ActivityFunnel, TrendChart } from './charts';
import { RevenueValues, formatCount, formatDate, formatPercent, formatRevenue } from './format';

export type AnalyticsFilters = {
  from: string;
  to: string;
  brandId?: string | undefined;
  subredditId?: string | undefined;
  opportunityId?: string | undefined;
  event?: string | undefined;
  intent?: string | undefined;
  competitorId?: string | undefined;
  style?: string | undefined;
};
type Option = { id: string; name: string };
export type AnalyticsDashboardProps = {
  enabled: boolean;
  organization: { id: string; name: string; role: Role };
  filters: AnalyticsFilters;
  options: {
    brands: Option[];
    subreddits: Option[];
    opportunities: Option[];
    competitors: Option[];
  };
  analytics: AnalyticsReport | null;
  invalidFilters?: boolean | undefined;
  advancedAnalytics?: boolean;
};
const dimensions = [
  ['brands', 'Brands', 'brandId'],
  ['subreddits', 'Communities', 'subredditId'],
  ['intents', 'Intent', 'intent'],
  ['competitors', 'Competitors', 'competitorId'],
  ['opportunities', 'Opportunities', 'opportunityId'],
  ['styles', 'Draft style', 'style'],
] as const;
const stageLabels: Record<string, string> = {
  opportunities: 'Opportunities',
  drafts: 'Drafts prepared',
  published: 'Published manually',
  clicks: 'Clicks recorded',
  signups: 'Signups attributed',
  purchases: 'Purchases attributed',
};
const inputClass = 'form-input min-w-0';

export function AnalyticsDashboard({
  enabled,
  organization,
  filters,
  options,
  analytics,
  invalidFilters = false,
  advancedAnalytics = false,
}: AnalyticsDashboardProps) {
  const [dimension, setDimension] = useState<(typeof dimensions)[number][0]>('subreddits');
  const [selectedCurrency, setCurrency] = useState(analytics?.metrics.revenue[0]?.currency ?? '');
  const currencies = [
    ...new Set([
      ...(analytics?.metrics.revenue ?? []).map((amount) => amount.currency),
      ...(analytics?.timeseries ?? []).flatMap((point) =>
        point.revenue.map((amount) => amount.currency),
      ),
    ]),
  ];
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];
  return (
    <>
      <PageHeading
        eyebrow="Attribution studio"
        title="Follow the conversation further."
        description={`See how thoughtful participation connects to visits and customer actions for ${organization.name}. Every number comes from your workspace’s records.`}
        action={
          <Button asChild variant="outline">
            <Link href="/app/tracking">
              <Link2 size={16} /> Manage tracking links
            </Link>
          </Button>
        }
      />
      {!enabled ? (
        <AnalyticsUnavailable />
      ) : (
        <>
          <AnalyticsFilterBar
            filters={filters}
            options={options}
            advancedAnalytics={advancedAnalytics}
          />
          {invalidFilters && (
            <p
              role="alert"
              className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            >
              These filters could not be applied. Choose valid workspace filters and a date range of
              at most 90 days. Competitor and draft-style filters require Growth.
            </p>
          )}
          {analytics && (
            <>
              <section
                className="relative mb-6 overflow-hidden rounded-[26px] border border-violet-200 bg-[#f0edf9] p-6 sm:p-8"
                aria-labelledby="attributed-revenue-title"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full border-[35px] border-white/45"
                />
                <div className="relative grid gap-7 lg:grid-cols-[1.35fr_1fr]">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                      <Coins size={16} aria-hidden="true" /> A clearer picture of contribution
                    </div>
                    <h2
                      id="attributed-revenue-title"
                      className="mt-4 text-sm font-semibold text-muted-foreground"
                    >
                      Attributed revenue
                    </h2>
                    {analytics.metrics.revenue.length ? (
                      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-4">
                        {analytics.metrics.revenue.map((amount) => (
                          <p
                            key={amount.currency}
                            data-testid={`revenue-${amount.currency}`}
                            className="text-3xl font-semibold tracking-[-0.05em] sm:text-4xl"
                          >
                            {formatRevenue(amount.value, amount.currency)}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <>
                        <p className="mt-3 text-3xl font-semibold tracking-[-0.05em]">
                          No attributed revenue yet
                        </p>
                        <p className="mt-3 text-xs leading-6 text-muted-foreground">
                          Purchases linked to a valid tracked click will appear here, grouped by
                          currency.
                        </p>
                      </>
                    )}
                    <p className="mt-4 text-xs leading-6 text-muted-foreground">
                      {formatDate(analytics.range.from)} – {formatDate(analytics.range.to)} · UTC
                      <br />
                      Currencies are reported separately; no exchange-rate conversion is applied.
                    </p>
                  </div>
                  <div className="self-center rounded-2xl border border-white bg-white/65 p-5">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <Sparkles size={16} className="text-primary" aria-hidden="true" /> Understand
                      what attribution means
                    </div>
                    <p className="mt-3 text-xs leading-6 text-muted-foreground">
                      Customer actions are connected to a recorded click within your attribution
                      window. This shows an attributed relationship, not proof that a conversation
                      caused a purchase.
                    </p>
                    <Link
                      href="/app/settings/integrations#conversion-settings"
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                    >
                      Current window: {analytics.attribution_days} days <ArrowUpRight size={13} />
                    </Link>
                  </div>
                </div>
              </section>
              <MetricTiles report={analytics} />
              <div className="mt-6 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                <div className="space-y-5">
                  <TrendChart
                    title="Opportunities over time"
                    description="New opportunities created in your selected period."
                    points={analytics.timeseries.map((point) => ({
                      date: point.date,
                      value: point.opportunities,
                    }))}
                  />
                  <section className="min-w-0">
                    <div className="mb-3 flex items-center justify-end gap-2">
                      {currencies.length > 1 && (
                        <>
                          <label
                            htmlFor="revenue-currency"
                            className="text-xs text-muted-foreground"
                          >
                            Revenue currency
                          </label>
                          <select
                            id="revenue-currency"
                            value={currency}
                            onChange={(event) => setCurrency(event.target.value)}
                            className="form-input w-auto text-xs"
                          >
                            {currencies.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                    <TrendChart
                      title="Attributed revenue over time"
                      description={
                        currency
                          ? `Purchase revenue reported in ${currency}.`
                          : 'Purchase revenue appears after an attributed purchase.'
                      }
                      points={analytics.timeseries.map((point) => ({
                        date: point.date,
                        value:
                          point.revenue.find((amount) => amount.currency === currency)?.value ?? 0,
                      }))}
                      {...(currency ? { currency } : {})}
                    />
                  </section>
                </div>
                <ActivityFunnel
                  steps={analytics.funnel.map((step) => ({
                    label: stageLabels[step.stage] ?? step.stage.replaceAll('_', ' '),
                    value: step.count,
                  }))}
                />
              </div>
              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                <TopList
                  title="Communities that contribute"
                  rows={analytics.breakdowns.subreddits}
                  filters={filters}
                  filterKey="subredditId"
                />
                <TopList
                  title="Conversations worth following"
                  rows={analytics.breakdowns.opportunities}
                  filters={filters}
                  filterKey="opportunityId"
                />
              </div>
              <section
                className="panel mt-6 min-w-0 overflow-hidden"
                aria-labelledby="breakdown-title"
              >
                <div className="border-b border-border p-5 sm:p-6">
                  <h2 id="breakdown-title" className="text-base font-semibold">
                    Look closer at the results.
                  </h2>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    Compare recorded activity, then select a row to narrow your report.
                    {!advancedAnalytics && ' Competitor and draft-style breakdowns require Growth.'}
                  </p>
                  <div
                    className="mt-5 flex flex-wrap gap-2"
                    role="group"
                    aria-label="Analytics breakdown"
                  >
                    {dimensions.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        disabled={!advancedAnalytics && (key === 'competitors' || key === 'styles')}
                        aria-pressed={dimension === key}
                        onClick={() => setDimension(key)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45 ${dimension === key ? 'border-primary bg-primary text-white' : 'border-border bg-white text-muted-foreground hover:border-primary/50'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <BreakdownTable
                  rows={analytics.breakdowns[dimension]}
                  filters={filters}
                  filterKey={dimensions.find(([key]) => key === dimension)![2]}
                />
              </section>
              <p className="mt-5 text-[11px] leading-6 text-muted-foreground">
                Unique attributed clicks count distinct click receipts, not identified people. No
                raw IP addresses or browser fingerprints are used. Rates use distinct attributed
                clicks and return “—” when there is no denominator.
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}

export function MetricTiles({ report }: { report: AnalyticsReport }) {
  const metrics = report.metrics;
  const tiles = [
    ['Opportunities', formatCount(metrics.opportunities), 'Created in this period'],
    ['High-intent opportunities', formatCount(metrics.high_intent), 'High-scoring conversations'],
    ['Drafts generated', formatCount(metrics.drafts), 'Replies prepared for review'],
    [
      'Draft approval rate',
      formatPercent(metrics.drafts ? metrics.approval_rate : null),
      'Currently approved / drafts created',
    ],
    ['Published manually', formatCount(metrics.published), 'Recorded by a person'],
    ['Clicks', formatCount(metrics.clicks), 'Recorded tracked-link visits'],
    ['Unique attributed clicks', formatCount(metrics.unique_clicks), 'Distinct click receipts'],
    ['Signups', formatCount(metrics.signups), 'Attributed signup events'],
    ['Leads', formatCount(metrics.leads), 'Attributed lead events'],
    ['Purchases', formatCount(metrics.purchases), 'Attributed purchase events'],
    [
      'Click-to-signup rate',
      formatPercent(metrics.clicks ? metrics.click_to_signup_rate : null),
      'Distinct clicks with a signup',
    ],
    [
      'Signup-to-purchase rate',
      formatPercent(metrics.signups ? metrics.signup_to_purchase_rate : null),
      'Signup clicks with a purchase',
    ],
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map(([label, value, note]) => (
        <div
          key={label}
          className="panel px-5 py-4"
          data-testid={`metric-${label?.toLowerCase().replaceAll(' ', '-')}`}
        >
          <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
          <dd className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
          <dd className="mt-1.5 text-[10px] leading-5 text-muted-foreground">{note}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AnalyticsUnavailable() {
  return (
    <section className="panel p-7">
      <h2 className="text-xl font-semibold">Attribution is not enabled in this workspace yet.</h2>
      <p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
        This workspace needs its tracking database and verified runtime before it can record clicks
        and conversions. Your organization settings remain available.
      </p>
      <Button asChild variant="outline" className="mt-5">
        <Link href="/app/settings/integrations">
          Review integrations <ArrowRight size={15} />
        </Link>
      </Button>
    </section>
  );
}

function reportHref(filters: AnalyticsFilters, key: string, value: string) {
  const params = new URLSearchParams();
  for (const [name, current] of Object.entries(filters)) if (current) params.set(name, current);
  params.set(key, value);
  return `/app/analytics?${params}`;
}
type BreakdownRow = AnalyticsReport['breakdowns']['brands'][number];
function TopList({
  title,
  rows,
  filters,
  filterKey,
}: {
  title: string;
  rows: BreakdownRow[];
  filters: AnalyticsFilters;
  filterKey: string;
}) {
  const ranked = [...rows]
    .sort(
      (a, b) =>
        b.purchases - a.purchases || b.clicks - a.clicks || b.opportunities - a.opportunities,
    )
    .slice(0, 5);
  return (
    <section className="panel min-w-0 p-5 sm:p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Ranked by purchases, then clicks and opportunities.
      </p>
      {ranked.length ? (
        <ol className="mt-5 divide-y divide-border">
          {ranked.map((row, index) => (
            <li key={row.id}>
              <Link
                href={reportHref(filters, filterKey, row.id)}
                className="group flex items-center gap-3 py-4"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                  0{index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs font-semibold group-hover:text-primary">
                    {row.label}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {formatCount(row.clicks)} clicks · {formatCount(row.purchases)} purchases
                  </p>
                </div>
                <ArrowUpRight aria-hidden="true" size={15} className="shrink-0 text-primary" />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-5 rounded-xl bg-muted/40 p-5 text-xs leading-6 text-muted-foreground">
          No matching activity yet. Try a wider date range or create a tracking link for an approved
          draft.
        </p>
      )}
    </section>
  );
}
function BreakdownTable({
  rows,
  filters,
  filterKey,
}: {
  rows: BreakdownRow[];
  filters: AnalyticsFilters;
  filterKey: string;
}) {
  if (!rows.length)
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm font-medium">No matching activity</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Change the filters or choose another breakdown.
        </p>
      </div>
    );
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[650px] text-left text-xs">
        <caption className="sr-only">Recorded activity by selected breakdown</caption>
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {[
              'Source',
              'Opportunities',
              'Clicks',
              'Signups',
              'Purchases',
              'Attributed revenue',
            ].map((label) => (
              <th key={label} scope="col" className="px-5 py-3 font-semibold">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="max-w-xs px-5 py-4 font-medium">
                <Link
                  className="break-words text-primary hover:underline"
                  href={reportHref(filters, filterKey, row.id)}
                >
                  {row.label}
                </Link>
              </th>
              <td className="px-5 py-4 tabular-nums">{formatCount(row.opportunities)}</td>
              <td className="px-5 py-4 tabular-nums">{formatCount(row.clicks)}</td>
              <td className="px-5 py-4 tabular-nums">{formatCount(row.signups)}</td>
              <td className="px-5 py-4 tabular-nums">{formatCount(row.purchases)}</td>
              <td className="px-5 py-4 tabular-nums">
                <RevenueValues amounts={row.revenue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsFilterBar({
  filters,
  options,
  advancedAnalytics,
}: {
  filters: AnalyticsFilters;
  options: AnalyticsDashboardProps['options'];
  advancedAnalytics: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get('from') ?? ''),
      to = String(data.get('to') ?? '');
    const span = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      !Number.isFinite(span) ||
      span < 0 ||
      span >= 90
    ) {
      setError('Choose a start and end date within a 90-day range.');
      return;
    }
    setError('');
    const query = new URLSearchParams();
    for (const [key, value] of data.entries())
      if (typeof value === 'string' && value) query.set(key, value);
    startTransition(() => router.push(`/app/analytics?${query}`));
  }
  function select(name: string, label: string, items: Option[], disabled = false) {
    return (
      <label className="block min-w-0 text-[11px] font-medium text-muted-foreground">
        {label}
        <select
          name={name}
          disabled={disabled}
          defaultValue={filters[name as keyof AnalyticsFilters] ?? ''}
          className={`${inputClass} mt-2 w-full text-xs`}
        >
          <option value="">All {label.toLowerCase()}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <form onSubmit={submit} className="panel mb-6 p-4 sm:p-5" aria-label="Analytics filters">
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.2fr_auto]">
        <label className="block text-[11px] font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={13} aria-hidden="true" /> Start date (UTC)
          </span>
          <input
            name="from"
            type="date"
            required
            defaultValue={filters.from}
            className={`${inputClass} mt-2 w-full text-xs`}
          />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          End date (UTC)
          <input
            name="to"
            type="date"
            required
            defaultValue={filters.to}
            className={`${inputClass} mt-2 w-full text-xs`}
          />
        </label>
        {select('brandId', 'Brands', options.brands)}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            <Filter size={14} /> {pending ? 'Applying…' : 'Apply filters'}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="Reset analytics filters"
            onClick={() => startTransition(() => router.push('/app/analytics'))}
            disabled={pending}
          >
            <RotateCcw size={14} />
          </Button>
        </div>
      </div>
      <details className="mt-4 border-t border-border pt-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-primary">
          <SlidersHorizontal size={14} /> More filters <ChevronDown size={13} />
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {select('subredditId', 'Communities', options.subreddits)}
          {select('opportunityId', 'Opportunities', options.opportunities)}
          {select('competitorId', 'Competitors', options.competitors, !advancedAnalytics)}
          {select(
            'event',
            'Events',
            ['signup', 'lead', 'trial_started', 'purchase', 'custom'].map((id) => ({
              id,
              name: id.replaceAll('_', ' '),
            })),
          )}
          {select(
            'intent',
            'Intent categories',
            [
              'recommendation',
              'alternative',
              'comparison',
              'problem',
              'research',
              'support',
              'other',
            ].map((id) => ({ id, name: id })),
          )}
          {select(
            'style',
            'Draft style',
            [
              'Helpful and concise',
              'Technical',
              'Founder voice',
              'Product specialist',
              'Customer-support style',
              'Custom',
              'Unspecified',
            ].map((id) => ({ id, name: id })),
            !advancedAnalytics,
          )}
        </div>
      </details>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
