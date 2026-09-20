import type { Metadata } from 'next';
import { z } from 'zod';
import { notFound } from 'next/navigation';
import { OrganizationOperations } from '@/components/phase8/operations';
import { PageHeading } from '@/components/phase1/primitives';
import { adminPageSession } from '@/lib/phase8/admin';
import { checked } from '@/lib/phase8/errors';
import { organizationDetailSchema } from '@/lib/phase8/contracts';
export const metadata: Metadata = { title: 'Workspace operations' };
export default async function OrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await adminPageSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const result = await supabase.rpc('platform_admin_organization', { p_organization_id: id.data });
  if (result.error?.message === 'ORGANIZATION_NOT_FOUND') notFound();
  const data = organizationDetailSchema.parse(checked(result));
  return (
    <>
      <PageHeading
        eyebrow="Operations / workspace"
        title={data.organization.name}
        description="Operational metadata only. Platform access does not grant permission to read customer knowledge or drafts."
      />
      <OrganizationOperations data={data} />
    </>
  );
}
