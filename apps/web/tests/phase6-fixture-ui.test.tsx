import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingFixture } from '../src/components/phase6/tracking-fixture';
import { p6ids } from './phase6-fixture';
const script = vi.hoisted(() => ({ ready: undefined as (() => void) | undefined }));
vi.mock('next/script', () => ({
  default: (props: { onReady?: () => void }) => {
    script.ready = props.onReady;
    return null;
  },
}));
const client = { init: vi.fn(), setConsent: vi.fn(), track: vi.fn() };
beforeEach(() => {
  client.init.mockReset();
  client.track.mockReset();
  client.setConsent.mockReset().mockImplementation((consent: boolean) => consent);
  vi.stubGlobal('threadSignal', client);
});
function mount() {
  render(
    <TrackingFixture
      brandId={p6ids.brand}
      attributionDays={14}
      apiOrigin="http://127.0.0.1:3000"
    />,
  );
  act(() => script.ready?.());
}
describe('explicit local attribution fixture actions', () => {
  it('initializes the real snippet contract with consent off and does not send an event on load', () => {
    mount();
    expect(client.init).toHaveBeenCalledWith({
      brandId: p6ids.brand,
      endpoint: 'http://127.0.0.1:3000/api/v1/browser-events',
      consent: false,
      cookieDays: 14,
    });
    expect(client.track).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Record demo signup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record demo purchase' })).toBeDisabled();
  });
  it('respects a rejected privacy signal even after a user checks the consent box', () => {
    client.setConsent.mockReturnValue(false);
    mount();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('browser privacy signal');
    expect(client.track).not.toHaveBeenCalled();
  });
  it('records only explicit actions and repeats the exact purchase identity', async () => {
    client.track
      .mockResolvedValueOnce({ status: 'sent' })
      .mockResolvedValueOnce({ status: 'duplicate' });
    mount();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(client.track).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Record demo purchase' }));
    await screen.findByRole('button', { name: 'Repeat the same demo purchase' });
    expect(client.track.mock.calls[0]?.[0]).toBe('purchase');
    expect(client.track.mock.calls[0]?.[1]).toMatchObject({ value: 99, currency: 'USD' });
    fireEvent.click(screen.getByRole('button', { name: 'Repeat the same demo purchase' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('No duplicate was added'),
    );
    expect(client.track.mock.calls[1]).toEqual(client.track.mock.calls[0]);
  });
  it('withdraws consent and disables further UI events', () => {
    mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(client.setConsent).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Record demo signup' })).toBeDisabled();
    expect(client.track).not.toHaveBeenCalled();
  });
  it('shows a refused event without claiming success or enabling a duplicate action', async () => {
    client.track.mockResolvedValue({ status: 'failed' });
    mount();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Record demo purchase' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('could not be recorded'),
    );
    expect(
      screen.queryByRole('button', { name: 'Repeat the same demo purchase' }),
    ).not.toBeInTheDocument();
  });
});
