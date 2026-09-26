import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createObservability } from '@threadsignal/shared';
import type { CrawlerPage, CrawlerProvider } from './index.js';
import { extractHtml } from './html.js';
import { parseRobots, robotsAllows, type RobotsPolicy } from './robots.js';
import {
  CrawlError,
  normalizeNetworkUrl,
  validateCrawlRequest,
  type CrawlRequest,
} from './security.js';
import {
  abortable,
  pinnedNodeTransport,
  resolveHost,
  resolvePublicAddress,
  type CrawlResponse,
  type CrawlTransport,
  type ResolveHost,
} from './transport.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const optionsSchema = z
  .object({
    timeoutMs: z.number().int().min(10).max(30_000).default(15_000),
    minIntervalMs: z.number().int().min(500).max(30_000).default(1000),
    concurrency: z.number().int().min(1).max(4).default(2),
  })
  .strict();
export type SimpleCrawlerOptions = {
  resolve?: ResolveHost;
  transport?: CrawlTransport;
  timeoutMs?: number;
  minIntervalMs?: number;
  concurrency?: number;
};
const responseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string().max(100), z.string().max(8192)),
    body: z.instanceof(Uint8Array),
  })
  .strict();
const crawlSchema = z
  .object({
    url: z.string().min(1).max(2048),
    approvedDomains: z.array(z.string().min(1).max(253)).min(1).max(100),
    maxPages: z.number().int().min(1).max(100).default(30),
    excludedUrls: z.array(z.string().max(2048)).max(1000).default([]),
  })
  .strict();
export type WebsiteCrawlInput = z.input<typeof crawlSchema>;
export type WebsiteCrawlResult = { pages: CrawlerPage[]; failures: number; partial: boolean };

/** Server-only adapter. Creation performs no I/O; the fixture remains the default factory. */
export class SimpleCrawlerProvider implements CrawlerProvider {
  readonly mode = 'simple';
  private readonly resolver: ResolveHost;
  private readonly transport: CrawlTransport;
  private readonly limits: z.infer<typeof optionsSchema>;
  private readonly robots = new Map<string, { expires: number; policy: RobotsPolicy }>();
  private readonly nextRequest = new Map<string, number>();
  private readonly cooldowns = new Map<string, number>();
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly observe = createObservability();

  constructor(options: SimpleCrawlerOptions = {}) {
    const { resolve, transport, ...limits } = options;
    this.limits = optionsSchema.parse(limits);
    this.resolver = resolve ?? resolveHost;
    this.transport = transport ?? pinnedNodeTransport;
  }

  async fetchPage(input: CrawlRequest): Promise<CrawlerPage> {
    return (await this.fetchDocument(input)).page;
  }

  /** Preview candidates from the approved landing page; selection precedes further ingestion. */
  async discoverPages(
    input: CrawlRequest,
    maxPages = 30,
  ): Promise<{ url: string; title: string }[]> {
    z.number().int().min(1).max(100).parse(maxPages);
    const result = await this.fetchDocument(input);
    const links = [...new Set(result.links)]
      .filter((url) => url !== result.page.url)
      .sort((a, b) => priority(b) - priority(a) || a.localeCompare(b))
      .slice(0, maxPages - 1);
    return [
      { url: result.page.url, title: result.page.title },
      ...links.map((url) => ({
        url,
        title: new URL(url).pathname === '/' ? new URL(url).hostname : new URL(url).pathname,
      })),
    ];
  }

