export function LoadingSkeleton({ label = 'Loading content' }: { label?: string }) {
  return (
    <div role="status" className="space-y-4 rounded-xl border border-border bg-white p-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-5 w-1/3 rounded bg-muted" />
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-28 rounded-lg bg-muted" />
      </div>
    </div>
  );
}
