import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, Flag, Layers3, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { PageHeading, ResponsibleNote, SignalArt } from './primitives';
import type { Role } from './types';

export function Dashboard({
  organization,
  memberCount,
  trialEndsAt,
  planName,
  localKnowledgeEnabled = true,
}: {
  organization: { name: string; slug: string; role: Role; createdAt: string };
  memberCount: number;
  trialEndsAt: string;
  planName: string;
  localKnowledgeEnabled?: boolean;
}) {
  const trialDate = new Date(trialEndsAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <>
      <PageHeading
        eyebrow="Your starting point"
        title="Good conversations start here."
        description={`Welcome to ${organization.name}. A considered space for your team, built around useful answers and human judgment.`}
      />
      <section className="signal-welcome relative isolate mb-7 overflow-hidden rounded-[24px] border border-violet-200 bg-[#efedf9] p-7 sm:p-9">
        <div className="relative z-10 max-w-xl sm:w-3/5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-white/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Check size={12} /> Workspace created
          </span>
          <h2 className="mt-5 max-w-md text-3xl font-semibold leading-[1.18] tracking-[-0.04em] sm:text-4xl">
            A little more signal.
            <br />
            <span className="font-editorial font-normal italic text-primary">
              A lot more purpose.
            </span>
          </h2>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
            Your organization is ready. Make this space your own, review your plan, and set clear
            access for your team.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app/settings/organization">
              Make it yours <ArrowRight size={16} />
            </Link>
          </Button>
        </div>
        <div className="absolute -bottom-12 -right-16 -z-0 hidden w-[390px] opacity-90 sm:block xl:right-2">
          <SignalArt compact />
        </div>
      </section>
      <div className="grid gap-5 sm:grid-cols-3">
        <SummaryCard
          icon={<Flag size={18} />}
          label="Current plan"
          value={planName}
          detail={
            planName.toLowerCase() === 'trial'
              ? `Trial record ends ${trialDate}`
              : 'View your subscription and plan allocation'
          }
          href="/app/settings/billing"
        />
        <SummaryCard
          icon={<Users size={18} />}
          label="Your team"
          value={`${memberCount} ${memberCount === 1 ? 'person' : 'people'}`}
          detail="People with access to this workspace"
          href="/app/settings/team"
        />
        <SummaryCard
          icon={<ShieldCheck size={18} />}
          label="Your access"
          value={organization.role}
          detail="Permissions enforced for your organization"
          href="/app/settings/organization"
        />
      </div>
      <div className="mt-7 grid gap-6 xl:grid-cols-[1.65fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border p-6">
            <div>
              <h2 className="font-semibold">A strong foundation</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Your workspace essentials, in one place.
              </p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-positive">
              <Check size={18} />
            </span>
          </div>
          <div className="divide-y divide-border px-6">
            {[
              {
                title: 'Organization established',
                description: `Your team’s home at ${organization.slug}.`,
                href: '/app/settings/organization',
              },
              {
                title: 'Access is in your hands',
                description: 'Review membership and the role each person holds.',
                href: '/app/settings/team',
              },
              {
                title: 'Know your plan',
                description: 'See your trial, seat allocation, and included limits.',
                href: '/app/settings/billing',
              },
            ].map((item, index) => (
              <Link
                key={item.title}
                href={item.href}
                className="group flex items-center gap-4 py-5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                  0{index + 1}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold group-hover:text-primary">{item.title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <ArrowUpRight
                  size={16}
                  className="shrink-0 text-muted-foreground group-hover:text-primary"
                />
              </Link>
            ))}
          </div>
        </section>
        <div className="space-y-5">
          <ResponsibleNote />
          <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Layers3 size={17} className="text-primary" /> Your product, understood.
            </div>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              {localKnowledgeEnabled
                ? 'Give your product a home. Build a brand profile, bring in trusted sources, and explore your team’s knowledge.'
                : 'Brand profiles and knowledge search are available in the local workspace. Hosted organization settings remain available here.'}
            </p>
            <Link
              href={localKnowledgeEnabled ? '/app/brands' : 'http://127.0.0.1:3000/app/brands'}
              className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary"
            >
              {localKnowledgeEnabled ? 'Open product studio' : 'Open local product studio'}{' '}
              <ArrowRight size={14} />
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="panel group p-5 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        <ArrowUpRight size={14} className="text-muted-foreground group-hover:text-primary" />
      </div>
      <p className="mt-4 text-2xl font-semibold capitalize tracking-tight">{value}</p>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{detail}</p>
    </Link>
  );
}
