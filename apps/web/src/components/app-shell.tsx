'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, unstable_rethrow } from 'next/navigation';
import {
  ArrowUpRight,
  Activity,
  ChartNoAxesCombined,
  Link2,
  Building2,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Plug,
  ShieldCheck,
  Shapes,
  Radio,
  Hash,
  ScanText,
  Feather,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@threadsignal/ui';
import { Wordmark } from './wordmark';
import { ResultNotice } from './phase1/primitives';
import type { ActionResult, FormAction, OrganizationOption } from './phase1/types';

const navigation = [
  { href: '/app', label: 'Overview', icon: LayoutDashboard },
  { href: '/app/brands', label: 'Brands', icon: Shapes },
  { href: '/app/knowledge', label: 'Knowledge', icon: BookOpen },
  { href: '/app/opportunities', label: 'Opportunities', icon: Radio },
  { href: '/app/drafts', label: 'Drafts', icon: Feather },
  { href: '/app/tracking', label: 'Tracking links', icon: Link2 },
  { href: '/app/analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { href: '/app/subreddits', label: 'Communities', icon: Hash },
  { href: '/app/keywords', label: 'Keywords', icon: ScanText },
  { href: '/app/activity', label: 'Activity', icon: Activity },
  { href: '/app/settings/persona', label: 'Persona & disclosure', icon: UserRound },
  { href: '/app/settings/organization', label: 'Organization', icon: Building2 },
  { href: '/app/settings/team', label: 'People & access', icon: Users },
  { href: '/app/settings/billing', label: 'Plan & usage', icon: CreditCard },
  { href: '/app/settings/notifications', label: 'Notifications', icon: Bell },
  { href: '/app/settings/integrations', label: 'Integrations', icon: Plug },
];

export type AppShellProps = {
  children: ReactNode;
  organizations: OrganizationOption[];
  activeOrganizationId: string;
  user: { email: string };
  switchAction: FormAction;
  logoutAction: FormAction;
  trialLabel?: string;
};

export function AppShell({
  children,
  organizations,
  activeOrganizationId,
  user,
  switchAction,
  logoutAction,
  trialLabel = 'Your workspace',
}: AppShellProps) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [switching, setSwitching] = useState(false);
  const active = organizations.find((organization) => organization.id === activeOrganizationId);
  const currentPage =
    navigation.find((item) => isActiveRoute(pathname, item.href))?.label ?? 'Workspace';
  const initial = (active?.name ?? 'T').charAt(0).toUpperCase();
  function closeMenu() {
    dialog.current?.close();
    setMenuOpen(false);
  }

  async function switchOrganization(id: string) {
    if (!window.dispatchEvent(new Event('threadsignal:before-navigation', { cancelable: true })))
      return;
    setSwitching(true);
    const data = new FormData();
    data.set('organizationId', id);
    try {
      setResult(await switchAction(data));
    } catch (error) {
      unstable_rethrow(error);
      setResult({
        status: 'error',
        message: 'The workspace could not be switched. Please try again.',
      });
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r border-border bg-[#fcfcfd] px-5 py-7 lg:flex">
        <div className="px-2">
          <Wordmark />
        </div>
        <div className="mt-9">
          <OrganizationPicker
            id="desktop-organization"
            initial={initial}
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            switching={switching}
            onSwitch={switchOrganization}
          />
        </div>
        <p className="mb-3 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          Your space
        </p>
        <Navigation pathname={pathname} onNavigate={closeMenu} />
        <Link
          href="/app/onboarding"
          className="mt-4 flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground hover:text-primary"
        >
          <Plus size={14} /> Create a workspace
        </Link>
        <div className="mt-auto pt-8">
          <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-[#f1effb] p-4">
            <div className="absolute -right-5 -top-6 size-20 rounded-full border border-primary/10" />
            <ShieldCheck aria-hidden="true" className="mb-3 text-primary" size={20} />
            <p className="text-xs font-semibold">A person publishes. Always.</p>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              Your voice and your judgment belong in every conversation.
            </p>
            <Link
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
              href="/security"
            >
              Our commitments <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="mt-5 flex items-center gap-2 px-2 text-[10px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-positive" /> Mock providers active
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b border-border bg-white/95 px-5 backdrop-blur-sm sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              aria-label="Open navigation"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              variant="ghost"
              className="lg:hidden"
              onClick={() => {
                dialog.current?.showModal();
                setMenuOpen(true);
              }}
            >
              <Menu size={20} />
            </Button>
            <p className="text-xs text-muted-foreground">
              <span className="hidden sm:inline">
                Workspace <span className="mx-3 text-border">/</span>
              </span>
              <span className="font-medium text-foreground">{currentPage}</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/app/settings/billing"
              className="hidden rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-primary sm:block"
            >
              {trialLabel}
            </Link>
            <details className="relative">
              <summary
                aria-label="Open user menu"
                className="flex cursor-pointer list-none items-center gap-2 rounded-lg p-1"
              >
                <span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold uppercase">
                  {user.email.charAt(0)}
                </span>
                <ChevronDown aria-hidden="true" size={13} className="text-muted-foreground" />
              </summary>
              <div className="absolute right-0 top-12 min-w-64 rounded-xl border border-border bg-white p-2 shadow-lg">
                <p className="break-all px-3 py-2 text-xs font-medium">{user.email}</p>
                <p className="px-3 pb-3 text-[11px] capitalize text-muted-foreground">
                  {active?.role ?? 'Signed in'}
                </p>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      !window.dispatchEvent(
                        new Event('threadsignal:before-navigation', { cancelable: true }),
                      )
                    )
                      return;
                    try {
                      setResult(await logoutAction(new FormData()));
                    } catch (error) {
                      unstable_rethrow(error);
                      setResult({
                        status: 'error',
                        message: 'Sign-out could not be completed. Please try again.',
                      });
                    }
                  }}
                >
                  <Button className="w-full justify-start" variant="ghost" size="sm" type="submit">
                    <LogOut size={15} /> Sign out
                  </Button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 xl:px-10 xl:py-10"
        >
          {result && (
            <div className="mb-5">
              <ResultNotice result={result} />
            </div>
          )}
          {children}
        </main>
        <footer className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 pb-7 pt-5 text-[10px] text-muted-foreground sm:px-8 xl:px-10">
          <p>ThreadSignal · Good conversations start here.</p>
          <p>Independent. Never affiliated with Reddit.</p>
        </footer>
      </div>
      <dialog
        ref={dialog}
        aria-labelledby="navigation-title"
        onClose={() => setMenuOpen(false)}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-80 max-w-[90vw] border-r border-border bg-white p-5 text-foreground backdrop:bg-slate-950/35"
      >
        <div className="mb-7 flex items-center justify-between">
          <h2 id="navigation-title" className="font-semibold">
            Your workspace
          </h2>
          <Button type="button" variant="ghost" aria-label="Close navigation" onClick={closeMenu}>
            <X size={20} />
          </Button>
        </div>
        <OrganizationPicker
          id="mobile-organization"
          initial={initial}
          organizations={organizations}
          activeOrganizationId={activeOrganizationId}
          switching={switching}
          onSwitch={switchOrganization}
        />
        <div className="mt-6">
          <Navigation mobile pathname={pathname} onNavigate={closeMenu} />
        </div>
        <Link
          href="/app/onboarding"
          onClick={closeMenu}
          className="mt-6 flex items-center gap-2 px-3 text-sm font-medium text-primary"
        >
          <Plus size={16} /> Create a workspace
        </Link>
        <p className="mt-8 px-3 text-xs leading-6 text-muted-foreground">
          Mock providers are active. Production Reddit ingestion is disabled.
        </p>
      </dialog>
    </div>
  );
}

function Navigation({
  mobile = false,
  pathname,
  onNavigate,
}: {
  mobile?: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <nav
      aria-label={mobile ? 'Mobile workspace navigation' : 'Workspace navigation'}
      className="space-y-1.5"
    >
      {navigation.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          aria-current={isActiveRoute(pathname, href) ? 'page' : undefined}
          className={`group flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] font-medium transition-colors ${isActiveRoute(pathname, href) ? 'bg-primary text-white shadow-[0_5px_12px_-8px_#5144ca]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
          {label}
          {isActiveRoute(pathname, href) && (
            <span className="ml-auto size-1.5 rounded-full bg-white/80" />
          )}
        </Link>
      ))}
    </nav>
  );
}
function isActiveRoute(pathname: string, href: string) {
  return pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`));
}
function OrganizationPicker({
  id,
  initial,
  organizations,
  activeOrganizationId,
  switching,
  onSwitch,
}: {
  id: string;
  initial: string;
  organizations: OrganizationOption[];
  activeOrganizationId: string;
  switching: boolean;
  onSwitch: (id: string) => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 text-sm font-semibold text-primary">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <label
            htmlFor={id}
            className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          >
            Workspace
          </label>
          <div className="relative">
            <select
              id={id}
              className="mt-0.5 w-full appearance-none bg-transparent pr-4 text-xs font-semibold"
              value={activeOrganizationId}
              disabled={switching || organizations.length === 0}
              onChange={(event) => void onSwitch(event.target.value)}
            >
              {organizations.length === 0 && <option value="">Create a workspace</option>}
              {organizations.map((organization) => (
                <option value={organization.id} key={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown
              aria-hidden="true"
              className="pointer-events-none absolute right-0 top-1.5 text-muted-foreground"
              size={12}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
