import Link from 'next/link';
import { ArrowRight, BookOpen, Check, FileText, FlaskConical, Globe2, Layers3 } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import type { KnowledgeSource } from '@threadsignal/knowledge';
import type { ReactNode } from 'react';
import { LocalAccountHelp } from '../phase1/local-account-help';

export function LocalKnowledgeNotice({
  destination = '/app/brands',
}: {
  destination?: '/app/brands' | '/app/brands/new' | '/app/knowledge' | '/app/knowledge/search';
}) {
  const label = destination.startsWith('/app/knowledge') ? 'Knowledge' : 'Brands';
  return (
    <section
      className="panel mx-auto max-w-3xl overflow-hidden p-7 sm:p-10"
      aria-labelledby="local-knowledge-title"
    >
      <span className="mb-6 inline-flex size-12 items-center justify-center rounded-2xl bg-violet-100 text-primary">
        <FlaskConical size={24} />
      </span>
      <p className="eyebrow">Personal development</p>
      <h1 id="local-knowledge-title" className="mt-3 text-3xl font-semibold tracking-tight">
        Knowledge processing is not enabled here yet.
      </h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        You are viewing the app connected to your hosted Supabase project. Brand and knowledge
        processing currently run in the separate local workspace. Your hosted account and
        organization settings remain available here.
      </p>
      <Button asChild className="mt-6">
        <a href={`http://127.0.0.1:3000${destination}`}>
          Continue to local {label} <ArrowRight size={16} />
        </a>
      </Button>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">
        Local brands and files stay separate from this hosted project. After signing in locally, you
        can move between local tabs without signing in again while your session is active.
      </p>
      <div className="mt-5">
        <LocalAccountHelp />
      </div>
    </section>
  );
}

export function KnowledgeIntro({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate mb-7 overflow-hidden rounded-[24px] border border-violet-200 bg-[#efedf9] p-6 sm:p-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-14 -z-10 size-64 rounded-full border-[35px] border-white/35 outline outline-[30px] outline-white/20"
      />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-xl">
          <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Layers3 size={14} /> Built on what you know
          </p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
          {children}
        </div>
        <div
          aria-hidden="true"
          className="hidden rotate-6 rounded-2xl border border-violet-200 bg-white/85 p-5 shadow-sm md:block"
        >
          <BookOpen size={35} strokeWidth={1.3} className="text-primary" />
          <div className="mt-4 h-1.5 w-20 rounded-full bg-violet-100" />
          <div className="mt-2 h-1.5 w-12 rounded-full bg-violet-100" />
        </div>
      </div>
    </section>
  );
}

export function SourceStatus({ status }: { status: KnowledgeSource['status'] }) {
  const label = {
    pending: 'Queued',
    processing: 'Processing',
    ready: 'Ready',
    partial: 'Partially ready',
    failed: 'Failed',
    deleting: 'Deleting',
  }[status];
  const tone =
    status === 'ready'
      ? 'border-emerald-200 bg-emerald-50 text-positive'
      : ['failed', 'partial'].includes(status)
        ? 'border-amber-200 bg-amber-50 text-warning'
        : 'border-violet-200 bg-violet-50 text-primary';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${tone}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function SourceIcon({ type }: { type: KnowledgeSource['type'] }) {
  const Icon =
    type === 'website' || type === 'webpage' ? Globe2 : type === 'manual' ? BookOpen : FileText;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-primary">
      <Icon aria-hidden="true" size={20} strokeWidth={1.5} />
    </span>
  );
}

export function KnowledgeEmpty({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <section className="panel py-12 text-center sm:px-10">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-violet-50 text-primary">
        <BookOpen size={24} strokeWidth={1.5} />
      </span>
      <h2 className="mt-5 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-3 max-w-md px-4 text-sm leading-7 text-muted-foreground">
        {description}
      </p>
      {href && action && (
        <Button asChild className="mt-6">
          <Link href={href}>
            {action}
            <ArrowRight size={16} />
          </Link>
        </Button>
      )}
    </section>
  );
}

export function KnowledgeChecklist({ items }: { items: { label: string; complete: boolean }[] }) {
  const percent = Math.round((items.filter((item) => item.complete).length / items.length) * 100);
  return (
    <aside className="panel p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your product context</h2>
        <span className="font-mono text-xs text-primary">{percent}%</span>
      </div>
      <progress
        aria-label="Brand profile completion"
        value={percent}
        max={100}
        className="mt-4 h-1.5 w-full accent-primary"
      />
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2.5 text-xs">
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${item.complete ? 'border-emerald-200 bg-emerald-50 text-positive' : 'border-border text-muted-foreground'}`}
            >
              {item.complete ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <span className="size-1 rounded-full bg-current" />
              )}
            </span>
            {item.label}
            <span className="sr-only">{item.complete ? 'Complete' : 'Incomplete'}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function displayDate(value: string | null): string {
  if (!value) return 'Not yet processed';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }) + ' UTC';
}
