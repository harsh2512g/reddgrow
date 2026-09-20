import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-layout';
import { PlanCards } from '@/components/phase1/billing-panel';
import { getPlanCards } from '@/components/phase1/plan-cards-data';

export const metadata: Metadata = { title: 'Plans for thoughtful growth' };

export default function PricingPage() {
  return (
    <>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="eyebrow">A plan for your pace</p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.12] tracking-[-0.045em] sm:text-5xl">
            Start small.
            <br />
            <span className="font-editorial font-normal italic text-primary">Stay thoughtful.</span>
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">
            Clear limits, a seven-day trial, and a workspace that grows with your team.
          </p>
        </div>
        <div className="mb-7 rounded-xl border border-violet-200 bg-violet-50 px-5 py-4 text-center text-xs leading-6 text-primary">
          Local demo: research, drafting, attribution and simulated plan upgrades are available.
          External providers remain disabled and no payment is collected.
        </div>
        <h2 className="sr-only">Compare plans and included limits</h2>
        <PlanCards plans={getPlanCards()} />
        <div className="my-10 text-center">
          <Button asChild>
            <Link href="/login">
              Start free trial <ArrowRight size={16} />
            </Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            No card required. No automatic Reddit posting.
          </p>
        </div>
        <div className="grid gap-8 border-t border-border pt-10 sm:grid-cols-2">
          <section>
            <h2 className="text-base font-semibold">What happens at a limit?</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              New usage above your plan allowance is blocked. Existing data stays in your workspace.
              You can free an allocation, such as a pending team invitation, or review your plan.
              Owners can test a mock upgrade in Plan & usage. No real card is charged.
            </p>
          </section>
          <section>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <ShieldCheck size={18} className="text-primary" /> Human control is included.
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Every plan follows the same commitments: disclose real affiliations, respect each
              community, review your replies, and personally publish on Reddit.
            </p>
          </section>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
