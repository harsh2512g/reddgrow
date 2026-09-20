import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ServiceStatus } from '../src/components/service-status';

const requestId = '8d88231a-11a5-4b0a-bfb3-3f2cbfe5203a';

describe('service status', () => {
  it('reports dependency failure and recovers after an explicit retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'unavailable',
            checks: { database: 'unconfigured', redis: 'unavailable' },
            requestId,
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ready',
            checks: { database: 'ready', redis: 'ready' },
            requestId,
          }),
        ),
      );
    vi.stubGlobal('fetch', fetcher);
    render(<ServiceStatus />);
    expect(await screen.findByText('Local services need attention')).toBeVisible();
    expect(screen.getByText('Not configured')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('All local dependencies are ready')).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed responses without displaying their contents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ secret: 'must-not-render' }))),
    );
    render(<ServiceStatus />);
    expect(await screen.findByText(/The service check could not finish/)).toBeVisible();
    expect(screen.queryByText('must-not-render')).not.toBeInTheDocument();
  });

  it('announces a pending check and disables duplicate requests', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));
    render(<ServiceStatus />);
    expect(screen.getByText('Checking local services…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled();
  });
});
