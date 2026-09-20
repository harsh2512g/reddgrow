import Link from 'next/link';
import { ArrowUpRight, Link2, MessageSquareText, Sparkles } from 'lucide-react';
import type { AnalyticsReport } from '@threadsignal/analytics';
import { Button } from '@threadsignal/ui';
import { PageHeading, ResponsibleNote } from '../phase1/primitives';
import { MetricTiles } from './analytics-dashboard';
import { ActivityFunnel, TrendChart } from './charts';
import { formatDate, RevenueValues } from './format';

export function AttributionOverview({
  organizationName,
  report,
}: {
  organizationName: string;
  report: AnalyticsReport;
}) {
  return (
    <>
      <PageHeading
        eyebrow="Your workspace, in perspective"
        title="Good conversations start here."
        description={`A clear view of ${organizationName}’s opportunities, thoughtful replies and attributed customer actions.`}
        action={
          <Button asChild variant="outline">
            <Link href="/app/analytics">
              Explore analytics <ArrowUpRight size={15} />
            </Link>
          </Button>
        }
      />
      <section className="relative mb-6 overflow-hidden rounded-[26px] border border-violet-200 bg-[#efecf8] p-6 sm:p-8">
        <div
          aria-hidden="true"
          className="absolute -right-24 -top-28 size-96 rounded-full border-[45px] border-white/40"
        />
        <div className="relative grid items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-primary">
              <Sparkles size={16} /> Small conversations. A clearer picture.
            </p>
            <h2 className="mt-5 text-sm font-semibold text-muted-foreground">Attributed revenue</h2>
            <div className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {report.metrics.revenue.length ? (
                <RevenueValues amounts={report.metrics.revenue} />
              ) : (
                'No attributed revenue yet'
              )}
            </div>
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              {formatDate(report.range.from)} – {formatDate(report.range.to)} · UTC
              <br />
              Currencies stay separate. Attribution describes a relationship, not proof of
              causation.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <Link
              href="/app/opportunities"
              className="flex items-center gap-3 rounded-2xl border border-white bg-white/70 p-4 hover:bg-white"
            >
              <MessageSquareText size={20} className="text-primary" />
              <span className="flex-1">
                <span className="block text-xs font-semibold">Find a useful conversation</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Review intent, relevance and community rules.
                </span>
              </span>
              <ArrowUpRight size={15} />
            </Link>
            <Link
              href="/app/tracking"
              className="flex items-center gap-3 rounded-2xl border border-white bg-white/70 p-4 hover:bg-white"
            >
              <Link2 size={20} className="text-primary" />
              <span className="flex-1">
                <span className="block text-xs font-semibold">Connect a reply to results</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Create a tracking link from an approved draft.
                </span>
              </span>
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </section>
      <MetricTiles report={report} />
      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[1.5fr_1fr]">
        <TrendChart
          title="New opportunities"
          description="Real workspace activity across the last 30 days."
          points={report.timeseries.map((point) => ({
            date: point.date,
            value: point.opportunities,
          }))}
        />
        <div className="space-y-5">
          <ActivityFunnel
            steps={report.funnel.map((step) => ({
              label:
                step.stage === 'published' ? 'Published manually' : step.stage.replaceAll('_', ' '),
              value: step.count,
            }))}
          />
          <ResponsibleNote />
        </div>
      </div>
      <p className="mt-5 text-[11px] leading-6 text-muted-foreground">
        Unique attributed clicks count distinct receipts, not identified people. Open Analytics to
        filter by brand, community, opportunity or event and review the records behind these totals.
      </p>
    </>
  );
}
