import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/phase2/api', () => ({
  knowledgeRequest: mocks.request,
  requestMessage: () => 'Please retry this operation.',
}));
import { PrivacyControls } from '../src/components/phase8/privacy';
import { JobsConsole, ProviderConfiguration } from '../src/components/phase8/operations';

const org = '80000000-0000-4000-8000-000000000001';
const id = '80000000-0000-4000-8000-000000000002';
const at = '2026-09-19T12:00:00Z';
const completedExport = {
  id,
  kind: 'export',
  status: 'completed',
  created_at: at,
  completed_at: at,
  confirmed_at: at,
  expires_at: '2026-09-20T12:00:00Z',
  download_available: true,
  error_code: null,
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ id });
});
describe('Privacy confirmation and recoverable UI', () => {
  it('never exposes owner controls to nonowners', () => {
    render(
      <PrivacyControls initial={[]} organizationId={org} slug="demo-workspace" canManage={false} />,
    );
    expect(screen.getByText(/Ask the workspace owner/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create private export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review deletion' })).not.toBeInTheDocument();
  });
  it('requires both exact slug and explicit acknowledgement before deletion', async () => {
    const user = userEvent.setup();
    render(<PrivacyControls initial={[]} organizationId={org} slug="demo-workspace" canManage />);
    await user.click(screen.getByRole('button', { name: 'Review deletion' }));
    const confirm = screen.getByRole('button', { name: 'Permanently delete organization' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Type demo-workspace to confirm'), 'wrong-workspace');
    await user.click(screen.getByRole('checkbox'));
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText('Type demo-workspace to confirm'));
    await user.type(screen.getByLabelText('Type demo-workspace to confirm'), 'demo-workspace');
    expect(confirm).toBeEnabled();
    expect(mocks.request).not.toHaveBeenCalled();
    await user.click(confirm);
    expect(mocks.request).toHaveBeenCalledWith(
      '/api/privacy/requests',
      expect.anything(),
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-threadsignal-organization': org },
        body: JSON.stringify({
          kind: 'deletion',
          organizationId: org,
          confirmation: 'demo-workspace',
        }),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Organization deletion is underway.' }),
    ).toBeVisible();
  });
  it('clears destructive confirmation when canceled and sends no request', async () => {
    const user = userEvent.setup();
    render(<PrivacyControls initial={[]} organizationId={org} slug="demo-workspace" canManage />);
    await user.click(screen.getByRole('button', { name: 'Review deletion' }));
    await user.type(screen.getByLabelText('Type demo-workspace to confirm'), 'demo-workspace');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Keep organization' }));
    await user.click(screen.getByRole('button', { name: 'Review deletion' }));
    expect(screen.getByLabelText('Type demo-workspace to confirm')).toHaveValue('');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('shows the download only for an available export and explains legacy requests', () => {
    render(
      <PrivacyControls
        initial={[
          completedExport,
          {
            id: org,
            kind: 'delete',
            status: 'requested',
            created_at: at,
            completed_at: null,
            confirmed_at: null,
            expires_at: null,
            download_available: false,
            error_code: null,
          },
        ]}
        organizationId={org}
        slug="demo-workspace"
        canManage
      />,
    );
    expect(screen.getByRole('link', { name: 'Download export' })).toHaveAttribute(
      'href',
      `/api/privacy/requests/${id}/download`,
    );
    expect(screen.getByText(/Recorded for review; not scheduled/)).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Revoke export' })).toHaveLength(1);
  });
  it('keeps actions recoverable after a failed export request', async () => {
    mocks.request.mockRejectedValue(new Error('privateproviderpayload'));
    const user = userEvent.setup();
    render(<PrivacyControls initial={[]} organizationId={org} slug="demo-workspace" canManage />);
    await user.click(screen.getByRole('button', { name: 'Create private export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please retry this operation.');
    expect(screen.queryByText('privateproviderpayload')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create private export' })).toBeEnabled();
  });
  it('preserves a failed refresh after creating an export without asking to create it again', async () => {
    mocks.request
      .mockResolvedValueOnce({ id })
      .mockRejectedValueOnce(new Error('privaterefreshpayload'))
      .mockResolvedValueOnce([
        { ...completedExport, status: 'requested', download_available: false },
      ]);
    const user = userEvent.setup();
    render(<PrivacyControls initial={[]} organizationId={org} slug="demo-workspace" canManage />);
    await user.click(screen.getByRole('button', { name: 'Create private export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your private export is queued, but the request list could not be refreshed.',
    );
    expect(screen.queryByText('privaterefreshpayload')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh requests' }));
    expect(await screen.findByText('Export · requested')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.filter((call) => call[2]?.method === 'POST')).toHaveLength(1);
  });
  it('removes revoked export controls even when the following refresh fails', async () => {
    mocks.request
      .mockResolvedValueOnce({ id })
      .mockRejectedValueOnce(new Error('privaterefreshpayload'));
    const user = userEvent.setup();
    render(
      <PrivacyControls
        initial={[completedExport]}
        organizationId={org}
        slug="demo-workspace"
        canManage
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Revoke export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The export is revoked, but the request list could not be refreshed.',
    );
    expect(screen.getByText('Export · revoked')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Download export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh requests' })).toBeEnabled();
  });
  it('clears request data and destructive confirmation when the selected workspace changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PrivacyControls
        initial={[completedExport]}
        organizationId={org}
        slug="demo-workspace"
        canManage
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Review deletion' }));
    await user.type(screen.getByLabelText('Type demo-workspace to confirm'), 'demo-workspace');
    await user.click(screen.getByRole('checkbox'));
    rerender(<PrivacyControls initial={[]} organizationId={id} slug="other-workspace" canManage />);
    expect(screen.getByText('No data requests yet.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Download export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review deletion' }));
    expect(screen.getByLabelText('Type other-workspace to confirm')).toHaveValue('');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Permanently delete organization' })).toBeDisabled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not carry the deletion outcome into another workspace', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PrivacyControls initial={[]} organizationId={org} slug="demo-workspace" canManage />,
    );
    await user.click(screen.getByRole('button', { name: 'Review deletion' }));
    await user.type(screen.getByLabelText('Type demo-workspace to confirm'), 'demo-workspace');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Permanently delete organization' }));
    expect(
      await screen.findByRole('heading', { name: 'Organization deletion is underway.' }),
    ).toBeVisible();
    rerender(
      <PrivacyControls
        initial={[completedExport]}
        organizationId={id}
        slug="other-workspace"
        canManage
      />,
    );
    expect(
      screen.queryByRole('heading', { name: 'Organization deletion is underway.' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create private export' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Download export' })).toBeVisible();
  });
});
describe('Operations controls', () => {
  it('requires explicit retry confirmation and preserves the same key after a request failure', async () => {
    const user = userEvent.setup();
    mocks.request.mockRejectedValue(new Error('providerprivatefailure'));
    render(
      <JobsConsole
        initial={{
          items: [
            {
              id,
              family: 'knowledge',
              kind: 'ingest',
              organization_id: org,
              status: 'failed',
              attempts: 3,
              error_code: 'PROCESSING_FAILED',
              created_at: at,
              updated_at: at,
              available_at: at,
              retry_available: true,
            },
          ],
          next_cursor: null,
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Review retry' }));
    expect(mocks.request).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm retry' }));
    await screen.findByRole('alert');
    const first = mocks.request.mock.calls[0]![2].body;
    await user.click(screen.getByRole('button', { name: 'Confirm retry' }));
    expect(mocks.request.mock.calls[1]![2].body).toBe(first);
    expect(JSON.parse(first)).toMatchObject({ family: 'knowledge', reason: 'recovered' });
  });
  it('does not offer retries for completed jobs or claim nonexistent jobs are healthy', () => {
    render(<JobsConsole initial={{ items: [], next_cursor: null }} />);
    expect(screen.getByRole('heading', { name: 'No matching jobs.' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review retry' })).not.toBeInTheDocument();
  });
  it('labels configured adapters without asserting a successful live connection', () => {
    render(
      <ProviderConfiguration
        providers={[
          { name: 'Reddit', adapter: 'mock', external_enabled: false },
          { name: 'AI', adapter: 'mock', external_enabled: false },
          { name: 'Crawler', adapter: 'fixture', external_enabled: false },
          { name: 'Email', adapter: 'console', external_enabled: false },
          { name: 'Billing', adapter: 'mock', external_enabled: false },
        ]}
      />,
    );
    expect(screen.getByText(/not external availability checks/)).toBeVisible();
    const billing = screen.getByText('Billing').closest('section')!;
    expect(within(billing).getByText(/External calls disabled/)).toBeVisible();
  });
});
