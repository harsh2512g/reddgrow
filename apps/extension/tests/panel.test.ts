import { describe, expect, it, vi } from 'vitest';
import { configurePanel } from '../src/background/configure-panel';

describe('extension action', () => {
  it('opens only its own side panel after a person clicks the toolbar action', async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    await configurePanel({ setPanelBehavior });
    expect(setPanelBehavior).toHaveBeenCalledExactlyOnceWith({ openPanelOnActionClick: true });
  });

  it('propagates a failed panel configuration so the entrypoint can report a retry action', async () => {
    await expect(
      configurePanel({ setPanelBehavior: () => Promise.reject(new Error('unavailable')) }),
    ).rejects.toThrow('unavailable');
  });
});
