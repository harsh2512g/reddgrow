import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorState, LoadingSkeleton } from '@threadsignal/ui';
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
  unstable_rethrow: () => undefined,
}));

import { AppShell } from '../src/components/app-shell';

describe('workspace interface', () => {
  it('provides current navigation, a skip destination, and authenticated identity', () => {
    render(
      <AppShell
        organizations={[{ id: 'org-1', name: 'Test workspace', role: 'owner' }]}
        activeOrganizationId="org-1"
        user={{ email: 'owner@example.test' }}
        switchAction={async () => ({ status: 'success', message: 'Switched' })}
        logoutAction={async () => ({ status: 'success', message: 'Signed out' })}
      >
        <h1>Workspace content</h1>
      </AppShell>,
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('navigation', { name: 'Workspace navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Open user menu')).toBeInTheDocument();
  });

  it('lets a user retry an error without exposing the internal exception', async () => {
    const retry = vi.fn();
    render(<ErrorState onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load this page');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('gives a loading skeleton a readable status', () => {
    render(<LoadingSkeleton label="Loading workspace" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace');
  });
});
