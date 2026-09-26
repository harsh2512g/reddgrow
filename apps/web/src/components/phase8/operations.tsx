'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowUpRight, CirclePause, Layers, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { z } from 'zod';
import { knowledgeRequest, requestMessage } from '../phase2/api';
import { ResultNotice } from '../phase1/primitives';
import type { ActionResult } from '../phase1/types';
import {
  jobsPageSchema,
  organizationsPageSchema,
  retryResultSchema,
  statusResultSchema,
  operationReasonSchema,
  type JobSummary,
  type OrganizationDetail,
  type OperationsOverview,
} from '@/lib/phase8/contracts';
import type { providerStatesSchema } from '@/lib/phase8/provider-schema';

function date(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}
function label(value: string) {
  return value.replaceAll('_', ' ');
}
const reasons: Record<z.infer<typeof operationReasonSchema>, string> = {
  security_review: 'Security review',
  provider_failure: 'Provider failure',
  customer_request: 'Customer request',
  maintenance: 'Maintenance',
  recovered: 'Recovered',
};
export function OperationsSummary({ overview }: { overview: OperationsOverview }) {
  const counts = overview.metrics.jobs;
  const failed = counts
    .filter((row) => row.status === 'failed')
    .reduce((n, row) => n + row.count, 0);
  const waiting = counts
    .filter((row) => row.status === 'queued')
    .reduce((n, row) => n + row.count, 0);
  const working = counts
    .filter((row) => row.status === 'processing')
    .reduce((n, row) => n + row.count, 0);
  return (
    <>
      <section className="relative overflow-hidden rounded-[28px] bg-[#1d223b] p-7 text-white sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full border-[40px] border-white/5"
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-200">
          ThreadSignal operations
        </p>
        <h1 className="relative mt-4 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Keep the conversations moving.
        </h1>
        <p className="relative mt-4 max-w-xl text-sm leading-7 text-slate-200">
          Job health, workspace controls, and provider configuration. Customer documents and draft
          contents stay private.
        </p>
        <p className="mt-6 inline-flex items-center gap-2 text-xs text-violet-200">
          <ShieldCheck size={15} aria-hidden="true" /> Restricted platform access · Customer
          metadata reads and changes are audited
        </p>
      </section>
      <div className="my-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            title: 'Active workspaces',
            value: overview.organizations.active,
            icon: Layers,
            description: `${overview.organizations.total} total organizations`,
          },
          {
            title: 'Waiting jobs',
            value: waiting,
            icon: Activity,
            description: `${working} currently processing`,
          },
          {
            title: 'Failed jobs',
            value: failed,
            icon: RefreshCw,
            description: 'Inspect eligibility before retrying',
          },
          {
            title: 'Paused workspaces',
            value: overview.organizations.suspended,
            icon: CirclePause,
            description: 'New processing is suspended',
          },
        ].map(({ title, value, icon: Icon, description }) => (
          <section key={title} className="panel p-5">
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <h2>{title}</h2>
              <Icon size={17} aria-hidden="true" />
            </div>
            <p className="mt-4 text-3xl font-semibold tabular-nums tracking-tight">
              {value.toLocaleString('en')}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>
          </section>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Processing ledger</h2>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">
            Durable Supabase job records. These counts are not Redis queue depths.
          </p>
          <div className="mt-5 space-y-4">
            {['knowledge', 'reddit', 'draft', 'notification', 'privacy'].map((family) => {
              const rows = counts.filter((row) => row.family === family);
              const total = rows.reduce((n, row) => n + row.count, 0);
              return (
                <div key={family}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="capitalize">{family}</span>
                    <span className="font-semibold tabular-nums">{total.toLocaleString('en')}</span>
                  </div>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    {rows.length
                      ? rows.map((row) => `${row.count} ${row.status}`).join(' · ')
                      : 'No jobs recorded'}
                  </p>
                </div>
              );
            })}
          </div>
          <Link
            href="/internal/admin/jobs"
            className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            Inspect jobs <ArrowUpRight size={15} />
          </Link>
        </section>
        <section className="panel p-6">
          <h2 className="text-lg font-semibold">Quality & delivery</h2>
          <dl className="mt-5 space-y-4 text-sm">
            {[
              ['Knowledge sources ready', overview.metrics.knowledge_ready],
              ['Knowledge sources failed', overview.metrics.knowledge_failed],
              ['Draft checks passed', overview.metrics.draft_pass],
              ['Draft checks warning', overview.metrics.draft_warning],
              ['Draft checks blocked', overview.metrics.draft_blocked],
              ['Billing events applied', overview.metrics.billing_applied],
              ['Stale billing events ignored', overview.metrics.billing_stale],
            ].map(([name, value]) => (
              <div key={name} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="font-semibold tabular-nums">{Number(value).toLocaleString('en')}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs leading-6 text-muted-foreground">
            Reported AI usage: {overview.metrics.ai_input_tokens.toLocaleString('en')} input and{' '}
            {overview.metrics.ai_output_tokens.toLocaleString('en')} output tokens. Known estimated
            cost: ${overview.metrics.ai_estimated_cost_usd.toFixed(4)}. Mock usage carries no paid
            tokens.
            {overview.metrics.ai_unpriced_tasks > 0 &&
              ` ${overview.metrics.ai_unpriced_tasks} tasks have no price estimate; this is not the total bill.`}
            {overview.metrics.ai_unreported_usage_tasks > 0 &&
              ` ${overview.metrics.ai_unreported_usage_tasks} tasks have incomplete provider token receipts.`}
          </p>
        </section>
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Snapshot {date(overview.generated_at)} UTC. Reload to read current records.
      </p>
    </>
  );
}

export function OrganizationDirectory({
  initial,
}: {
  initial: z.infer<typeof organizationsPageSchema>;
}) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  async function load(after?: string) {
    setBusy(true);
    setResult(null);
    try {
      setData(
        await knowledgeRequest(
          `/api/internal/organizations${after ? `?after=${encodeURIComponent(after)}` : ''}`,
          organizationsPageSchema,
        ),
      );
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mt-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Workspaces</h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>
          Refresh list
        </Button>
      </div>
      <div className="my-4">
        <ResultNotice result={result} />
      </div>
      {data.items.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No organizations have been created yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.items.map((organization) => (
            <li key={organization.id}>
              <Link
                href={`/internal/admin/organizations/${organization.id}`}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg py-5 hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <h3 className="break-words font-semibold">{organization.name}</h3>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {organization.slug} · {organization.member_count} members ·{' '}
                    {organization.brand_count} brands
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="rounded-full border border-border px-3 py-1 capitalize">
                    {organization.plan ?? 'No plan'} · {organization.status}
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.next_cursor && (
        <Button variant="outline" disabled={busy} onClick={() => void load(data.next_cursor!)}>
          {busy ? 'Loading…' : 'Next workspaces'}
        </Button>
      )}
    </section>
  );
}

export function JobsConsole({ initial }: { initial: z.infer<typeof jobsPageSchema> }) {
  const [data, setData] = useState(initial);
  const [family, setFamily] = useState('');
  const [status, setStatus] = useState('failed');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [selected, setSelected] = useState<JobSummary | null>(null);
  const [reason, setReason] = useState<z.infer<typeof operationReasonSchema>>('recovered');
  const [requestId, setRequestId] = useState('');
  async function load(cursor?: z.infer<typeof jobsPageSchema>['next_cursor']) {
    setBusy(true);
    setResult(null);
    const query = new URLSearchParams();
    if (family) query.set('family', family);
    if (status) query.set('status', status);
    if (cursor) {
      query.set('before', cursor.created_at);
      query.set('beforeId', cursor.id);
    }
    try {
      setData(await knowledgeRequest(`/api/internal/jobs?${query}`, jobsPageSchema));
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!selected) return;
    setBusy(true);
    setResult(null);
    try {
      await knowledgeRequest(`/api/internal/jobs/${selected.id}/retry`, retryResultSchema, {
        method: 'POST',
        body: JSON.stringify({ family: selected.family, reason, requestId }),
      });
      setSelected(null);
      await load();
      setResult({
        status: 'success',
        message: 'The retry was recorded. The worker will recheck the job before processing.',
      });
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        className="panel mb-6 flex flex-wrap items-end gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label className="space-y-2 text-xs font-semibold">
          <span className="block">Pipeline</span>
          <select
            className="field-input"
            value={family}
            disabled={busy}
            onChange={(event) => setFamily(event.target.value)}
          >
            <option value="">All pipelines</option>
            {['knowledge', 'reddit', 'draft', 'notification', 'privacy'].map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2 text-xs font-semibold">
          <span className="block">Job status</span>
          <select
            className="field-input"
            value={status}
            disabled={busy}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {['failed', 'queued', 'processing', 'completed', 'sent', 'suppressed'].map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy} type="submit">
          {busy ? 'Loading…' : 'Apply filters'}
        </Button>
      </form>
      <ResultNotice result={result} />
      {selected && (
        <section
          className="my-5 rounded-2xl border border-amber-200 bg-amber-50 p-5"
          aria-labelledby="retry-title"
        >
          <h2 id="retry-title" className="font-semibold">
            Confirm a safe retry
          </h2>
          <p className="my-3 text-sm leading-6">
            Retry this failed {selected.family} job after addressing its cause. Current permissions,
            content, usage and delivery rules will be checked again.
          </p>
          <label className="text-sm font-medium" htmlFor="retry-reason">
            Reason
          </label>
          <select
            id="retry-reason"
            className="field-input my-3 max-w-sm"
            disabled={busy}
            value={reason}
            onChange={(event) => {
              setReason(operationReasonSchema.parse(event.target.value));
              setRequestId(crypto.randomUUID());
            }}
          >
            {Object.entries(reasons).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <div className="flex gap-3">
            <Button disabled={busy} onClick={() => void retry()}>
              Confirm retry
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setSelected(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      <section className="panel mt-5 p-5" aria-label="Job results">
        {data.items.length === 0 ? (
          <div className="py-12 text-center">
            <ShieldCheck className="mx-auto text-primary" size={30} aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">No matching jobs.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Change the filters to inspect other processing states.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.items.map((job) => (
              <li key={`${job.family}:${job.id}`} className="py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                      {job.family}
                    </p>
                    <h2 className="mt-2 font-semibold capitalize">{label(job.kind)}</h2>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {job.id}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${job.status === 'failed' ? 'border-red-200 bg-red-50 text-red-800' : 'border-border bg-muted'}`}
                  >
                    {job.status} · attempt {job.attempts}/3
                  </span>
                </div>
                <p className="mt-3 text-xs leading-6 text-muted-foreground">
                  Updated {date(job.updated_at)} UTC{' '}
                  {job.error_code ? `· ${label(job.error_code).toLowerCase()}` : ''}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {job.organization_id && (
                    <Link
                      className="text-xs font-semibold text-primary"
                      href={`/internal/admin/organizations/${job.organization_id}`}
                    >
                      View workspace metadata
                    </Link>
                  )}
                  {job.retry_available && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setSelected(job);
                        setRequestId(crypto.randomUUID());
                        setResult(null);
                      }}
                    >
                      Review retry
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data.next_cursor && (
          <Button variant="outline" disabled={busy} onClick={() => void load(data.next_cursor)}>
            Next jobs
          </Button>
        )}
      </section>
    </>
  );
}

export function OrganizationOperations({ data }: { data: OrganizationDetail }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [reason, setReason] = useState<z.infer<typeof operationReasonSchema>>('maintenance');
  const [requestId, setRequestId] = useState('');
  const paused = data.organization.status === 'suspended';
  async function apply() {
    setBusy(true);
    setResult(null);
    try {
      await knowledgeRequest(
        `/api/internal/organizations/${data.organization.id}/status`,
        statusResultSchema,
        { method: 'POST', body: JSON.stringify({ paused: !paused, reason, requestId }) },
      );
      setConfirming(false);
      setResult({
        status: 'success',
        message: paused ? 'Workspace processing resumed.' : 'Workspace processing paused.',
      });
      router.refresh();
    } catch (error) {
      setResult({ status: 'error', message: requestMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel p-6">
        <h2 className="text-lg font-semibold">Workspace metadata</h2>
        <dl className="mt-5 space-y-4 text-sm">
          {[
            ['Status', data.organization.status],
            ['Plan', data.organization.plan ?? 'No plan'],
            ['Members', data.organization.member_count],
            ['Brands', data.organization.brand_count],
            ['Timezone', data.timezone],
            ['Currency', data.currency],
          ].map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-7 font-semibold">Recorded usage</h3>
        {data.usage.length ? (
          <ul className="mt-3 space-y-3">
            {data.usage.map((row) => (
              <li className="text-xs leading-6" key={`${row.metric}:${row.period_start}`}>
                <span className="font-semibold capitalize">
                  {label(row.metric)}: {row.quantity}
                </span>
                <br />
                <span className="text-muted-foreground">
                  {date(row.period_start)} – {date(row.period_end)} UTC
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No metered usage recorded.</p>
        )}
      </section>
      <section className="panel p-6">
        <h2 className="text-lg font-semibold">Processing control</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Pausing prevents new customer activity and processing. Privacy cleanup continues. Resume
          after the reason for the pause is resolved.
        </p>
        <div className="my-5">
          <ResultNotice result={result} />
        </div>
        {data.organization.status === 'deleted' ? (
          <p className="text-sm">This organization has been deleted.</p>
        ) : confirming ? (
          <div className="space-y-4">
            <label className="block text-sm font-medium" htmlFor="status-reason">
              Reason for this change
            </label>
            <select
              id="status-reason"
              disabled={busy}
              className="field-input"
              value={reason}
              onChange={(event) => {
                setReason(operationReasonSchema.parse(event.target.value));
                setRequestId(crypto.randomUUID());
              }}
            >
              {Object.entries(reasons).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <p className="text-sm font-medium">
              {paused ? 'Resume' : 'Pause'} {data.organization.name}?
            </p>
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy} onClick={() => void apply()}>
                {busy ? 'Saving…' : 'Confirm change'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => {
              setConfirming(true);
              setRequestId(crypto.randomUUID());
            }}
          >
            {paused ? 'Resume workspace' : 'Pause workspace'}
          </Button>
        )}
      </section>
    </div>
  );
}

export function ProviderConfiguration({
  providers,
}: {
  providers: z.infer<typeof providerStatesSchema>;
}) {
  return (
    <>
      <p className="mb-6 max-w-2xl text-sm leading-7 text-muted-foreground">
        These are configured adapters, not external availability checks. No external account is
        contacted by this screen. Supabase provides authentication, PostgreSQL and private storage.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {providers.map((provider) => (
          <section key={provider.name} className="panel p-6">
            <p className="eyebrow">{provider.name}</p>
            <h2 className="mt-4 text-xl font-semibold capitalize">{provider.adapter}</h2>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              {provider.external_enabled
                ? 'External adapter configured; verify operational telemetry before activation.'
                : 'Local development adapter. External calls disabled.'}
            </p>
          </section>
        ))}
      </div>
    </>
  );
}
