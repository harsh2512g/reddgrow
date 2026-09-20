import type { Metadata } from 'next';
import { AnalyticsDashboard } from '@/components/phase6/analytics-dashboard';
import { loadAnalytics } from '@/lib/phase6/server';

export const metadata: Metadata = { title: 'Attribution analytics' };
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const input = await searchParams;
  const report = await loadAnalytics(input);
  return (
    <AnalyticsDashboard
      key={`${report.organization.id}:${JSON.stringify(report.filters)}`}
      enabled={report.enabled}
      advancedAnalytics={report.advancedAnalytics}
      organization={report.organization}
      filters={report.filters}
      options={report.options}
      analytics={report.analytics}
      invalidFilters={report.invalidFilters}
    />
  );
}
