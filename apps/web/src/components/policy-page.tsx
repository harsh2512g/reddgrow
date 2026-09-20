import type { ReactNode } from 'react';
import { MarketingFooter, MarketingHeader } from './marketing-layout';

export function PolicyPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <MarketingHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <p className="eyebrow">Local development notice</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">{title}</h1>
        <p className="mt-5 text-sm leading-8 text-muted-foreground">{description}</p>
        <p className="my-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-warning">
          Draft for the local development preview. This document requires owner and legal review
          before a public launch.
        </p>
        <div className="space-y-7 text-sm leading-8 text-muted-foreground [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground">
          {children}
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
