import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { Wordmark } from './wordmark';

export function MarketingHeader() {
  return (
    <header className="border-b border-border bg-white/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-10">
        <Wordmark />
        <nav aria-label="Main navigation" className="flex items-center gap-6 lg:gap-9">
          <Link
            href="/#approach"
            className="hidden text-xs font-medium text-muted-foreground hover:text-primary lg:block"
          >
            The approach
          </Link>
          <Link
            href="/pricing"
            className="hidden text-xs font-medium text-muted-foreground hover:text-primary sm:block"
          >
            Pricing
          </Link>
          <Link
            href="/security"
            className="hidden text-xs font-medium text-muted-foreground hover:text-primary md:block"
          >
            Responsible use
          </Link>
          <Link href="/login" className="hidden text-xs font-semibold hover:text-primary sm:block">
            Sign in
          </Link>
          <Button asChild size="sm">
            <Link href="/login">
              Get started <ArrowRight size={14} />
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1fr_auto] lg:px-10">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-sm text-xs leading-6 text-muted-foreground">
            Good conversations start with listening.
            <br />
            ThreadSignal is independent and is not affiliated with Reddit.
          </p>
        </div>
        <nav
          aria-label="Footer navigation"
          className="flex flex-wrap items-start gap-x-6 gap-y-3 text-xs text-muted-foreground"
        >
          <Link href="/pricing" className="hover:text-primary">
            Pricing
          </Link>
          <Link href="/security" className="hover:text-primary">
            Responsible use
          </Link>
          <Link href="/privacy" className="hover:text-primary">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-primary">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
