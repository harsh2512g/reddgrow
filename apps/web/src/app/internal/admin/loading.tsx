export default function OperationsLoading() {
  return (
    <div role="status" aria-label="Loading operations" className="space-y-5">
      <div className="h-40 animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-32 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
      <span className="sr-only">Loading operations…</span>
    </div>
  );
}
