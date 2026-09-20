import { z } from 'zod';
import { hasOrganizationPermission } from '@threadsignal/config';
import { requireOrganization } from '@/lib/organizations/server';
import { organizationSchema } from '@/lib/organizations/schema';
import { OrganizationForm, DataRequestPanel } from '@/components/phase1/organization-form';
import { PrivacyControls } from '@/components/phase8/privacy';
import { localOpportunitiesEnabled } from '@/lib/phase3/server';
import { privacyRequestsSchema } from '@/lib/phase8/privacy-schema';
import { checked } from '@/lib/phase8/errors';
import { PageHeading } from '@/components/phase1/primitives';
import { updateOrganizationAction, dataRequestAction } from '../../actions';
export default async function OrganizationSettings() {
  const { organization, supabase } = await requireOrganization();
  const result = await supabase.rpc('get_organization_settings', {
    p_organization_id: organization.id,
  });
  if (result.error) throw new Error('Organization settings could not be loaded.');
  const settings = z
    .array(organizationSchema.extend({ billing_email: z.string().nullable() }))
    .min(1)
    .parse(result.data)[0]!;
  const privacyEnabled = localOpportunitiesEnabled();
  const requests =
    privacyEnabled && organization.role === 'owner'
      ? privacyRequestsSchema.parse(
          checked(
            await supabase.rpc('list_organization_data_requests', {
              p_organization_id: organization.id,
            }),
          ),
        )
      : [];
  return (
    <>
      <PageHeading
        eyebrow="Workspace settings"
        title="A space that feels like yours."
        description="Keep your organization details current. Your role determines which settings you can change."
      />
      <section className="panel p-6 sm:p-8">
        <OrganizationForm
          action={updateOrganizationAction.bind(null, organization.id)}
          mode="edit"
          canEdit={hasOrganizationPermission(organization.role, 'manage_settings')}
          canEditBilling={organization.role === 'owner'}
          defaultValues={{
            name: settings.name,
            slug: settings.slug,
            billingEmail: settings.billing_email ?? '',
            timezone: settings.timezone,
            currency: settings.default_currency,
          }}
        />
      </section>
      {privacyEnabled ? (
        <PrivacyControls
          initial={requests}
          organizationId={organization.id}
          slug={organization.slug}
          canManage={organization.role === 'owner'}
        />
      ) : (
        <DataRequestPanel
          action={dataRequestAction.bind(null, organization.id)}
          canManage={organization.role === 'owner'}
        />
      )}
    </>
  );
}
