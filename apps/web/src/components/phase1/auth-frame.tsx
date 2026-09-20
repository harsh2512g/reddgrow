import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { Wordmark } from '../wordmark';
import { SignalArt } from './primitives';

export function AuthFrame({
  children,
  title = 'Welcome to your next good conversation.',
  description = 'Sign in to create your workspace or pick up where you left off.',
}: {
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  return (
    <div className="min-h-dvh bg-white lg:grid lg:grid-cols-2">
      <div className="flex min-h-dvh flex-col px-6 py-7 sm:px-12 lg:px-16 xl:px-24">
        <Wordmark />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-16"
        >
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-primary"
          >
            <ArrowLeft size={14} /> Back to ThreadSignal
          </Link>
          <p className="eyebrow">A space for thoughtful growth</p>
          <h1 className="mb-4 mt-4 text-[2.5rem] font-semibold leading-[1.12] tracking-[-0.045em]">
            {title}
          </h1>
          <p className="mb-8 text-sm leading-7 text-muted-foreground">{description}</p>
          {children}
        </main>
        <p className="text-xs leading-6 text-muted-foreground">
          By continuing, you agree to our{' '}
          <Link className="underline underline-offset-4" href="/terms">
            terms
          </Link>{' '}
          and{' '}
          <Link className="underline underline-offset-4" href="/privacy">
            privacy notice
          </Link>
          .
        </p>
      </div>
      <aside className="auth-story relative hidden min-h-dvh overflow-hidden border-l border-violet-100 bg-[#eeedf8] lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="relative z-10 flex items-center gap-2 text-xs font-medium text-primary">
          <span className="size-1.5 rounded-full bg-primary" /> More relevance. Less noise.
        </div>
        <div className="relative z-10 -mx-8">
          <SignalArt />
          <div className="mx-auto -mt-7 max-w-md">
            <h2 className="text-4xl font-semibold leading-[1.13] tracking-[-0.04em]">
              Be there when
              <br />
              <span className="font-editorial font-normal italic text-primary">
                you can be useful.
              </span>
            </h2>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">
              Great growth begins with a real need, an honest answer, and someone who cares enough
              to listen.
            </p>
            <div className="mt-7 space-y-3">
              {[
                'A workspace that belongs to your team',
                'Clear roles and organization boundaries',
                'A human behind every final reply',
              ].map((item) => (
                <p key={item} className="flex items-center gap-2.5 text-xs">
                  <Check size={15} className="text-primary" />
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck size={16} /> Independent. Transparent. Human by design.
        </div>
      </aside>
    </div>
  );
}
