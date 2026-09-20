'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { trackingLinkInputSchema } from '@threadsignal/tracking';
import type { Brand } from '@threadsignal/knowledge';
import { draftMessage, draftRequest } from '@/lib/phase4/client';
import { PageHeading, PermissionNotice, ResultNotice } from '../phase1/primitives';
import type { ActionResult, Role } from '../phase1/types';
import { AnalyticsUnavailable } from './analytics-dashboard';
import { formatDate } from './format';
import { trackingLinkRecordSchema, type TrackingLinkRecord } from './tracking-schema';

export type TrackingStudioProps = {
  enabled: boolean;
  organization: { id: string; role: Role };
  canAct: boolean;
  brands: Brand[];
  brand: Brand | null;
  apiOrigin: string;
  links: TrackingLinkRecord[];
  initialDraftId?: string | undefined;
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  drafts: Array<{ id: string; current_version: number; title: string; brand_id: string }>;
  features: { clickTracking: boolean; conversionTracking: boolean; conversionApi: boolean };
};
export function TrackingStudio({
  enabled,
  organization,
  canAct,
  brands,
  brand,
  apiOrigin,
  links: initialLinks,
  initialDraftId,
  pagination,
  drafts,
  features,
}: TrackingStudioProps) {
  const router = useRouter();
  const [links, setLinks] = useState(initialLinks);
  const [showRevoked, setShowRevoked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [created, setCreated] = useState<TrackingLinkRecord | null>(null);
  const operation = useRef(false);
  const selectedDraft = initialDraftId
    ? drafts.find((draft) => draft.id === initialDraftId)
    : drafts[0];
  const mayCreate =
    enabled && canAct && features.clickTracking && brand?.status === 'active' && drafts.length > 0;
  async function run(key: string, action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true;
    setBusy(key);
    setResult(null);
    try {
      await action();
    } catch (error) {
      setResult({ status: 'error', message: draftMessage(error) });
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mayCreate) return;
    const form = new FormData(event.currentTarget);
    const selected = drafts.find((draft) => draft.id === form.get('draftId'));
    if (!selected) {
      setResult({
        status: 'error',
        message: 'Select a current approved draft before creating a link.',
      });
      return;
    }
    const content = String(form.get('utmContent') ?? '').trim();
    const parsed = trackingLinkInputSchema.safeParse({
      draftId: selected.id,
      expectedVersion: selected.current_version,
      destinationUrl: String(form.get('destinationUrl') ?? '').trim(),
      utm: {
        source: form.get('utmSource'),
        medium: form.get('utmMedium'),
        campaign: form.get('utmCampaign'),
        ...(content ? { content } : {}),
      },
      overwriteUtm: form.get('overwriteUtm') === 'on',
    });
    if (!parsed.success) {
      setResult({
        status: 'error',
        message:
          'Check the destination and campaign fields. Tracking labels must be between 1 and 120 characters.',
      });
      return;
    }
    await run('create', async () => {
      const data = await draftRequest(
        '/api/tracking-links',
        z.object({ link: trackingLinkRecordSchema }),
        organization.id,
        { method: 'POST', body: JSON.stringify(parsed.data) },
      );
      setLinks((previous) => [data.link, ...previous.filter((link) => link.id !== data.link.id)]);
      setCreated(data.link);
      setResult({
        status: 'success',
        message: 'Tracking link created. Review the community’s link rules before sharing it.',
      });
    });
  }
  async function copy(link: TrackingLinkRecord) {
    if (link.status !== 'active') return;
    await run(`copy:${link.id}`, async () => {
      try {
        await navigator.clipboard.writeText(`${apiOrigin}/go/${link.code}`);
      } catch {
        throw new Error(
          'Clipboard access was unavailable. Select the displayed tracking URL and copy it manually.',
        );
      }
      setResult({
        status: 'success',
        message: 'Tracking link copied. Nothing has been published.',
      });
    });
  }
  async function revoke(link: TrackingLinkRecord) {
    if (
      !canAct ||
      !window.confirm(
        'Revoke this tracking link? Future visits will no longer redirect. Existing analytics will remain.',
      )
    )
      return;
    await run(`revoke:${link.id}`, async () => {
      await draftRequest(
        `/api/tracking-links/${link.id}/revoke`,
        z.object({ revoked: z.literal(true) }),
        organization.id,
        { method: 'POST', body: '{}' },
      );
      setLinks((previous) =>
        previous.map((row) =>
          row.id === link.id
            ? { ...row, status: 'revoked', revoked_at: new Date().toISOString() }
            : row,
        ),
      );
      if (created?.id === link.id) setCreated(null);
      setResult({
        status: 'success',
        message: 'Tracking link revoked. Existing analytics are retained.',
      });
    });
  }
  const visible = links.filter((link) => showRevoked || link.status === 'active');
  return (
    <>
      <PageHeading
        eyebrow="Thoughtful follow-through"
        title="Give each conversation a destination."
        description="Create a measured path from an approved reply to your product. Track visits and optional customer actions while keeping publication in human hands."
        action={
          <Button asChild variant="outline">
            <Link href="/app/analytics">
              View analytics <ArrowUpRight size={16} />
            </Link>
          </Button>
        }
      />
      {!enabled ? (
        <AnalyticsUnavailable />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
              Brand
              <select
                aria-label="Tracking brand"
                className="form-input min-w-0 max-w-full sm:min-w-56"
                value={brand?.id ?? ''}
                onChange={(event) =>
                  router.push(`/app/tracking?brandId=${encodeURIComponent(event.target.value)}`)
                }
              >
                {!brands.length && <option value="">No brands yet</option>}
                {brands.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              {links.filter((link) => link.status === 'active').length} active links on this page
            </p>
          </div>
          {!canAct && (
            <PermissionNotice>
              Your viewer role can inspect links and analytics. A workspace member, admin or owner
              can create and revoke tracking links.
            </PermissionNotice>
          )}
          {brand?.status === 'archived' && (
            <PermissionNotice>
              Restore this archived brand before creating tracking links. Existing link records
              remain available for review.
            </PermissionNotice>
          )}
          {!features.clickTracking && (
            <PermissionNotice>
              Tracking links are unavailable on the workspace’s current plan. Review the plan before
              creating a link.
            </PermissionNotice>
          )}
          {result && (
            <div className="mb-5">
              <ResultNotice result={result} />
            </div>
          )}
          <div className="grid items-start gap-6 xl:grid-cols-[1.1fr_1fr]">
            <section
              className="overflow-hidden rounded-[24px] border border-violet-200 bg-white"
              aria-labelledby="new-link-title"
            >
              <div className="relative overflow-hidden border-b border-violet-100 bg-[#f2effa] p-6">
                <div
                  aria-hidden="true"
                  className="absolute -right-8 -top-8 size-40 rounded-full border-[20px] border-white/55"
                />
                <div className="relative">
                  <span className="inline-flex rounded-xl bg-white p-3 text-primary">
                    <Link2 size={23} />
                  </span>
                  <h2 id="new-link-title" className="mt-4 text-xl font-semibold tracking-tight">
                    One reply. A clear next step.
                  </h2>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    Links stay connected to the approved draft and its opportunity.
                  </p>
                </div>
              </div>
              {!brand ? (
                <div className="p-6">
                  <p className="text-sm font-medium">Create your brand first.</p>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    Your approved website establishes where links may redirect.
                  </p>
                  <Button asChild className="mt-4" variant="outline">
                    <Link href="/app/brands/new">
                      Create a brand <ArrowRight size={15} />
                    </Link>
                  </Button>
                </div>
              ) : !drafts.length ? (
                <div className="p-6">
                  <p className="text-sm font-medium">An approved reply comes first.</p>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    Generate a useful draft, verify its claims, and approve the latest version. It
                    will then appear here.
                  </p>
                  <Button asChild variant="outline" className="mt-4">
                    <Link href={`/app/drafts?brandId=${brand.id}`}>
                      Review drafts <ArrowRight size={15} />
                    </Link>
                  </Button>
                </div>
              ) : (
                <form onSubmit={(event) => void create(event)} className="space-y-5 p-6">
                  {initialDraftId && !selectedDraft && (
                    <p
                      role="status"
                      className="rounded-xl bg-amber-50 p-3 text-xs leading-6 text-warning"
                    >
                      The requested draft is not available in this approved list. Review its current
                      version or choose another draft explicitly.
                    </p>
                  )}
                  <fieldset
                    disabled={!mayCreate || Boolean(busy)}
                    className="space-y-5 disabled:opacity-70"
                  >
                    <label className="block text-xs font-semibold">
                      Approved draft
                      <select
                        name="draftId"
                        required
                        defaultValue={selectedDraft?.id ?? ''}
                        className="form-input mt-2 w-full min-w-0 text-xs"
                      >
                        {!selectedDraft && (
                          <option value="">Choose a current approved draft</option>
                        )}
                        {drafts.map((draft) => (
                          <option value={draft.id} key={draft.id}>
                            V{draft.current_version} · {draft.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-semibold">
                      Destination URL
                      <input
                        name="destinationUrl"
                        type="url"
                        required
                        maxLength={2048}
                        defaultValue={brand.website_url}
                        className="form-input mt-2 w-full text-xs"
                      />
                      <span className="mt-2 block text-[11px] font-normal leading-5 text-muted-foreground">
                        Use an HTTPS destination on your brand’s approved domain:{' '}
                        {new URL(brand.website_url).hostname}.
                      </span>
                    </label>
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold text-primary">
                        Campaign labels and existing UTM values
                      </summary>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        {[
                          ['utmSource', 'UTM source', 'reddit'],
                          ['utmMedium', 'UTM medium', 'community'],
                          ['utmCampaign', 'UTM campaign', 'threadsignal'],
                          ['utmContent', 'UTM content', ''],
                        ].map(([name, label, value]) => (
                          <label key={name} className="block text-xs font-medium">
                            {label}
                            <input
                              name={name}
                              maxLength={120}
                              required={name !== 'utmContent'}
                              defaultValue={value}
                              placeholder={
                                name === 'utmContent' ? 'Defaults to opportunity ID' : ''
                              }
                              className="form-input mt-2 w-full text-xs"
                            />
                          </label>
                        ))}
                      </div>
                      <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <input
                          type="checkbox"
                          name="overwriteUtm"
                          className="mt-1 accent-primary"
                        />
                        Replace UTM values already present on the destination URL. By default,
                        existing values are preserved.
                      </label>
                    </details>
                    <Button type="submit" className="w-full">
                      <Plus size={15} />{' '}
                      {busy === 'create' ? 'Creating link…' : 'Create tracking link'}
                    </Button>
                  </fieldset>
                </form>
              )}
            </section>
            <div className="space-y-5">
              {created && (
                <section
                  className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5"
                  aria-labelledby="created-link-title"
                >
                  <h2
                    id="created-link-title"
                    className="flex items-center gap-2 text-sm font-semibold text-positive"
                  >
                    <Check size={17} /> Your tracking link is ready
                  </h2>
                  <label className="mt-4 block text-xs font-medium">
                    New tracking URL
                    <input
                      readOnly
                      value={`${apiOrigin}/go/${created.code}`}
                      className="form-input mt-2 w-full text-xs"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    disabled={Boolean(busy)}
                    onClick={() => void copy(created)}
                  >
                    <Copy size={14} /> Copy new link
                  </Button>
                </section>
              )}
              <section className="panel p-6">
                <span className="inline-flex rounded-xl bg-violet-50 p-2.5 text-primary">
                  <ShieldCheck size={20} />
                </span>
                <h2 className="mt-4 text-sm font-semibold">Measurement with clear boundaries.</h2>
                <ul className="mt-3 space-y-3 text-xs leading-6 text-muted-foreground">
                  <li>
                    Destinations are checked against your brand’s allowed domain before every
                    redirect.
                  </li>
                  <li>
                    Clicks contain no raw IP address or browser fingerprint. Unique click receipts
                    do not identify people.
                  </li>
                  <li>
                    Browser conversion events require consent. Server conversion keys stay on your
                    server.
                  </li>
                </ul>
                <Link
                  href="/app/settings/integrations#conversion-settings"
                  className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary"
                >
                  Set up conversions <ArrowUpRight size={14} />
                </Link>
              </section>
            </div>
          </div>
          <section
            className="panel mt-7 min-w-0 overflow-hidden"
            aria-labelledby="tracking-links-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
              <div>
                <h2 id="tracking-links-title" className="font-semibold">
                  Your tracking links
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Revoking a link preserves its recorded results.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showRevoked}
                  onChange={(event) => setShowRevoked(event.target.checked)}
                  className="accent-primary"
                />
                Show revoked links
              </label>
            </div>
            {pagination && pagination.totalPages > 1 && brand && (
              <nav
                aria-label="Tracking link pages"
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 text-xs sm:px-6"
              >
                <p className="text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} links
                </p>
                <div className="flex items-center gap-3">
                  {pagination.page > 1 && (
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={`/app/tracking?brandId=${brand.id}&page=${pagination.page - 1}`}
                    >
                      Previous links
                    </Link>
                  )}
                  {pagination.page < pagination.totalPages && (
                    <Link
                      className="font-semibold text-primary hover:underline"
                      href={`/app/tracking?brandId=${brand.id}&page=${pagination.page + 1}`}
                    >
                      Next links
                    </Link>
                  )}
                </div>
              </nav>
            )}
            {visible.length ? (
              <div className="divide-y divide-border">
                {visible.map((link) => (
                  <article key={link.id} className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${link.status === 'active' ? 'bg-emerald-50 text-positive' : 'bg-muted text-muted-foreground'}`}
                      >
                        {link.status === 'active' ? 'Active' : 'Revoked'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Created {formatDate(link.created_at)}
                      </span>
                    </div>
                    <p className="mt-3 break-all font-mono text-xs">{`${apiOrigin}/go/${link.code}`}</p>
                    <p className="mt-2 flex items-start gap-2 break-all text-xs leading-6 text-muted-foreground">
                      <ArrowRight size={13} className="mt-1 shrink-0" aria-hidden="true" />
                      {link.destination_url}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={link.status !== 'active' || Boolean(busy)}
                        onClick={() => void copy(link)}
                        aria-label={`Copy tracking link ${link.code}`}
                      >
                        <Copy size={13} /> Copy link
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/app/drafts/${link.draft_id}`}>
                          <ExternalLink size={13} /> Review draft
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/app/analytics?brandId=${link.brand_id}`}>
                          View results <ArrowUpRight size={13} />
                        </Link>
                      </Button>
                      {canAct && link.status === 'active' && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() => void revoke(link)}
                          aria-label={`Revoke tracking link ${link.code}`}
                        >
                          <Unlink size={13} /> Revoke
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <Link2 size={27} className="mx-auto text-primary/50" aria-hidden="true" />
                <h3 className="mt-4 text-sm font-semibold">
                  No {showRevoked ? '' : 'active '}tracking links yet.
                </h3>
                <p className="mx-auto mt-2 max-w-md text-xs leading-6 text-muted-foreground">
                  Create a link from a current approved draft. Visits and consented customer actions
                  will appear in your analytics.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
