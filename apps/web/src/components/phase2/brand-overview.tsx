import Link from 'next/link';
import { ArrowLeft, BookOpen, Pencil } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { PageHeading } from '../phase1/primitives';
import { BrandArchiveAction } from './brand-actions';
import { KnowledgeChecklist, KnowledgeIntro } from './primitives';
import type { Brand } from './types';

export function BrandOverview({ brand, canManage }: { brand: Brand; canManage: boolean }) {
  const profile = brand.profile;
  return (
    <>
      <Link
        href="/app/brands"
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={14} /> All brands
      </Link>
      <PageHeading
        eyebrow={`Brand profile · ${brand.status}`}
        title={brand.name}
        description={profile.description}
        action={
          <Button asChild variant="outline">
            <Link href={`/app/brands/${brand.id}/edit`}>
              <Pencil size={15} />
              {canManage ? 'Edit profile' : 'Read full profile'}
            </Link>
          </Button>
        }
      />
      <KnowledgeIntro
        title="Give your product a source of truth."
        description={profile.value_proposition}
      >
        <Button asChild className="mt-6">
          <Link href={`/app/knowledge?brandId=${brand.id}`}>
            <BookOpen size={16} /> Open knowledge library
          </Link>
        </Button>
      </KnowledgeIntro>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          <section className="panel p-6">
            <h2 className="text-lg font-semibold">Product essentials</h2>
            <dl className="mt-5 grid gap-6 sm:grid-cols-2">
              {[
                { label: 'Approved website', value: brand.website_url },
                { label: 'Category', value: profile.category },
                { label: 'Target audience', value: profile.target_audience },
                {
                  label: 'Countries served',
                  value: profile.countries.join(', ') || 'Not specified',
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="mt-2 break-words text-sm leading-7">{item.value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-6 text-xs font-semibold text-muted-foreground">Primary use cases</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.use_cases.length ? (
                profile.use_cases.map((item, index) => (
                  <span
                    key={`${item}-${index}`}
                    className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
                  >
                    {item}
                  </span>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No use cases added.</p>
              )}
            </div>
          </section>
          <section className="panel p-6">
            <h2 className="text-lg font-semibold">A transparent voice</h2>
            <p className="mt-2 text-xs capitalize leading-6 text-muted-foreground">
              {profile.real_role} · {profile.tone} · {profile.reply_length} replies
            </p>
            <blockquote className="mt-5 border-l-2 border-primary pl-5 font-editorial text-xl italic leading-8 text-primary">
              {profile.disclosure_text}
            </blockquote>
            <p className="mt-5 text-xs leading-6 text-muted-foreground">
              This is an affiliation statement, not a fabricated identity. Your team reviews and
              publishes every reply manually.
            </p>
          </section>
          <section className="panel p-6">
            <h2 className="text-lg font-semibold">The wider landscape</h2>
            {profile.competitors.length ? (
              <ul className="mt-5 divide-y divide-border">
                {profile.competitors.map((competitor, index) => (
                  <li key={`${competitor.name}-${index}`} className="py-3">
                    <p className="text-sm font-semibold">{competitor.name}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {competitor.domain}
                    </p>
                    {competitor.aliases.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Also known as {competitor.aliases.join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No competitors added.</p>
            )}
          </section>
        </div>
        <div className="space-y-5">
          <KnowledgeChecklist
            items={[
              { label: 'Product profile saved', complete: true },
              {
                label: 'Use cases and countries',
                complete: Boolean(profile.use_cases.length && profile.countries.length),
              },
              { label: 'Affiliation documented', complete: true },
              { label: 'Approved product links', complete: profile.allowed_links.length > 0 },
            ]}
          />
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Claims to avoid</h2>
            {profile.avoid_claims.length ? (
              <ul className="mt-4 space-y-3">
                {profile.avoid_claims.map((claim, index) => (
                  <li
                    className="border-l-2 border-amber-200 pl-3 text-xs leading-6 text-muted-foreground"
                    key={`${claim}-${index}`}
                  >
                    {claim}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs leading-6 text-muted-foreground">
                Add limitations or unsupported claims your team should avoid.
              </p>
            )}
          </section>
        </div>
      </div>
      {canManage && <BrandArchiveAction brand={brand} />}
    </>
  );
}
