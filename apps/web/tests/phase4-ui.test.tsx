import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftStudio } from '../src/components/phase4/studio';
import { EvidencePanel, ClaimHighlights, safeSourceUrl } from '../src/components/phase4/evidence';
import { GenerateDraftButton, LocalDraftsNotice } from '../src/components/phase4/primitives';
import { approvalAvailable } from '../src/lib/phase4/schema';
import { draftFixture, phase4Ids } from './phase4-fixture';
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
let request: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  request = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', request);
});
describe('draft evidence studio', () => {
  it('opens tracking for the exact approved draft and disables it after unsaved edits', () => {
    const detail = draftFixture();
    detail.draft.status = 'approved';
    render(<DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct />);
    expect(screen.getByRole('link', { name: 'Create tracked link' })).toHaveAttribute(
      'href',
      `/app/tracking?brandId=${detail.draft.brand_id}&draftId=${detail.draft.id}`,
    );
    fireEvent.change(screen.getByLabelText('Editable draft'), {
      target: { value: detail.draft.current_content + ' Unsaved edit.' },
    });
    expect(screen.queryByRole('link', { name: 'Create tracked link' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create tracked link' })).toBeDisabled();
  });

  it('renders verified provenance and every independent check', () => {
    const detail = draftFixture();
    render(<DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct />);
    expect(screen.getByLabelText('Editable draft')).toHaveValue(detail.draft.current_content);
    expect(screen.getByText('Batch guide')).toBeInTheDocument();
    expect(screen.getAllByText('pass')).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Approve version 1' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: /^(submit|publish to Reddit)$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark published manually' })).toBeDisabled();
  });
  it('blocks approval immediately after an edit and never enables viewer mutations', () => {
    const detail = draftFixture();
    const view = render(
      <DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct />,
    );
    fireEvent.change(screen.getByLabelText('Editable draft'), {
      target: { value: detail.draft.current_content + ' New unsupported claim.' },
    });
    expect(screen.getByRole('button', { name: 'Approve version 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Regenerate draft' })).toBeDisabled();
    view.unmount();
    render(<DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct={false} />);
    expect(screen.getByLabelText('Editable draft')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Approve version/ })).not.toBeInTheDocument();
  });
  it('requires warning acknowledgement and fresh context', () => {
    const detail = draftFixture();
    detail.draft.status = 'warning';
    detail.draft.compliance_status = 'warning';
    render(<DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct />);
    const approve = screen.getByRole('button', { name: 'Approve version 1' });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the warnings/ }));
    expect(approve).toBeEnabled();
    expect(
      approvalAvailable({ ...detail, review: { ...detail.review, context_current: false } }, false),
    ).toBe(false);
  });
  it('cancels supported Back/Forward traversal while edits are unsaved without rewriting history', () => {
    const browserNavigation = new EventTarget();
    vi.stubGlobal('navigation', browserNavigation);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const detail = draftFixture();
    const view = render(
      <DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct />,
    );
    fireEvent.change(screen.getByLabelText('Editable draft'), {
      target: { value: 'Unsaved review' },
    });
    const traverse = (cancelable = true) =>
      Object.assign(new Event('navigate', { cancelable }), {
        navigationType: 'traverse',
        destination: { sameDocument: true },
        hashChange: false,
      });
    const blocked = traverse();
    browserNavigation.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(screen.getByLabelText('Editable draft')).toHaveValue('Unsaved review');
    expect(confirm).toHaveBeenCalledOnce();
    const noncancelable = traverse(false);
    browserNavigation.dispatchEvent(noncancelable);
    expect(noncancelable.defaultPrevented).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockReturnValue(true);
    const allowed = traverse();
    browserNavigation.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    view.unmount();
    browserNavigation.dispatchEvent(traverse());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });
  it('retains typing during a save and uses the next version for the next save', async () => {
    const detail = draftFixture();
    let finish: ((value: Response) => void) | undefined;
    request
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            ...detail,
            draft: {
              ...detail.draft,
              current_content: 'First edit',
              current_version: 2,
              verified_version: null,
              status: 'editing',
            },
            review: { ...detail.review, context_current: false },
          },
        }),
      );
    render(<DraftStudio initial={detail} organizationId={phase4Ids.organization} canAct />);
    fireEvent.change(screen.getByLabelText('Editable draft'), { target: { value: 'First edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save now' }));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Editable draft'), {
      target: { value: 'Second edit while saving' },
    });
    finish?.(Response.json({ data: { version: 2 } }));
    await waitFor(() =>
      expect(screen.getByLabelText('Editable draft')).toHaveValue('Second edit while saving'),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save now' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Approve version 2' })).toBeDisabled();
    const firstBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(firstBody).toEqual({ expectedVersion: 1, content: 'First edit' });
  });
  it('shows unsupported highlights and never trusts unsafe provenance URLs', () => {
    const detail = draftFixture();
    detail.claims[0]!.status = 'unsupported';
    detail.claims[0]!.evidence_kind = 'none';
    detail.claims[0]!.provenance[0]!.source_url = 'javascript:alert(1)';
    render(
      <>
        <ClaimHighlights text={detail.draft.current_content} claims={detail.claims} />
        <EvidencePanel claims={detail.claims} stale={false} />
      </>,
    );
    expect(document.querySelector('mark')).toHaveTextContent(
      'ClarityScale supports batch processing.',
    );
    expect(screen.queryByRole('link', { name: 'Source URL ↗' })).not.toBeInTheDocument();
    expect(safeSourceUrl('https://user:password@example.com')).toBeNull();
    expect(approvalAvailable(detail, false)).toBe(false);
  });
  it('creates one versioned request from an opportunity and navigates to its real draft', async () => {
    request.mockResolvedValueOnce(Response.json({ data: { id: phase4Ids.draft } }));
    render(
      <GenerateDraftButton
        opportunityId={phase4Ids.opportunity}
        organizationId={phase4Ids.organization}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }));
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(`/app/drafts/${phase4Ids.draft}`),
    );
    expect(
      new Headers(request.mock.calls[0]?.[1]?.headers).get('X-ThreadSignal-Organization'),
    ).toBe(phase4Ids.organization);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({ options: {} });
  });
  it('links hosted visitors to local drafts without shared-session claims', () => {
    render(<LocalDraftsNotice />);
    expect(screen.getByRole('link', { name: 'Continue to local Drafts' })).toHaveAttribute(
      'href',
      'http://127.0.0.1:3000/app/drafts',
    );
    expect(screen.getByText(/Hosted sign-in and data remain separate/)).toBeInTheDocument();
  });
});
