import { IntegrationsPanel } from '@/components/phase1/integrations-panel';
import { PageHeading } from '@/components/phase1/primitives';
import { requireOrganization } from '@/lib/organizations/server';
import { getServerEnv } from '@/lib/env/server';
import { loadExtensionSettings } from '@/lib/phase5/server';
import { ExtensionConnectionsPanel } from '@/components/phase5/connections';
import { ConversionSettings } from '@/components/phase6/conversion-settings';
import { loadTracking } from '@/lib/phase6/server';
export default async function IntegrationsSettings({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string }>;
}) {
  const { brandId } = await searchParams;
  const context = await requireOrganization();
  const env = getServerEnv();
  const extension = await loadExtensionSettings(context);
  const tracking = await loadTracking(brandId);
  return (
    <>
      <PageHeading
        eyebrow="Connections"
        title="Know what’s connected."
        description="Clear provider states, with your privacy at the center."
      />
      <ExtensionConnectionsPanel
        key={`${extension.organizationId}:${extension.userId}`}
        {...extension}
      />
      <ConversionSettings
        key={`${tracking.organization.id}:${tracking.brand?.id ?? ''}`}
        organization={tracking.organization}
        enabled={tracking.enabled}
        canManage={tracking.canManage}
        brands={tracking.brands}
        brand={tracking.brand ?? null}
        apiOrigin={tracking.apiOrigin}
        keys={tracking.keys}
        settings={tracking.settings}
        features={tracking.features}
      />
      <IntegrationsPanel
        supabaseMode={env.THREADSIGNAL_SUPABASE_MODE}
        modes={{
          REDDIT_PROVIDER: env.REDDIT_PROVIDER,
          AI_PROVIDER: env.AI_PROVIDER,
          EMAIL_PROVIDER: env.EMAIL_PROVIDER,
          BILLING_PROVIDER: env.BILLING_PROVIDER,
          CRAWLER_PROVIDER: env.CRAWLER_PROVIDER,
        }}
      />
    </>
  );
}
