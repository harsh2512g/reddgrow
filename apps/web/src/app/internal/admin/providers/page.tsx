import type { Metadata } from 'next';
import { ProviderConfiguration } from '@/components/phase8/operations';
import { PageHeading } from '@/components/phase1/primitives';
import { adminPageSession, configuredProviders } from '@/lib/phase8/admin';
export const metadata: Metadata = { title: 'Provider configuration' };
export default async function ProvidersPage() {
  await adminPageSession();
  return (
    <>
      <PageHeading
        eyebrow="Operations / providers"
        title="Know what is connected."
        description="Provider configuration is visible here. Activation stays an explicit, separately reviewed operation."
      />
      <ProviderConfiguration providers={configuredProviders()} />
    </>
  );
}
