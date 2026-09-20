import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-layout';

export const metadata: Metadata = { title: 'Responsible use' };

const commitments = [
  [
    'You publish the final reply',
    'ThreadSignal never submits Reddit comments, votes, sends direct messages, or creates Reddit accounts. The final social action belongs to a real person.',
  ],
  [
    'Be transparent about your relationship',
    'Disclose your real affiliation with a recommended product. Fabricated experiences, testimonials, identities, and hidden account networks have no place here.',
  ],
  [
    'Respect each community',
    'Read the community rules and consider whether your reply adds value. ThreadSignal cannot guarantee that a moderator or community will accept a reply.',
  ],
  [
    'Use approved data access',
    'Production Reddit ingestion stays disabled until approved access is configured. There is no scraping fallback. Reddit content must never be used to train models.',
  ],
  [
    'Keep data limited and protected',
    'Reddit passwords are never requested or stored. Organization data is protected by membership checks and database row-level security. Customer knowledge storage is private by default.',
  ],
  [
    'Keep control of your organization',
    'Owners can request private exports and confirm organization deletion in settings. Access roles limit what teammates can view or change. Hosted retention and deletion operations require separate verification before live ingestion is enabled.',
  ],
];

export default function ResponsibleUse() {
  return (
    <>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        <div className="max-w-2xl">
          <span className="mb-6 flex size-14 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 text-primary">
            <ShieldCheck size={28} strokeWidth={1.5} />
          </span>
          <p className="eyebrow">Our commitments</p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.12] tracking-[-0.045em] sm:text-5xl">
            Useful by design.
            <br />
            <span className="font-editorial font-normal italic text-primary">
              Human, by principle.
            </span>
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">
            Better conversations need trust. These commitments guide how ThreadSignal works—and
            where the responsibility always stays with you.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {commitments.map(([title, description], index) => (
            <section key={title} className="panel p-6 sm:p-7">
              <p className="mb-6 font-mono text-xs text-primary">0{index + 1} /</p>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
            </section>
          ))}
        </div>
        <div className="mt-8 rounded-2xl border border-violet-200 bg-violet-50/60 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Check size={17} className="text-primary" /> Clear about what is live.
          </p>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            The local demo supports research with synthetic sources, verified drafting, manual
            extension handoff, attribution and mock billing. Reddit and AI remain mocked, email
            stays in console mode, and no real payment is collected. No external provider
            credentials are needed.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-5 border-t border-border pt-8">
          <p className="max-w-lg text-xs leading-6 text-muted-foreground">
            ThreadSignal is independent and is not affiliated with Reddit. Community rules and
            thoughtful human judgment guide every reply.
          </p>
          <Button asChild variant="outline">
            <Link href="/login">
              Create your workspace <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
