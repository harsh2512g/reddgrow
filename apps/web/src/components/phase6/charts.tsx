import { useId } from 'react';
import { ArrowDownRight, BarChart3, CircleDot } from 'lucide-react';
import { formatCount, formatDate, formatRevenue } from './format';

export function TrendChart({
  title,
  description,
  points,
  currency,
}: {
  title: string;
  description: string;
  points: Array<{ date: string; value: number }>;
  currency?: string;
}) {
  const id = useId();
  const maximum = Math.max(1, ...points.map((point) => point.value));
  const width = 620,
    height = 170,
    padding = 12;
  const x = (index: number) =>
    padding + (index / Math.max(1, points.length - 1)) * (width - padding * 2);
  const y = (value: number) => height - padding - (value / maximum) * (height - padding * 2);
  const coordinates = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ');
  const valueLabel = (value: number) =>
    currency ? formatRevenue(value, currency) : formatCount(value);
  const hasValues = points.some((point) => point.value > 0);
  return (
    <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby={`${id}-heading`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-heading`} className="text-sm font-semibold">
            {title}
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <span className="rounded-xl bg-violet-50 p-2.5 text-primary">
          <BarChart3 aria-hidden="true" size={17} />
        </span>
      </div>
      {hasValues ? (
        <>
          <div className="mt-6 flex justify-between text-[10px] text-muted-foreground">
            <span>{valueLabel(maximum)}</span>
            <span>Daily totals · UTC</span>
          </div>
          <svg
            className="mt-2 h-44 w-full overflow-visible"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby={`${id}-chart-title ${id}-chart-description`}
          >
            <title id={`${id}-chart-title`}>{title}</title>
            <desc id={`${id}-chart-description`}>
              Daily values are available in the data table below the chart.
            </desc>
            <defs>
              <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7161d3" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#7161d3" stopOpacity="0.01" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                x1={padding}
                x2={width - padding}
                y1={y(maximum * fraction)}
                y2={y(maximum * fraction)}
                stroke="#e4e2ed"
                strokeDasharray="3 5"
              />
            ))}
            <polygon
              points={`${padding},${height - padding} ${coordinates} ${x(points.length - 1)},${height - padding}`}
              fill={`url(#${id}-fill)`}
            />
            <polyline
              points={coordinates}
              fill="none"
              stroke="#6554ca"
              strokeWidth="2.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {points.length === 1 && (
              <circle cx={x(0)} cy={y(points[0]!.value)} r="3" fill="#6554ca" />
            )}
          </svg>
          <div className="mt-1 flex justify-between gap-4 text-[10px] text-muted-foreground">
            <span>{points[0] && formatDate(points[0].date)}</span>
            <span>{points.at(-1) && formatDate(points.at(-1)!.date)}</span>
          </div>
        </>
      ) : (
        <div className="my-5 flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-center">
          <CircleDot aria-hidden="true" size={25} className="text-primary/60" />
          <p className="mt-3 text-sm font-medium">No activity in this period</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            The chart will reflect recorded activity as it arrives.
          </p>
        </div>
      )}
      <details className="mt-5 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-medium text-primary">
          View {title.toLowerCase()} data
        </summary>
        <div className="mt-3 max-h-56 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title} daily values</caption>
            <thead>
              <tr>
                <th scope="col" className="py-2 font-medium">
                  Date (UTC)
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  {currency ?? 'Count'}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date} className="border-t border-border/70">
                  <th scope="row" className="py-2 font-normal text-muted-foreground">
                    {formatDate(point.date)}
                  </th>
                  <td className="py-2 text-right tabular-nums">{valueLabel(point.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function ActivityFunnel({ steps }: { steps: Array<{ label: string; value: number }> }) {
  const maximum = Math.max(1, ...steps.map((step) => step.value));
  return (
    <section className="panel min-w-0 p-5 sm:p-6" aria-labelledby="activity-funnel-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="activity-funnel-title" className="text-sm font-semibold">
            From conversation to conversion
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Recorded activity in the selected period.
          </p>
        </div>
        <ArrowDownRight size={21} className="shrink-0 text-primary" aria-hidden="true" />
      </div>
      <ol className="mt-6 space-y-4">
        {steps.map((step, index) => (
          <li key={step.label}>
            <div className="mb-2 flex justify-between gap-3 text-xs">
              <span className="text-muted-foreground">
                <span className="mr-2 font-mono text-[10px] text-primary/70">0{index + 1}</span>
                {step.label}
              </span>
              <span className="font-semibold tabular-nums">{formatCount(step.value)}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${(step.value / maximum) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 rounded-xl bg-violet-50/60 px-3 py-3 text-[11px] leading-5 text-muted-foreground">
        These are activity counts, not a single cohort. One conversation can generate multiple
        clicks or purchases. Publication is recorded by a person.
      </p>
    </section>
  );
}
