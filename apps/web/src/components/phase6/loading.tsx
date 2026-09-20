export function AttributionLoading() {
  return (
    <div role="status" aria-label="Loading attribution">
      <div className="mb-7 space-y-3">
        <div className="h-3 w-32 rounded bg-muted motion-safe:animate-pulse" />
        <div className="h-9 w-4/5 max-w-lg rounded-lg bg-muted motion-safe:animate-pulse" />
        <div className="h-4 w-full max-w-xl rounded bg-muted motion-safe:animate-pulse" />
      </div>
      <div className="mb-5 h-28 rounded-2xl border border-border bg-white" />
      <div className="mb-5 h-48 rounded-[26px] border border-violet-100 bg-violet-50/60" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="panel h-28 bg-white motion-safe:animate-pulse" />
        ))}
      </div>
      <span className="sr-only">Loading your workspace’s attribution records.</span>
    </div>
  );
}
