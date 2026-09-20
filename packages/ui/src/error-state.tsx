'use client';

import { Button } from './button.js';

export function ErrorState({
  title = 'We couldn’t load this page',
  description = 'Please try again. If this keeps happening, return to the overview.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-border bg-white px-6 py-12 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      <Button type="button" className="mt-6" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
