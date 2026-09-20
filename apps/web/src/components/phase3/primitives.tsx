'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FlaskConical, Radio, RefreshCw } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { scoreLabel } from '@threadsignal/opportunities';
import type { Brand } from '@threadsignal/knowledge';
import { actionResponseSchema, signalMessage, signalRequest } from '@/lib/phase3/client';
import type { ActionResult } from '../phase1/types';
import { ResultNotice } from '../phase1/primitives';
import { LocalAccountHelp } from '../phase1/local-account-help';

export function LocalSignalsNotice({
  destination = '/app/opportunities',
}: {
  destination?: '/app/opportunities' | '/app/subreddits' | '/app/keywords';
}) {
  const label = {
    '/app/opportunities': 'Opportunities',
    '/app/subreddits': 'Communities',
    '/app/keywords': 'Keywords',
  }[destination];
  return (
    <section className="panel mx-auto max-w-3xl p-8 sm:p-12">
      <FlaskConical className="mb-5 text-primary" size={30} />
      <p className="eyebrow">Personal development</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Your conversation radar runs locally.
      </h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        Community monitoring, keywords, and scored opportunities are ready in the separate local
        workspace. Your hosted account and organization settings remain available here. Local
        accounts, brands, and discussions are separate from your hosted project.
      </p>
      <Button asChild className="mt-6">
        <a href={`http://127.0.0.1:3000${destination}`}>
          Continue to local {label} <ArrowRight size={16} />
        </a>
      </Button>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">
        Mock discussions are synthetic; no production Reddit ingestion is enabled.
      </p>
      <div className="mt-5">
        <LocalAccountHelp />
      </div>
    </section>
  );
}
export function SignalHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="relative isolate mb-7 overflow-hidden rounded-[26px] border border-violet-200 bg-[#f0edf9] p-6 sm:p-9">
      <div
        aria-hidden="true"
        className="absolute -right-16 -top-24 -z-10 size-96 rounded-full border-[40px] border-white/50 outline outline-[30px] outline-white/25"
      />
      <div className="max-w-2xl">
        <p className="eyebrow flex items-center gap-2">
          <Radio size={14} />
          {eyebrow}
        </p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-[2.6rem]">
          {title}
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/75 px-3 py-1.5 text-[10px] font-medium text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> Synthetic discussions · Production
        Reddit ingestion disabled
      </div>
    </section>
  );
}
export function BrandSelector({
  brands,
  brandId,
  path,
}: {
  brands: Brand[];
  brandId?: string | undefined;
  path: string;
}) {
  const router = useRouter();
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <label htmlFor="signal-brand" className="mb-2 block text-xs font-semibold">
          Product context
        </label>
        <select
          id="signal-brand"
          className="field-input min-w-52 max-w-full"
          value={brandId ?? ''}
          onChange={(event) => router.push(`${path}?brandId=${event.target.value}`)}
        >
          <option value="" disabled>
            Select a brand
          </option>
          {brands.map((brand) => (
            <option value={brand.id} key={brand.id}>
              {brand.name}
              {brand.status === 'archived' ? ' (archived)' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-4 text-xs font-semibold text-primary">
        <Link href={`/app/subreddits${brandId ? `?brandId=${brandId}` : ''}`}>Communities</Link>
        <Link href={`/app/keywords${brandId ? `?brandId=${brandId}` : ''}`}>Keywords</Link>
        <Link href={`/app/opportunities${brandId ? `?brandId=${brandId}` : ''}`}>
          Opportunities
        </Link>
      </div>
    </div>
  );
}
export function SignalRefresh({ automatic = false }: { automatic?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 8000);
    return () => clearInterval(timer);
  }, [automatic, router]);
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => router.refresh()}>
      <RefreshCw size={14} />
      Refresh view
    </Button>
  );
}
export function ScoreBadge({ score, blocked = false }: { score: number; blocked?: boolean }) {
  const label = blocked ? 'Blocked' : scoreLabel(score);
  return (
    <span
      className={`inline-flex min-w-16 flex-col items-center justify-center rounded-2xl border px-3 py-2 ${blocked ? 'border-red-200 bg-red-50 text-red-800' : score >= 80 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : score >= 60 ? 'border-violet-200 bg-violet-50 text-primary' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
    >
      <span className="font-mono text-2xl font-semibold leading-none">{Math.round(score)}</span>
      <span className="mt-1.5 text-[9px] font-semibold uppercase tracking-wider">{label}</span>
    </span>
  );
}
export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold capitalize ${risk === 'blocked' ? 'border-red-200 bg-red-50 text-red-800' : risk === 'high' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-border bg-muted/50 text-muted-foreground'}`}
    >
      {risk} risk
    </span>
  );
}
export function SignalAction({
  path,
  body,
  organizationId,
  children,
  method = 'POST',
  confirm,
  disabled = false,
}: {
  path: string;
  body?: unknown;
  organizationId: string;
  children: React.ReactNode;
  method?: 'POST' | 'PATCH' | 'DELETE';
  confirm?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  async function submit() {
    setPending(true);
    setResult(null);
    try {
      await signalRequest(path, actionResponseSchema, organizationId, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      setResult({ status: 'success', message: 'Change saved.' });
      setConfirming(false);
      router.refresh();
    } catch (error) {
      setResult({ status: 'error', message: signalMessage(error) });
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || pending}
        onClick={() => (confirm && !confirming ? setConfirming(true) : void submit())}
      >
        {pending ? 'Saving…' : children}
      </Button>
      {confirming && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
          <p className="mb-3 leading-5">{confirm}</p>
          <Button type="button" size="sm" disabled={pending} onClick={() => void submit()}>
            Confirm
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
      {result && (
        <div className="mt-2 max-w-sm">
          <ResultNotice result={result} />
        </div>
      )}
    </div>
  );
}
