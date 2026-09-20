import { describe, expect, it, vi } from 'vitest';
import { createEmailProvider } from '../src/index.js';

describe('console email provider', () => {
  it('reports suppressed delivery, stable message IDs, and no message content', async () => {
    const info = vi.fn();
    const provider = createEmailProvider('console', { info });
    const message = {
      to: 'fixture@example.com',
      subject: 'Private synthetic subject',
      text: 'Private synthetic body',
      idempotencyKey: 'fixture-001',
    };
    const result = await provider.send(message);
    expect(result).toEqual(await provider.send(message));
    expect(result.delivery).toBe('suppressed');
    const logs = JSON.stringify(info.mock.calls);
    expect(logs).not.toContain(message.to);
    expect(logs).not.toContain(message.subject);
    expect(logs).not.toContain(message.text);
  });

  it('rejects invalid recipients and external selection', async () => {
    await expect(
      createEmailProvider().send({
        to: 'invalid',
        subject: 'fixture',
        text: 'fixture',
        idempotencyKey: 'fixture',
      }),
    ).rejects.toThrow();
    expect(() => createEmailProvider('resend')).toThrow('EMAIL_CONFIGURATION');
  });
});
