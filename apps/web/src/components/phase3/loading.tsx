export function SignalLoading() {
  return (
    <div role="status" aria-label="Loading conversation radar" className="space-y-6">
      <span className="sr-only">Loading your communities and opportunities…</span>
      <div className="h-52 rounded-3xl bg-violet-100/60 motion-safe:animate-pulse" />
      <div className="grid gap-5 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div className="panel h-44 motion-safe:animate-pulse" key={item}>
            <div className="m-6 h-4 w-2/3 rounded-full bg-muted" />
            <div className="m-6 h-3 w-1/2 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
