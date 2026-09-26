import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/app/opportunities/old-detail',
  useSearchParams: () => new URLSearchParams('brandId=first&cursor=old'),
}));
import { WorkspaceToolbar } from '../src/components/workspace-toolbar';
const tools = {
  brands: [
    { id: 'first', name: 'First product', status: 'active' as const },
    { id: 'second', name: 'Second product', status: 'active' as const },
  ],
  draftUsage: { used: 4, limit: 10 },
  knowledgeEnabled: true,
  commands: [
    { href: '/app/knowledge', label: 'Knowledge' },
    { href: '/app/settings/billing', label: 'Plan & usage' },
  ],
};
beforeEach(() => {
  mocks.push.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('workspace toolbar', () => {
  it('switches authorized brands without carrying stale detail identities', async () => {
    render(<WorkspaceToolbar {...tools} />);
    await userEvent.selectOptions(screen.getByLabelText('Current brand'), 'second');
    expect(mocks.push).toHaveBeenCalledWith('/app/opportunities?brandId=second');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '4');
  });
  it('honors the unsaved-draft navigation guard', async () => {
    const listener = (event: Event) => event.preventDefault();
    window.addEventListener('threadsignal:before-navigation', listener);
    try {
      render(<WorkspaceToolbar {...tools} />);
      await userEvent.selectOptions(screen.getByLabelText('Current brand'), 'second');
      expect(mocks.push).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('threadsignal:before-navigation', listener);
    }
  });
  it('offers keyboard page search with an explicit empty state', async () => {
    render(<WorkspaceToolbar {...tools} />);
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Search pages')).toHaveFocus();
    await userEvent.type(screen.getByLabelText('Search pages'), 'knowledge');
    expect(screen.getByRole('link', { name: 'Knowledge' })).toHaveAttribute(
      'href',
      '/app/knowledge',
    );
    await userEvent.clear(screen.getByLabelText('Search pages'));
    await userEvent.type(screen.getByLabelText('Search pages'), 'nothing matches');
    expect(screen.getByText('No pages match. Try another name.')).toBeVisible();
  });
});
