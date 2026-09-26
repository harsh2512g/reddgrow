'use client';

import { useEffect, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Circle, RefreshCw } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { setupSteps, type SetupSnapshot } from '@/lib/onboarding/model';

export function SetupChecklist({ state, canManage }: { state: SetupSnapshot; canManage: boolean }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const steps = setupSteps(state);
  const complete = steps.filter((step) => step.complete).length;
  const percent = Math.round((complete / steps.length) * 100);
  useEffect(() => {
    if (percent === 100 || !state.brandId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') startTransition(() => router.refresh());
    }, 5000);
    return () => clearInterval(timer);
  }, [percent, router, state.brandId]);
  return (
    <section className="space-y-6" aria-labelledby="setup-progress-title">
      <div className="panel bg-violet-50/50 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="setup-progress-title" className="text-xl font-semibold">
              Your launch checklist
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Saved progress for this brand. You can leave and return at any time.
            </p>
          </div>
          <span role="status" className="text-3xl font-semibold text-primary">
            {percent}%
          </span>
        </div>
        <progress
          aria-label="Workspace setup completion"
          max={100}
          value={percent}
          className="mt-5 h-2 w-full accent-primary"
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {complete} of {steps.length} steps complete · calculated from your workspace records
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw size={14} />
            {refreshing ? 'Checking progress…' : 'Refresh progress'}
          </Button>
        </div>
      </div>
      {!canManage && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          An owner or admin manages product setup. You can review progress and open your opportunity
          feed.
        </p>
      )}
      {!state.pipelineEnabled && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          Community processing is not enabled in this workspace. Completed brand and knowledge work
          is preserved; the remaining steps become available when processing is configured.
        </p>
      )}
      <ol className="grid gap-4 md:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.key} data-setup-step={step.key} className="panel flex flex-col p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full ${step.complete ? 'bg-emerald-50 text-positive' : 'bg-violet-50 text-primary'}`}
              >
                {step.complete ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <Circle size={18} aria-hidden="true" />
                )}
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Step {index + 1} · {step.complete ? 'Complete' : 'To do'}
                </p>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
              </div>
            </div>
            <p className="mb-5 mt-4 text-sm leading-7 text-muted-foreground">{step.description}</p>
            {step.enabled && (canManage || step.key === 'opportunities') ? (
              <Button
                asChild
                className="mt-auto w-fit"
                variant={step.complete ? 'outline' : 'default'}
              >
                <Link href={step.href}>
                  {step.action}
                  <ArrowRight size={14} />
                </Link>
              </Button>
            ) : (
              <p className="mt-auto text-xs text-muted-foreground">
                {!state.brandId
                  ? 'Create your brand to continue.'
                  : !step.enabled
                    ? 'Processing must be enabled first.'
                    : 'Your workspace manager completes this step.'}
              </p>
            )}
          </li>
        ))}
      </ol>
      {percent === 100 && (
        <p
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-7"
        >
          Your product context and first scored conversations are ready. Open the opportunity feed,
          review the evidence and create your first draft. You always publish manually.
        </p>
      )}
    </section>
  );
}
