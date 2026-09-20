import Link from 'next/link';
import { Button } from '@threadsignal/ui';

export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12 text-center"
    >
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">This page isn’t here</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">
        The address may have changed, or this part of ThreadSignal is still being built.
      </p>
      <div className="mt-7">
        <Button asChild variant="outline">
          <Link href="/">Return home</Link>
        </Button>
      </div>
    </main>
  );
}
