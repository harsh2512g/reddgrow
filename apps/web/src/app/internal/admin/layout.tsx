import Link from 'next/link';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/wordmark';
import { adminPageSession } from '@/lib/phase8/admin';
export const dynamic = 'force-dynamic';
export default async function OperationsLayout({ children }: { children: ReactNode }) {
  await adminPageSession();
  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="border-b border-border bg-white px-5 py-5 sm:px-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5">
          <Wordmark />
          <nav
            aria-label="Platform operations"
            className="flex flex-wrap gap-5 text-sm font-medium"
          >
            <Link href="/internal/admin">Overview</Link>
            <Link href="/internal/admin/jobs">Jobs</Link>
            <Link href="/internal/admin/providers">Providers</Link>
            <Link href="/app" className="text-primary">
              Back to workspace
            </Link>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-5 py-8 sm:px-10">
        {children}
      </main>
      <footer className="mx-auto max-w-7xl px-5 py-6 text-xs text-muted-foreground sm:px-10">
        Restricted operations · Supabase-backed · Customer content stays private
      </footer>
    </div>
  );
}
