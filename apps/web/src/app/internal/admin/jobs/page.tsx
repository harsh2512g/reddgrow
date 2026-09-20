import type { Metadata } from 'next';
import { JobsConsole } from '@/components/phase8/operations';
import { PageHeading } from '@/components/phase1/primitives';
import { adminPageSession } from '@/lib/phase8/admin';
import { checked } from '@/lib/phase8/errors';
import { jobsPageSchema } from '@/lib/phase8/contracts';
export const metadata: Metadata = { title: 'Processing jobs' };
export default async function JobsPage() {
  const { supabase } = await adminPageSession();
  const initial = jobsPageSchema.parse(
    checked(await supabase.rpc('platform_admin_jobs', { p_status: 'failed', p_limit: 25 })),
  );
  return (
    <>
      <PageHeading
        eyebrow="Operations / processing"
        title="Every job has a trail."
        description="Inspect processing states and safe failure codes. Retry controls appear only for eligible failed jobs; every retry is checked again in Supabase."
      />
      <JobsConsole initial={initial} />
    </>
  );
}
