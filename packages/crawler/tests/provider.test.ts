import { describe, expect, it, vi } from 'vitest';
import { createCrawlerProvider, discoverFixturePages, normalizeApprovedUrl } from '../src/index.js';

describe('fixture crawler boundary', () => {
  it('returns deterministic fixture content without invoking fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const provider = createCrawlerProvider();
      const request = {
        url: 'https://clarityscale.example/docs',
        approvedDomains: ['clarityscale.example'],
      };
      expect(await provider.fetchPage(request)).toEqual(await provider.fetchPage(request));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it.each([
    'http://127.0.0.1',
    'https://169.254.169.254',
    'file:///etc/passwd',
    'https://clarityscale.example.evil.example/docs',
    'https://user:pass@clarityscale.example/docs',
    'https://clarityscale.example/unknown',
  ])('fails closed for an unregistered target %s', async (url) => {
    await expect(
      createCrawlerProvider().fetchPage({ url, approvedDomains: ['clarityscale.example'] }),
    ).rejects.toThrow();
  });

  it('refuses every network provider', () => {
    expect(() => createCrawlerProvider('simple')).toThrow('not enabled in Phase 0');
    expect(() => createCrawlerProvider('firecrawl')).toThrow('not enabled in Phase 0');
  });

  it('discovers only the approved demo and collapses URL variants', () => {
    expect(discoverFixturePages('https://clarityscale.example')).toHaveLength(6);
    expect(discoverFixturePages('https://unknown.example')).toEqual([]);
    expect(
      normalizeApprovedUrl('https://clarityscale.example/docs/?utm=test#section', [
        'clarityscale.example',
      ]),
    ).toBe('https://clarityscale.example/docs');
  });
  it.each([
    'https://[::1]/',
    'https://2130706433/',
    'https://127.1/',
    'https://0x7f000001/',
    'https://localhost/',
    'https://host.internal/',
    'https://clarityscale.example/login',
    'https://clarityscale.example/logo.png',
  ])('blocks unsafe targets before any network %s', async (url) => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(
        createCrawlerProvider().fetchPage({ url, approvedDomains: [new URL(url).hostname] }),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
