'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Feather, ArrowRight, FlaskConical, ShieldCheck } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import {
  draftRequest,
  draftMessage,
  DraftRequestError,
  mutationIdSchema,
} from '@/lib/phase4/client';
import { LocalAccountHelp } from '../phase1/local-account-help';

export function DraftBadge({ status }: { status: string }) {
  const colors = ['approved', 'verified', 'pass'].includes(status)
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : ['blocked', 'unsupported', 'contradicted', 'fail', 'error'].includes(status)
      ? 'border-red-200 bg-red-50 text-red-800'
      : ['warning', 'partial', 'editing', 'stale', 'inferred'].includes(status)
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-violet-200 bg-violet-50 text-primary';
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${colors}`}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}
export function DraftHeader({ title, description }: { title: string; description: string }) {
  return (
    <section className="relative mb-7 overflow-hidden rounded-[26px] border border-[#dad8e8] bg-[#f4f2ec] p-6 sm:p-9">
      <div
        aria-hidden
        className="absolute -right-10 -top-14 h-72 w-60 rotate-12 rounded-[24px] border border-[#d5d1e3] bg-white/40 shadow-[14px_14px_0_0_#e9e5f1]"
      />
      <div className="relative max-w-2xl">
        <p className="eyebrow flex items-center gap-2">
          <Feather size={15} /> The evidence studio
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-[2.6rem]">{title}</h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">{description}</p>
        <p className="mt-6 flex items-center gap-2 text-[11px] text-primary">
          <ShieldCheck size={14} /> Mock AI · Verified sources · Human judgment
        </p>
      </div>
    </section>
  );
}
export function LocalDraftsNotice({ persona = false }: { persona?: boolean }) {
  return (
    <section className="panel mx-auto max-w-3xl p-8 sm:p-12">
      <FlaskConical size={30} className="text-primary" />
      <p className="eyebrow mt-5">Personal development</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Your evidence studio runs locally.
      </h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        Draft generation, editing, and review are available in your separate local workspace. Hosted
        sign-in and data remain separate; this page does not send hosted records to the local
        worker.
      </p>
      <Button asChild className="mt-6">
        <a href={`http://127.0.0.1:3000/app/${persona ? 'settings/persona' : 'drafts'}`}>
          Continue to local {persona ? 'Persona settings' : 'Drafts'} <ArrowRight size={15} />
        </a>
      </Button>
      <div className="mt-5">
        <LocalAccountHelp />
      </div>
    </section>
  );
}
export function GenerateDraftButton({
  opportunityId,
  organizationId,
  disabled = false,
}: {
  opportunityId: string;
  organizationId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [length, setLength] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaReached, setQuotaReached] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Draft length"
          className="field-input !w-auto text-xs"
          value={length}
          disabled={disabled || pending}
          onChange={(event) => {
            setLength(event.target.value);
            setKey(crypto.randomUUID());
          }}
        >
          <option value="">Persona default length</option>
          <option value="concise">Concise</option>
          <option value="standard">Standard</option>
          <option value="detailed">Detailed</option>
        </select>
        <Button
          size="sm"
          disabled={disabled || pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            setQuotaReached(false);
            try {
              const result = await draftRequest(
                `/api/opportunities/${opportunityId}/drafts`,
                mutationIdSchema,
                organizationId,
                {
                  method: 'POST',
                  body: JSON.stringify({ idempotencyKey: key, options: length ? { length } : {} }),
                },
              );
              router.push(`/app/drafts/${result.id}`);
            } catch (issue) {
              setError(draftMessage(issue));
              setQuotaReached(issue instanceof DraftRequestError && issue.code === 'DRAFT_LIMIT');
            } finally {
              setPending(false);
            }
          }}
        >
          <Feather size={14} />
          {pending ? 'Preparing draft…' : 'Generate draft'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs leading-6 text-red-800">
          {error}
        </p>
      )}
      {quotaReached && <DraftUpgradeNotice />}
      <p className="text-[10px] leading-5 text-muted-foreground">
        Uses your brand’s{' '}
        <Link className="font-semibold text-primary" href="/app/settings/persona">
          truthful persona and disclosure
        </Link>
        . A person reviews every draft.
      </p>
    </div>
  );
}
export function DraftUpgradeNotice() {
  return (
    <aside className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-xs leading-6">
      <p className="font-semibold text-primary">Make room for your next draft.</p>
      <p className="mt-1 text-muted-foreground">
        Your workspace has used its draft allowance. The owner can choose a larger plan to continue;
        existing drafts remain available.
      </p>
      <Link
        className="mt-2 inline-flex items-center gap-2 font-semibold text-primary underline underline-offset-2"
        href="/app/settings/billing"
      >
        View plans and upgrade <ArrowRight size={13} />
      </Link>
    </aside>
  );
}
export function DraftLoading() {
  return (
    <div role="status" aria-label="Loading evidence studio" className="space-y-6">
      <div className="h-52 animate-pulse rounded-[26px] bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="h-96 animate-pulse rounded-2xl bg-muted" />
        <div className="h-96 animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}
