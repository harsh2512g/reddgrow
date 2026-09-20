import { NotificationSettings } from '@/components/phase7/notification-settings';
import { PageHeading } from '@/components/phase1/primitives';
import { loadNotificationPreferences } from '@/lib/phase7/server';

export default async function NotificationSettingsPage() {
  const data = await loadNotificationPreferences();
  return (
    <>
      <PageHeading
        eyebrow="Your notifications"
        title="Keep the signal. Set the rhythm."
        description="Choose the updates that matter, then decide when they reach you."
      />
      <NotificationSettings key={data.organization.id} {...data} />
    </>
  );
}
