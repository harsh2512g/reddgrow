import type { Metadata } from 'next';
import { OperationsSummary, OrganizationDirectory } from '@/components/phase8/operations';
import { adminPageSession } from '@/lib/phase8/admin';
import { checked } from '@/lib/phase8/errors';
import { organizationsPageSchema, overviewSchema } from '@/lib/phase8/contracts';
export const metadata: Metadata = { title: 'Platform operations' };
export default async function OperationsPage() {
  const { supabase } = await adminPageSession();
  const [overview, organizations] = await Promise.all([
    supabase.rpc('platform_admin_overview'),
    supabase.rpc('platform_admin_organizations', { p_limit: 25 }),
  ]);
  return (
    <>
      <OperationsSummary overview={overviewSchema.parse(checked(overview))} />
      <OrganizationDirectory initial={organizationsPageSchema.parse(checked(organizations))} />
    </>
  );
}