  /** The caller supplies its server-authorized remaining page allowance (maximum 100). */
  async crawlWebsite(input: WebsiteCrawlInput): Promise<WebsiteCrawlResult> {
    const parsed = crawlSchema.safeParse(input);
    if (!parsed.success) throw new CrawlError('invalid_target');
    const request = parsed.data;
    const first = normalizeNetworkUrl(request.url, request.approvedDomains).href;
    const excluded = new Set(
      request.excludedUrls.map((url) => normalizeNetworkUrl(url, request.approvedDomains).href),
    );
    const pending = [first];
    const seen = new Set<string>();
    const pages = new Map<string, CrawlerPage>();
    const started = Date.now();
    let failures = 0;
    // Attempts, discovered candidates and total wall time are independently bounded.
    while (pending.length && seen.size < request.maxPages && Date.now() - started < 120_000) {
      const url = pending.shift();
      if (!url || seen.has(url) || excluded.has(url)) continue;
      seen.add(url);
      try {
        const result = await this.fetchDocument({ url, approvedDomains: request.approvedDomains });
        if (!excluded.has(result.page.url)) pages.set(result.page.url, result.page);
        for (const link of result.links) {
          if (
            !seen.has(link) &&
            !excluded.has(link) &&
            !pending.includes(link) &&
            pending.length < 1000
          )
            pending.push(link);
        }
        pending.sort((a, b) => priority(b) - priority(a) || a.localeCompare(b));
      } catch {
        failures++;
      }
    }
    if (!pages.size) throw new CrawlError('request_failed');
    return { pages: [...pages.values()], failures, partial: failures > 0 || pending.length > 0 };
  }

  private async fetchDocument(
    input: CrawlRequest,
  ): Promise<{ page: CrawlerPage; links: string[] }> {
    const request = validateCrawlRequest(input);
    const target = normalizeNetworkUrl(request.url, request.approvedDomains);
    return this.observe.run('provider.crawler.page', {}, async () => {
      await this.acquire();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.limits.timeoutMs);
      try {
        const result = await this.fetchFollowing(
          target,
          request.approvedDomains,
          controller.signal,
          false,
        );
        if (result.response.status !== 200)
          throw new CrawlError(result.response.status === 429 ? 'rate_limited' : 'request_failed');
        const contentType = result.response.headers['content-type']?.toLowerCase() ?? '';
        if (
          !/^(?:text\/html|text\/plain)(?:\s*;|$)/u.test(contentType) ||
          (/charset=/u.test(contentType) &&
            !/charset\s*=\s*["']?(?:utf-8|us-ascii)(?:["';\s]|$)/u.test(contentType))
        )
          throw new CrawlError('unsupported_content');
        const text = decode(result.response.body);
        const html = contentType.startsWith('text/html')
          ? extractHtml(text, result.url, request.approvedDomains)
          : undefined;
        const content = html?.text ?? text.trim();
        if (!content || content.length > 500_000) throw new CrawlError('response_limit');
        return {
          page: {
            url: html?.canonical ?? result.url.href,
            title: html?.title ?? result.url.hostname,
            text: content,
            checksum: createHash('sha256').update(content).digest('hex'),
            fetchedAt: new Date().toISOString(),
          },
          links: html?.links ?? [],
        };
      } catch (error) {
        if (error instanceof CrawlError) throw error;
        throw new CrawlError('request_failed');
      } finally {
        clearTimeout(timer);
        controller.abort();
        this.release();
      }
    });
  }

  private async fetchFollowing(
    initial: URL,
    approved: readonly string[],
    signal: AbortSignal,
    robots: boolean,
  ): Promise<{ response: CrawlResponse; url: URL }> {
    let url = initial;
    const visited = new Set<string>();
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (visited.has(url.href)) throw new CrawlError('redirect_limit');
      visited.add(url.href);
      const policy = robots ? undefined : await this.policy(url, approved, signal);
      if (policy && !robotsAllows(policy, url.pathname)) throw new CrawlError('robots_denied');
      await this.throttle(url.origin, policy?.delayMs ?? 0, signal);
      // Resolve immediately before each socket, including cached-policy pages and redirects.
      const address = await resolvePublicAddress(url.hostname, this.resolver, signal);
      const maxBytes = robots ? MAX_ROBOTS_BYTES : MAX_BYTES;
      const raw = await abortable(this.transport({ url, address, signal, maxBytes }), signal);
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new CrawlError('request_failed');
      const response = parsed.data;
      if (
        response.body.byteLength > maxBytes ||
        Number(response.headers['content-length'] ?? 0) > maxBytes
      )
        throw new CrawlError('response_limit');
      if (
        response.headers['content-encoding'] &&
        response.headers['content-encoding'] !== 'identity'
      )
        throw new CrawlError('unsupported_content');
      if (response.status === 429 || response.status === 503) {
        const rawRetry = response.headers['retry-after'];
        const retryMs =
          rawRetry && /^\d+$/u.test(rawRetry)
            ? Number(rawRetry) * 1000
            : rawRetry
              ? Date.parse(rawRetry) - Date.now()
              : 60_000;
        // Never hammer a denied host. Huge delays remain a refusal, not a shortened wait.
        this.nextRequest.set(
          url.origin,
          Date.now() +
            Math.max(
              60_000,
              Number.isFinite(retryMs) ? Math.min(retryMs, 24 * 60 * 60_000) : 60_000,
            ),
        );
        this.cooldowns.set(url.origin, this.nextRequest.get(url.origin) ?? Date.now());
      }
      if (!REDIRECTS.has(response.status)) return { response, url };
      const location = response.headers.location;
      if (!location || redirects === 5) throw new CrawlError('redirect_limit');
      let next: URL;
      try {
        next = normalizeNetworkUrl(new URL(location, url).href, approved, robots);
      } catch {
        throw new CrawlError('invalid_target');
      }
      if (
        (url.protocol === 'https:' && next.protocol !== 'https:') ||
        (robots && next.origin !== initial.origin)
      )
        throw new CrawlError('invalid_target');
      url = next;
    }
    throw new CrawlError('redirect_limit');
  }

