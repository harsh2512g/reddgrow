'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Search, X } from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { brandDestination } from '@/lib/onboarding/model';

export type WorkspaceTools = {
  brands: { id: string; name: string; status: 'active' | 'archived' }[];
  draftUsage: { used: number; limit: number } | null;
  knowledgeEnabled: boolean;
};

export function WorkspaceToolbar({
  brands,
  draftUsage,
  knowledgeEnabled,
  commands,
}: WorkspaceTools & { commands: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeBrands = brands.filter((brand) => brand.status === 'active');
  const fromPath = /^\/app\/brands\/([^/]+)/.exec(pathname)?.[1];
  const selected =
    activeBrands.find((brand) => brand.id === (searchParams.get('brandId') ?? fromPath))?.id ??
    activeBrands[0]?.id ??
    '';
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  function openSearch() {
    setQuery('');
    dialog.current?.showModal();
    search.current?.focus();
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else openSearch();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const matches = commands.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-3 border-t border-border/60 py-3">
        {knowledgeEnabled && (
          <div className="min-w-0 flex-1 sm:max-w-60">
            <label htmlFor="current-brand" className="sr-only">
              Current brand
            </label>
            <select
              id="current-brand"
              className="field-input min-w-0 py-2 text-xs"
              value={selected}
              disabled={!activeBrands.length}
              onChange={(event) => {
                if (!activeBrands.some((brand) => brand.id === event.target.value)) return;
                if (
                  !window.dispatchEvent(
                    new Event('threadsignal:before-navigation', { cancelable: true }),
                  )
                )
                  return;
                router.push(brandDestination(pathname, event.target.value));
              }}
            >
              {!activeBrands.length && <option value="">Create your first brand</option>}
              {activeBrands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {draftUsage && (
          <Link
            href="/app/settings/billing"
            className="min-w-28 text-[10px] text-muted-foreground"
            title="Saved organization usage; open billing for the current period"
          >
            <span>
              {draftUsage.used} / {draftUsage.limit} AI drafts
            </span>
            <progress
              aria-label="AI draft usage"
              value={Math.min(draftUsage.used, draftUsage.limit)}
              max={Math.max(1, draftUsage.limit)}
              className="mt-1 block h-1 w-full accent-primary"
            />
          </Link>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search workspace pages"
            onClick={openSearch}
          >
            <Search size={17} />
            <span className="hidden xl:inline">Search</span>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link
              href="/app/settings/notifications"
              aria-label="Notification preferences and delivery history"
            >
              <Bell size={17} />
            </Link>
          </Button>
        </div>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="workspace-search-title"
        className="w-[min(92vw,32rem)] rounded-2xl border border-border bg-white p-5 text-foreground shadow-xl backdrop:bg-slate-950/35"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="workspace-search-title" className="font-semibold">
            Find a workspace page
          </h2>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close workspace search"
            onClick={() => dialog.current?.close()}
          >
            <X size={16} />
          </Button>
        </div>
        <label htmlFor="workspace-command-query" className="sr-only">
          Search pages
        </label>
        <input
          id="workspace-command-query"
          ref={search}
          className="field-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try knowledge, billing or setup"
        />
        <p role="status" className="my-3 text-xs text-muted-foreground">
          {matches.length} {matches.length === 1 ? 'page' : 'pages'} · use Tab to choose, Enter to
          open, Esc to close
        </p>
        <ul className="max-h-72 space-y-1 overflow-auto">
          {matches.map((command) => (
            <li key={command.href}>
              <Link
                className="block rounded-lg px-3 py-2 text-sm hover:bg-muted"
                href={command.href}
                onClick={() => dialog.current?.close()}
              >
                {command.label}
              </Link>
            </li>
          ))}
        </ul>
        {!matches.length && <p className="p-3 text-sm">No pages match. Try another name.</p>}
      </dialog>
    </>
  );
}
