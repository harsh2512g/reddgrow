import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BookOpen, Building2, Plus } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { PageHeading, PermissionNotice } from '../phase1/primitives';
import { KnowledgeEmpty, KnowledgeIntro } from './primitives';
import type { Brand } from './types';

export function BrandLibrary({
  brands,
  organizationName,
  canManage,
}: {
  brands: Brand[];
  organizationName: string;
  canManage: boolean;
}) {
  const activeCount = brands.filter((brand) => brand.status === 'active').length;
  return (
    <>
      <PageHeading
        eyebrow="The product studio"
        title="Know your product. Find your voice."
        description={`A home for the products, sources, and honest points of view behind ${organizationName}.`}
        action={
          canManage ? (
            <Button asChild>
              <Link href="/app/brands/new">
                <Plus size={16} /> Add brand
              </Link>
            </Button>
          ) : undefined
        }
      />
      <KnowledgeIntro
        title="Better context. More useful answers."
        description="Start with what your product really does. Bring its documentation, limitations, and your team’s knowledge into one considered place."
      >
        <div className="mt-5 flex flex-wrap gap-5 text-xs text-primary">
          <span>
            {activeCount} active {activeCount === 1 ? 'brand' : 'brands'}
          </span>
          <span>{brands.filter((brand) => brand.status === 'archived').length} archived</span>
          <span>Private to your organization</span>
        </div>
      </KnowledgeIntro>
      {!canManage && (
        <PermissionNotice>
          Your role can explore brand profiles and knowledge. An owner or admin can add and manage
          brands.
        </PermissionNotice>
      )}
      {brands.length === 0 ? (
        <KnowledgeEmpty
          title="Make room for your first product."
          description={
            canManage
              ? 'Create a brand profile, then add approved sources. You can also explore the complete workflow with our clearly labeled synthetic demo.'
              : 'Your organization has not created a brand yet. Ask an owner or admin to add the first product.'
          }
          {...(canManage ? { href: '/app/brands/new', action: 'Create your first brand' } : {})}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {brands.map((brand) => (
            <article key={brand.id} className="panel flex min-w-0 flex-col overflow-hidden">
              <div className={`h-1.5 ${brand.status === 'active' ? 'bg-primary' : 'bg-border'}`} />
              <div className="flex-1 p-6">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-12 items-center justify-center rounded-2xl border border-violet-200 bg-violet-50 font-editorial text-2xl text-primary">
                    {brand.name.charAt(0)}
                  </span>
                  <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium capitalize text-muted-foreground">
                    {brand.status}
                  </span>
                </div>
                <Link
                  href={`/app/brands/${brand.id}`}
                  className="group mt-5 flex items-start justify-between gap-3"
                >
                  <h2 className="break-words text-xl font-semibold tracking-tight group-hover:text-primary">
                    {brand.name}
                  </h2>
                  <ArrowUpRight
                    size={16}
                    className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary"
                  />
                </Link>
                <p className="mt-2 break-all text-[11px] text-muted-foreground">
                  {brand.website_url}
                </p>
                <p className="mt-4 line-clamp-3 text-sm leading-7 text-muted-foreground">
                  {brand.profile.description}
                </p>
                <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                  <Building2 size={14} /> {brand.profile.category}
                </p>
              </div>
              <div className="border-t border-border p-5">
                <Link
                  href={`/app/knowledge?brandId=${brand.id}`}
                  className="flex items-center justify-between gap-3 text-xs font-semibold text-primary"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen size={16} /> Open knowledge library
                  </span>
                  <ArrowRight size={15} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
