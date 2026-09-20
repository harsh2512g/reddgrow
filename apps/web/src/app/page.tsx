import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCheck2,
  Fingerprint,
  Headphones,
  MessageCircle,
  Radio,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-layout';
import { PlanCards } from '@/components/phase1/billing-panel';
import { getPlanCards } from '@/components/phase1/plan-cards-data';
import { SignalArt } from '@/components/phase1/primitives';

const steps = [
  {
    number: '01',
    icon: Search,
    title: 'Find a real need.',
    text: 'The right conversation starts with someone looking for an answer. Relevance comes before reach.',
  },
  {
    number: '02',
    icon: FileCheck2,
    title: 'Bring something useful.',
    text: 'Ground your response in product knowledge. Make room for context, sources, and honest limitations.',
  },
  {
    number: '03',
    icon: Fingerprint,
    title: 'Make it your own.',
    text: 'Review the words. Disclose your relationship. You decide whether to reply and personally publish.',
  },
];

export default function Home() {
  return (
    <>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1}>
        <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-16 lg:px-10 lg:pb-24">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
              <span className="size-1.5 rounded-full bg-primary" /> Thoughtful growth starts with
              listening
            </p>
            <h1 className="max-w-2xl text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.055em] sm:text-[3.75rem] lg:text-[4rem] xl:text-[4.45rem]">
              Find Reddit conversations that are ready to become{' '}
              <span className="font-editorial font-normal italic text-primary">customers.</span>
            </h1>
            <p className="mt-7 max-w-lg text-base leading-8 text-muted-foreground">
              Monitor high-intent discussions, prepare evidence-backed replies from your product
              documentation, and track clicks and attributed revenue. You always review and publish
              manually.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild className="px-5">
                <Link href="/login">
                  Start free trial <ArrowRight size={17} />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="#demo">
                  View demo <ArrowUpRight size={16} />
                </a>
              </Button>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} className="text-primary" /> No card required
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={13} className="text-primary" /> Human by design
              </span>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[480px] lg:pt-5">
            <div className="hero-art relative overflow-hidden px-4 pb-8 pt-7 sm:px-7">
              <div className="mx-auto w-full">
                <SignalArt />
              </div>
              <div className="relative z-10 -mt-9 rounded-2xl border border-primary/15 bg-white px-5 py-5 shadow-[0_10px_35px_-25px_#5144ca90]">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-xs font-semibold">
                    <Radio size={15} className="text-primary" /> The ThreadSignal philosophy
                  </p>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    01—03
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-border pt-4 text-[10px] text-muted-foreground">
                  <p>
                    <span className="mb-1.5 block text-sm font-semibold text-foreground">
                      Listen.
                    </span>
                    Find the need
                  </p>
                  <p>
                    <span className="mb-1.5 block text-sm font-semibold text-foreground">
                      Understand.
                    </span>
                    Bring evidence
                  </p>
                  <p>
                    <span className="mb-1.5 block text-sm font-semibold text-foreground">
                      Contribute.
                    </span>
                    Stay human
                  </p>
                </div>
              </div>
            </div>
            <p className="mt-4 text-center text-[10px] tracking-wide text-muted-foreground">
              A considered approach. Never a comment machine.
            </p>
          </div>
        </section>
        <section className="border-y border-border bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
            <p className="flex items-center gap-2 text-xs font-medium">
              <span className="size-1.5 rounded-full bg-primary" /> Built in the open, one
              thoughtful step at a time.
            </p>
            <p className="max-w-xl text-[11px] leading-6 text-muted-foreground">
              Local demo · Research, drafting and attribution available · External providers remain
              disabled
            </p>
          </div>
        </section>
        <section id="approach" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="eyebrow">The approach</p>
              <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
                Be helpful.
                <br />
                <span className="font-editorial font-normal italic text-primary">
                  Right where it matters.
                </span>
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-7 text-muted-foreground">
              Our product direction is simple: connect a real need with a useful, transparent
              response.
            </p>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map(({ number, icon: Icon, title, text }) => (
              <article key={number} className="panel p-7">
                <div className="mb-9 flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-primary">
                    <Icon size={21} strokeWidth={1.5} />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">/{number}</span>
                </div>
                <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="border-y border-border bg-white">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 md:grid-cols-2 md:items-center lg:gap-24 lg:px-10">
            <div className="relative rounded-3xl border border-violet-100 bg-[#f3f1fa] p-7 sm:p-9">
              <p className="eyebrow">Built into the philosophy</p>
              <div className="mt-7 space-y-4">
                {[
                  {
                    icon: Headphones,
                    title: 'Understand before you answer',
                    text: 'Read the question. Consider the community.',
                  },
                  {
                    icon: FileCheck2,
                    title: 'Put evidence behind your words',
                    text: 'Real sources. Clear limitations. No invented claims.',
                  },
                  {
                    icon: MessageCircle,
                    title: 'Keep your voice in the conversation',
                    text: 'An honest disclosure. A human decision.',
                  },
                ].map(({ icon: Icon, title, text }) => (
                  <div
                    key={title}
                    className="flex items-start gap-3 rounded-xl border border-border bg-white p-4"
                  >
                    <Icon size={18} className="mt-0.5 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-semibold">{title}</p>
                      <p className="mt-1.5 text-[11px] leading-6 text-muted-foreground">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-6 flex items-center gap-2 text-xs font-medium text-positive">
                <ShieldCheck size={16} /> Final submission always belongs to you.
              </p>
            </div>
            <div>
              <p className="eyebrow">Trust isn’t an extra feature</p>
              <h2 className="mt-4 text-3xl font-semibold leading-[1.15] tracking-[-0.04em] sm:text-4xl">
                Your expertise.
                <br />
                Your perspective.
                <br />
                <span className="font-editorial font-normal italic text-primary">
                  Your decision.
                </span>
              </h2>
              <p className="mt-6 text-sm leading-8 text-muted-foreground">
                A useful contribution should sound like someone who understands the problem.
                ThreadSignal is designed to help you prepare—with product evidence, context, and a
                clear affiliation.
              </p>
              <p className="mt-4 text-sm leading-8 text-muted-foreground">
                It never takes the final social action for you. No automatic posting, voting, or
                hidden account networks.
              </p>
              <Link
                href="/security"
                className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                Read our commitments <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        </section>
        <section
          id="demo"
          className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10"
          aria-labelledby="demo-heading"
        >
          <p className="eyebrow">Inside the workflow · synthetic example</p>
          <h2 id="demo-heading" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            A useful reply has a trail of evidence.
          </h2>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground">
            Explore the fictional ClarityScale AI example. Your workspace computes its own scores
            from current sources and rules; this walkthrough contains no customer activity.
          </p>
          <div className="mt-9 grid gap-5 lg:grid-cols-3">
            <article className="panel p-6">
              <p className="eyebrow">01 · Understand the opportunity</p>
              <h3 className="mt-4 text-lg font-semibold">
                “Which image optimization API can handle batch product photography?”
              </h3>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                The synthetic post asks for an API, batch processing and developer documentation.
                The score explains product fit, buying intent, freshness, engagement, community
                rules and competitor context.
              </p>
              <p className="mt-4 rounded-xl bg-muted p-3 text-xs leading-6">
                A strong match still needs a rules check. A no-vendor request or a contradicted
                capability can block a reply.
              </p>
            </article>
            <article className="panel p-6">
              <p className="eyebrow">02 · Draft with sources</p>
              <blockquote className="mt-4 border-l-2 border-primary pl-4 text-sm leading-7">
                “I work with the team behind ClarityScale AI. Its fictional API supports
                asynchronous batch image processing. Review the original and output together:
                upscaling cannot guarantee recovered detail.”
              </blockquote>
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                Evidence: synthetic product overview and image-quality limitations. In the
                workspace, each claim links to its supporting source; unsupported claims block
                approval.
              </p>
              <p className="mt-4 text-xs font-semibold text-positive">
                Review → verify → approve → insert → publish yourself
              </p>
            </article>
            <article className="panel p-6">
              <p className="eyebrow">03 · Measure what follows</p>
              <h3 className="mt-4 text-lg font-semibold">Conversation to attributed outcome.</h3>
              <ol className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                <li>1. Add an approved destination link.</li>
                <li>2. Record a qualifying click receipt.</li>
                <li>3. Receive a consented signup or purchase event.</li>
                <li>4. Explore the funnel by brand and conversation.</li>
              </ol>
              <p className="mt-4 rounded-xl bg-muted p-3 text-xs leading-6">
                Revenue is attributed within your selected window. A click receipt does not identify
                a person or establish causation.
              </p>
            </article>
          </div>
          <Link
            href="/login"
            className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            Try the local workflow <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
        <section className="border-y border-border bg-white" aria-labelledby="home-plans-heading">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:px-10">
            <p className="eyebrow">Compare your room to grow</p>
            <h2 id="home-plans-heading" className="mt-4 text-3xl font-semibold tracking-tight">
              Clear plans. Human control in every one.
            </h2>
            <p className="mb-8 mt-5 text-sm leading-7 text-muted-foreground">
              The seven-day trial needs no card. Local upgrades simulate a subscription without
              collecting payment; limits are enforced by the server.
            </p>
            <PlanCards plans={getPlanCards()} />
            <Link
              href="/pricing"
              className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-primary"
            >
              Pricing and limit details <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 md:grid-cols-[1fr_1.4fr] lg:px-10">
          <div>
            <p className="eyebrow">A few good questions</p>
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.04em]">
              Clarity,
              <br />
              <span className="font-editorial font-normal italic text-primary">
                before you begin.
              </span>
            </h2>
          </div>
          <div className="divide-y divide-border">
            {[
              [
                'Does ThreadSignal post for me?',
                'No. A real person reviews the reply, decides whether it belongs in the conversation, and clicks Reddit’s final submit button.',
              ],
              [
                'What can I try right now?',
                'The local demo includes sign-in, teams, fixture knowledge ingestion, scored opportunities, verified drafts, manual extension handoff, attributed conversions, mock billing and notification preferences. Live Reddit and paid providers remain disabled.',
              ],
              [
                'Do I need a paid account or a credit card?',
                'No card is needed for the seven-day trial. This local build uses mock providers and never collects a real payment.',
              ],
              [
                'Is ThreadSignal affiliated with Reddit?',
                'No. ThreadSignal is an independent project. Every user is responsible for community rules and honest disclosure, and moderator acceptance is never guaranteed.',
              ],
            ].map(([question, answer]) => (
              <details key={question} className="group py-5 first:pt-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-sm font-semibold">
                  {question}
                  <span
                    aria-hidden="true"
                    className="text-xl font-normal text-muted-foreground transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-4 pr-6 text-sm leading-7 text-muted-foreground">{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:px-10">
          <div className="relative overflow-hidden rounded-3xl bg-[#25213f] px-7 py-12 text-center text-white sm:px-12 sm:py-16">
            <div
              aria-hidden="true"
              className="absolute -right-28 -top-32 size-[420px] rounded-full border border-white/10"
            />
            <div
              aria-hidden="true"
              className="absolute -right-16 -top-20 size-[324px] rounded-full border border-white/10"
            />
            <div className="relative">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200">
                Start with a little signal
              </p>
              <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                Make space for{' '}
                <span className="font-editorial font-normal italic text-violet-200">
                  better conversations.
                </span>
              </h2>
              <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-violet-100/80">
                Create your workspace. Bring your team. Build a foundation for thoughtful,
                transparent participation.
              </p>
              <Button asChild className="mt-7 bg-white text-primary hover:bg-violet-50">
                <Link href="/login">
                  Start free trial <ArrowRight size={16} />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
