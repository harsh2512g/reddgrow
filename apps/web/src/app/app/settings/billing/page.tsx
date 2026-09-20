import { BillingDashboard } from '@/components/phase7/billing-dashboard';
import { PageHeading } from '@/components/phase1/primitives';
import { loadBilling } from '@/lib/phase7/server';
export default async function BillingSettings() {
  const data = await loadBilling();
  return (
    <>
      <PageHeading
        eyebrow="Plan & usage"
        title="Room for your next chapter."
        description="Understand your plan, see your allocation, and choose your pace."
      />
      <BillingDashboard key={data.organization.id} {...data} />
    </>
  );
}
