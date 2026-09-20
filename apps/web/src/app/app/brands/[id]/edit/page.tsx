import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { loadBrand } from '@/lib/knowledge/server';
import { PageHeading } from '@/components/phase1/primitives';
import { BrandForm } from '@/components/phase2/brand-form';
import { LocalKnowledgeNotice } from '@/components/phase2/primitives';

export default async function EditBrandPage({ params }: { params: Promise<{ id: string }> }) {
  const workspace = await loadBrand((await params).id);
  if (!workspace.localEnabled) return <LocalKnowledgeNotice />;
  if (!workspace.brand) notFound();
  return (
    <>
      <Link
        href={`/app/brands/${workspace.brand.id}`}
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"
      >
        <ArrowLeft size={14} /> Back to brand
      </Link>
      <PageHeading
        eyebrow="Brand profile"
        title={workspace.canManage ? `Refine ${workspace.brand.name}.` : workspace.brand.name}
        description="Keep your capabilities, context, and affiliations current. Changes apply to this brand only."
      />
      <BrandForm
        key={workspace.brand.id}
        brand={workspace.brand}
        organizationId={workspace.organization.id}
        canManage={workspace.canManage}
      />
    </>
  );
}