  private async policy(
    url: URL,
    approved: readonly string[],
    signal: AbortSignal,
  ): Promise<RobotsPolicy> {
    const cached = this.robots.get(url.origin);
    if (cached && cached.expires > Date.now()) return cached.policy;
    const target = normalizeNetworkUrl(new URL('/robots.txt', url).href, approved, true);
    const { response } = await this.fetchFollowing(target, approved, signal, true);
    let policy: RobotsPolicy;
    if (response.status === 404 || response.status === 410) policy = { rules: [], delayMs: 0 };
    else if (response.status === 200) {
      if (!/^text\/(?:plain|html)(?:\s*;|$)/iu.test(response.headers['content-type'] ?? ''))
        throw new CrawlError('robots_unavailable');
      policy = parseRobots(decode(response.body));
    } else throw new CrawlError('robots_unavailable');
    if (this.robots.size >= 100) this.robots.delete(this.robots.keys().next().value ?? '');
    this.robots.set(url.origin, { policy, expires: Date.now() + 15 * 60_000 });
    return policy;
  }

  private async throttle(origin: string, delay: number, signal: AbortSignal): Promise<void> {
    for (const [key, until] of this.cooldowns) if (until < Date.now()) this.cooldowns.delete(key);
    if ((this.cooldowns.get(origin) ?? 0) > Date.now()) throw new CrawlError('rate_limited');
    for (const [key, until] of this.nextRequest)
      if (until < Date.now()) this.nextRequest.delete(key);
    if (!this.nextRequest.has(origin) && this.nextRequest.size >= 100)
      throw new CrawlError('crawl_limit');
    const now = Date.now();
    const scheduled = Math.max(now, this.nextRequest.get(origin) ?? 0);
    if (scheduled - now > this.limits.timeoutMs || delay > this.limits.timeoutMs)
      throw new CrawlError('rate_limited');
    this.nextRequest.set(origin, scheduled + Math.max(this.limits.minIntervalMs, delay));
    if (scheduled > now)
      await abortable(
        new Promise<void>((resolve) => {
          const timer = setTimeout(done, scheduled - now);
          function done() {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          }
          signal.addEventListener('abort', done, { once: true });
        }),
        signal,
      );
    // A different in-flight request may have received Retry-After while this slot waited.
    if ((this.cooldowns.get(origin) ?? 0) > Date.now()) throw new CrawlError('rate_limited');
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limits.concurrency) {
      this.active++;
      return;
    }
    if (this.waiters.length >= 32) throw new CrawlError('crawl_limit');
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}

function decode(body: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new CrawlError('unsupported_content');
  }
}
function priority(url: string): number {
  return /\/(?:docs?|documentation|product|features?|pricing|faq|use-cases?|security|privacy|policy)(?:\/|$)/iu.test(
    new URL(url).pathname,
  )
    ? 1
    : 0;
}
