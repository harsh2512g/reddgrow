import type { ReactNode } from 'react';
import { ArrowUpRight, Check, CircleDot, Radio, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ActionResult } from './types';

export const responsibleUseNotice =
  'ThreadSignal helps you discover public conversations and prepare replies. You are responsible for following community rules and disclosing your relationship with any product you recommend. ThreadSignal does not automatically publish comments and cannot guarantee that a community or moderator will accept a reply.';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
      <div className="max-w-2xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-3 text-[2rem] font-semibold leading-tight tracking-[-0.045em] sm:text-[2.5rem]">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ResultNotice({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role={result.status === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${result.status === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-positive'}`}
    >
      {result.message}
    </p>
  );
}

export function FormField({
  label,
  id,
  error,
  hint,
  children,
}: {
  label: string;
  id: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function SignalArt({ compact = false }: { compact?: boolean }) {
  return (
    <div aria-hidden="true" className={`signal-art ${compact ? 'signal-art-compact' : ''}`}>
      <div className="signal-orbit orbit-one" />
      <div className="signal-orbit orbit-two" />
      <div className="signal-orbit orbit-three" />
      <div className="signal-orbit orbit-four" />
      <span className="signal-point point-one" />
      <span className="signal-point point-two" />
      <span className="signal-point point-three" />
      <div className="signal-core">
        <Radio size={compact ? 34 : 45} strokeWidth={1.5} />
      </div>
      {!compact && (
        <>
          <span className="signal-tag signal-tag-top">
            <CircleDot size={14} /> A real conversation
          </span>
          <span className="signal-tag signal-tag-bottom">
            <Check size={14} /> A thoughtful response
          </span>
        </>
      )}
    </div>
  );
}

export function ResponsibleNote() {
  return (
    <aside className="rounded-2xl border border-border bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="text-primary" size={18} /> Human judgment, always.
      </div>
      <p className="mt-3 text-xs leading-6 text-muted-foreground">
        Follow community rules, disclose your affiliation, and personally publish every reply.
      </p>
      <Link
        className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary"
        href="/security"
      >
        Our commitments <ArrowUpRight size={14} />
      </Link>
    </aside>
  );
}

export function PermissionNotice({
  children = 'Your role has read-only access to these settings. Ask an organization owner or admin to make changes.',
}: {
  children?: ReactNode;
}) {
  return (
    <p
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-warning"
      role="status"
    >
      {children}
    </p>
  );
}
