import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ExtensionConnectionsPanel,
  type ExtensionSession,
} from '../src/components/phase5/connections';
import { DraftHandoff } from '../src/components/phase5/handoff';
import { draftFixture, phase4Ids } from './phase4-fixture';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const initial = {
  organizationId: phase4Ids.organization,
  userId,
  role: 'member' as const,
  enabled: true,
  initialSessions: [],
  extensionId,
};
function session(overrides: Partial<ExtensionSession> = {}): ExtensionSession {
  return {
    id: sessionId,
    user_id: userId,
    name: 'My Chrome',
    created_at: '2026-09-17T00:00:00Z',
    last_used_at: null,
    expires_at: '2099-10-17T00:00:00Z',
    revoked_at: null,
    ...overrides,
  };
}
function approvedDraft() {
  const detail = draftFixture();
  detail.draft.status = 'approved';
  detail.draft.approved_at = '2026-09-17T00:00:00Z';
  detail.opportunity.post.permalink = 'https://www.reddit.com/r/SaaS/comments/abc123/a_discussion/';
  return detail;
}
let request: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
});
afterEach(() => vi.useRealTimers());

describe('Chrome extension connections', () => {
  it('creates a workspace-bound code only after a click and copies it only on request', async () => {
    const code = 'synthetic-one-time-connection-code';
    request.mockResolvedValueOnce(
      Response.json({ data: { code, expiresAt: new Date(Date.now() + 120000).toISOString() } }),
    );
    const clipboard = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboard },
      configurable: true,
    });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<ExtensionConnectionsPanel {...initial} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText('No connected browsers yet.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Browser name'), {
      target: { value: 'Personal laptop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect Chrome extension' }));
    await waitFor(() =>
      expect(screen.getByLabelText('One-time connection code')).toHaveValue(code),
    );
    expect(clipboard).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(request.mock.calls[0]?.[0]).toBe('/api/extension/connection-code');
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get('X-ThreadSignal-Organization'),
    ).toBe(phase4Ids.organization);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      name: 'Personal laptop',
    });
    expect(request.mock.calls[0]?.[1]?.cache).toBe('no-store');
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledExactlyOnceWith(code));
    fireEvent.click(screen.getByRole('button', { name: 'Hide code' }));
    expect(screen.queryByLabelText('One-time connection code')).not.toBeInTheDocument();
  });
  it('erases expired codes and permits a fresh connection attempt', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(
      Response.json({
        data: {
          code: 'synthetic-expiring-code',
          expiresAt: new Date(Date.now() + 2000).toISOString(),
        },
      }),
    );
    render(<ExtensionConnectionsPanel {...initial} />);
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Connect Chrome extension' })),
    );
    expect(screen.getByLabelText('One-time connection code')).toHaveValue(
      'synthetic-expiring-code',
    );
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByLabelText('One-time connection code')).not.toBeInTheDocument();
    expect(screen.getByText(/The connection code expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Chrome extension' })).toBeEnabled();
  });
  it('shows server failures without creating a code or persisting credentials', async () => {
    request.mockResolvedValueOnce(
      Response.json(
        {
          error: { code: 'RATE_LIMITED', message: 'Wait before creating another connection code.' },
        },
        { status: 429 },
      ),
    );
    render(<ExtensionConnectionsPanel {...initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Chrome extension' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wait before creating another connection code.',
    );
    expect(screen.queryByLabelText('One-time connection code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect Chrome extension' })).toBeEnabled();
  });
  it('requires confirmation before revoking an individual connection and refreshes its status', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    request
      .mockResolvedValueOnce(Response.json({ data: { revoked: 1 } }))
      .mockResolvedValueOnce(
        Response.json({ data: { sessions: [session({ revoked_at: '2026-09-17T01:00:00Z' })] } }),
      );
    render(<ExtensionConnectionsPanel {...initial} initialSessions={[session()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke My Chrome' }));
    expect(request).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke My Chrome' }));
    await waitFor(() => expect(screen.getByText('Revoked')).toBeInTheDocument());
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ sessionId });
    expect(screen.queryByRole('button', { name: 'Revoke My Chrome' })).not.toBeInTheDocument();
  });
  it('scopes member revocation to their own sessions and gives admins workspace-wide controls', async () => {
    const view = render(
      <ExtensionConnectionsPanel
        {...initial}
        initialSessions={[session({ user_id: otherUserId })]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Revoke My Chrome' })).not.toBeInTheDocument();
    view.unmount();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    request
      .mockResolvedValueOnce(Response.json({ data: { revoked: 1 } }))
      .mockResolvedValueOnce(Response.json({ data: { sessions: [] } }));
    render(
      <ExtensionConnectionsPanel
        {...initial}
        role="admin"
        initialSessions={[session({ user_id: otherUserId })]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Revoke My Chrome' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke all workspace connections' }));
    await waitFor(() => expect(screen.getByText('No connected browsers yet.')).toBeInTheDocument());
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ all: true });
  });
  it('never exposes mutation controls to viewers and keeps hosted connections separate', () => {
    const view = render(
      <ExtensionConnectionsPanel {...initial} role="viewer" initialSessions={[session()]} />,
    );
    expect(
      screen.queryByRole('button', { name: 'Connect Chrome extension' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Your viewer role/)).toBeInTheDocument();
    view.unmount();
    render(<ExtensionConnectionsPanel {...initial} enabled={false} />);
    expect(screen.getByRole('link', { name: 'Open local Integrations' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:3000/app/settings/integrations',
    );
    expect(
      screen.queryByRole('button', { name: 'Connect Chrome extension' }),
    ).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('approved draft manual handoff', () => {
  it('opens legacy mock permalinks in the local fixture using the actual provider identity', () => {
    const detail = approvedDraft();
    detail.opportunity.post.permalink = 'https://www.reddit.com/r/SaaS/comments/fixture001';
    detail.draft.published_at = '2026-09-17T00:20:00Z';
    detail.draft.published_version = 1;
    detail.draft.published_comment_url =
      'https://www.reddit.com/r/saas/comments/fixture_001/thread/abc123/';
    render(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct
        disabled={false}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open mock discussion' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:3000/extension-fixture/reddit/r/saas/comments/fixture_001/fixture',
    );
    expect(screen.queryByRole('link', { name: 'Open Reddit discussion' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View local practice discussion ↗' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:3000/extension-fixture/reddit/r/saas/comments/fixture_001/fixture',
    );
    expect(screen.queryByRole('link', { name: 'View recorded comment ↗' })).not.toBeInTheDocument();
    expect(screen.getByText(/not a live Reddit discussion/)).toBeInTheDocument();
  });
  it('offers a safe Reddit link for current approvals and disables use for dirty or stale drafts', () => {
    const detail = approvedDraft();
    const view = render(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct
        disabled={false}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open Reddit discussion' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/saas/comments/abc123/thread/',
    );
    expect(screen.getByRole('link', { name: 'Open Reddit discussion' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(request).not.toHaveBeenCalled();
    view.rerender(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct
        disabled
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Open Reddit discussion' })).not.toBeInTheDocument();
    detail.review.context_current = false;
    view.rerender(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct
        disabled={false}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText(/Approve the current saved version/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Reddit discussion' })).not.toBeInTheDocument();
  });
  it('requires explicit publication confirmation and a comment link for the matching thread', async () => {
    const detail = approvedDraft();
    const updated = vi.fn().mockResolvedValue(undefined);
    request.mockResolvedValueOnce(Response.json({ data: { version: 1 } }));
    render(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct
        disabled={false}
        onUpdated={updated}
      />,
    );
    fireEvent.click(screen.getByText('Already published it yourself?'));
    const submit = screen.getByRole('button', { name: 'Mark published manually' });
    fireEvent.change(screen.getByLabelText('Resulting Reddit comment URL'), {
      target: { value: 'https://www.reddit.com/r/SaaS/comments/abc123/topic/def456/' },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I personally submitted/ }));
    fireEvent.change(screen.getByLabelText('Resulting Reddit comment URL'), {
      target: { value: 'https://www.reddit.com/r/SaaS/comments/other99/topic/def456/' },
    });
    fireEvent.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter the full Reddit comment URL from this discussion',
    );
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Resulting Reddit comment URL'), {
      target: {
        value: 'https://www.reddit.com/r/SaaS/comments/abc123/topic/def456/?utm_source=share',
      },
    });
    fireEvent.click(submit);
    await waitFor(() => expect(updated).toHaveBeenCalledOnce());
    expect(request.mock.calls[0]?.[0]).toBe(`/api/drafts/${phase4Ids.draft}/mark-published`);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: 1,
      confirmed: true,
      commentUrl: 'https://www.reddit.com/r/saas/comments/abc123/thread/def456/',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Recorded as published manually');
  });
  it('records insertion and self-reported publication separately from approval', () => {
    const detail = approvedDraft();
    detail.draft.inserted_at = '2026-09-17T00:10:00Z';
    detail.draft.inserted_version = 1;
    detail.draft.published_at = '2026-09-17T00:20:00Z';
    detail.draft.published_version = 1;
    detail.draft.published_comment_url =
      'https://www.reddit.com/r/saas/comments/abc123/topic/def456/';
    render(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct
        disabled={false}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('Inserted into composer')).toBeInTheDocument();
    expect(screen.getByText('Published manually')).toBeInTheDocument();
    expect(screen.getByText(/has not independently verified/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View recorded comment ↗' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/saas/comments/abc123/thread/def456/',
    );
    expect(screen.queryByText('Already published it yourself?')).not.toBeInTheDocument();
    expect(detail.draft.status).toBe('approved');
  });
  it('renders viewer history without publication controls and ignores unsafe links', () => {
    const detail = approvedDraft();
    detail.opportunity.post.permalink = 'javascript:alert(1)';
    detail.draft.published_comment_url =
      'https://reddit.com.evil.example/r/saas/comments/abc123/topic/def456/';
    render(
      <DraftHandoff
        detail={detail}
        organizationId={phase4Ids.organization}
        canAct={false}
        disabled={false}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.queryByRole('link', { name: 'Open Reddit discussion' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View recorded comment ↗' })).not.toBeInTheDocument();
    expect(screen.queryByText('Already published it yourself?')).not.toBeInTheDocument();
  });
});
