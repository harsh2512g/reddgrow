import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { ProviderUnavailableError } from '@threadsignal/shared';
import { fixturePages } from './fixtures.js';
export { fixturePages } from './fixtures.js';

const fixturePageSchema = z.object({
  url: z.url(),
  title: z.string(),
  text: z.string(),
  checksum: z.string(),
});
export type CrawlerPage = z.infer<typeof fixturePageSchema>;
export interface CrawlerProvider {
  readonly mode: 'fixture' | 'simple' | 'firecrawl';
  fetchPage(input: { url: string; approvedDomains: string[] }): Promise<CrawlerPage>;
}

/** Only exact fixture targets are enabled; there is no network or DNS fallback. */
export function normalizeApprovedUrl(input: string, approvedDomains: readonly string[]) {
  const url = new URL(z.string().max(2048).parse(input));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0 ||
    !approvedDomains.includes(url.hostname) ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)
  )
    throw new Error('Crawler target is not approved.');
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  if (
    /(?:^|\/)(?:login|signin|logout|cart|checkout|account)(?:\/|$)/i.test(url.pathname) ||
    /\.(?:pdf|jpg|jpeg|png|gif|svg|zip|mp4|webp)$/i.test(url.pathname)
  )
    throw new Error('Crawler target is not a knowledge page.');
  return url.href;
}

export function discoverFixturePages(website: string) {
  const host = new URL(website).hostname;
  normalizeApprovedUrl(website, [host]);
  if (host !== 'clarityscale.example') return [];
  return fixturePages.map(({ url, title }) => ({ url, title }));
}

export class FixtureCrawlerProvider implements CrawlerProvider {
  readonly mode = 'fixture';
  async fetchPage(input: { url: string; approvedDomains: string[] }): Promise<CrawlerPage> {
    const request = z
      .object({
        url: z.string().max(2048),
        approvedDomains: z.array(z.string().max(253)).min(1).max(100),
      })
      .parse(input);
    const canonical = normalizeApprovedUrl(request.url, request.approvedDomains);
    const page = fixturePages.find((fixture) => fixture.url === canonical);
    if (!page)
      throw new Error('Only approved synthetic fixture pages are available in local mode.');
    return fixturePageSchema.parse({
      ...page,
      checksum: createHash('sha256').update(page.text).digest('hex'),
    });
  }
}
export function createCrawlerProvider(
  mode: 'fixture' | 'simple' | 'firecrawl' = 'fixture',
): CrawlerProvider {
  if (mode !== 'fixture') throw new ProviderUnavailableError();
  return new FixtureCrawlerProvider();
}
