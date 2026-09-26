import { loadOnboarding } from '@/lib/onboarding/server';
import { OrganizationForm } from '@/components/phase1/organization-form';
import { PageHeading, ResponsibleNote } from '@/components/phase1/primitives';
import { createOrganizationAction } from '../actions';
import Link from 'next/link';
import { SetupChecklist } from '@/components/onboarding/checklist';
import { LocalKnowledgeNotice } from '@/components/phase2/primitives';
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; create?: string }>;
}) {
  const params = await searchParams;
  const { user, organizations, active, brand, state, knowledgeEnabled } = await loadOnboarding(
    params.brandId,
  );
  const ownsWorkspace = organizations.some((item) => item.role === 'owner');
  if (active && params.create !== '1')
    return (
      <>
        <PageHeading
          eyebrow="Guided setup"
          title={
            brand
              ? `Bring ${brand.name} into focus.`
              : 'From product knowledge to useful conversations.'
          }
          description="Follow these steps to build an evidence-backed opportunity feed. Your progress is saved in your workspace."
        />
        {knowledgeEnabled ? (
          <SetupChecklist state={state} canManage={['owner', 'admin'].includes(active.role)} />
        ) : (
          <LocalKnowledgeNotice />
        )}
        <div className="mt-6">
          <ResponsibleNote />
        </div>
      </>
    );
  return (
    <>
      <PageHeading
        eyebrow="A fresh start"
        title="Make space for your team."
        description="Give your organization a home. Your seven-day trial starts when you create the workspace, with no card required."
      />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_300px]">
        <section className="panel p-6 sm:p-8">
          {ownsWorkspace ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Your workspace is already ready.</h2>
              <p className="text-sm leading-7 text-muted-foreground">
                Your account can own one workspace. You can also join other teams by invitation.
              </p>
              <Link href="/app" className="font-semibold text-primary">
                Open your workspace →
              </Link>
            </div>
          ) : (
            <OrganizationForm
              action={createOrganizationAction}
              mode="create"
              defaultValues={{
                name: '',
                slug: '',
                billingEmail: user.email ?? '',
                timezone: 'UTC',
                currency: 'USD',
              }}
            />
          )}
        </section>
        <ResponsibleNote />
      </div>
    </>
  );
}
