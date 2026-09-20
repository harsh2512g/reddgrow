import { describe, expect, it } from 'vitest';
import { parseAuthBody } from '../src/lib/auth/http';
import { magicLinkInputSchema } from '../src/lib/auth/policy';

describe('bounded auth request parsing', () => {
  const url = 'http://127.0.0.1:3000/api/auth/magic-link';
  it('validates JSON and optional native form payloads', async () => {
    expect(
      await parseAuthBody(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'fixture@example.com' }),
        }),
        magicLinkInputSchema,
      ),
    ).toEqual({ email: 'fixture@example.com' });
    expect(
      await parseAuthBody(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'email=fixture%40example.com',
        }),
        magicLinkInputSchema,
        true,
      ),
    ).toEqual({ email: 'fixture@example.com' });
  });
  it('enforces actual size when Content-Length is missing', async () => {
    await expect(
      parseAuthBody(
        new Request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'x'.repeat(5000),
        }),
        magicLinkInputSchema,
      ),
    ).rejects.toThrow('Enter a valid email');
  });
  it('rejects malformed JSON and unaccepted content types without echoing the payload', async () => {
    for (const type of ['text/plain', 'application/json']) {
      await expect(
        parseAuthBody(
          new Request(url, {
            method: 'POST',
            headers: { 'Content-Type': type },
            body: 'synthetic-sensitive-input',
          }),
          magicLinkInputSchema,
        ),
      ).rejects.toThrow('Enter a valid email');
    }
  });
});
