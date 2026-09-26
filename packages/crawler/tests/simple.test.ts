import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SimpleCrawlerProvider,
  createCrawlerProvider,
  isPublicAddress,
  normalizeNetworkUrl,
} from '../src/index.js';
import { parseRobots, robotsAllows } from '../src/robots.js';
import {
  pinnedRequestOptions,
  type CrawlResponse,
  type CrawlTransport,
  type ResolveHost,
} from '../src/transport.js';
import { extractHtml } from '../src/html.js';

const domain = 'brand.example.com';
const base = `https://${domain}`;
const input = { url: `${base}/docs`, approvedDomains: [domain] };
const response = (
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): CrawlResponse => ({
  status,
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  body: new TextEncoder().encode(body),
});
const page =
  '<!doctype html><title>Product &amp; guide</title><main><h1>Documentation</h1><p>Verified product information.</p></main>';
const publicDns: ResolveHost = () => Promise.resolve([{ address: '8.8.8.8', family: 4 as const }]);
function setup(custom?: CrawlTransport) {
  const transport = vi.fn<CrawlTransport>(
    custom ??
      (async ({ url }) =>
        url.pathname === '/robots.txt'
          ? response('User-agent: *\nDisallow: /private', 200, { 'content-type': 'text/plain' })
          : response(page)),
  );
  const resolve = vi.fn(publicDns);
  const provider = new SimpleCrawlerProvider({ resolve, transport, minIntervalMs: 500 });
  return { provider, resolve, transport };
}
async function settle<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(30_000);
  const result = await guarded;
  if ('error' in result) throw result.error;
  return result.value;
}

describe('network crawler boundaries without network access', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps fixture as the factory default and construction network-free', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(createCrawlerProvider().mode).toBe('fixture');
    expect(createCrawlerProvider('simple').mode).toBe('simple');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('extracts bounded text/title/checksum/timestamp and checks robots before the page', async () => {
    const { provider, resolve, transport } = setup();
    const result = await settle(provider.fetchPage(input));
    expect(result).toMatchObject({
      url: input.url,
      title: 'Product & guide',
      text: 'Documentation\nVerified product information.',
    });
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.fetchedAt).toBeDefined();
    expect(transport.mock.calls.map(([request]) => request.url.pathname)).toEqual([
      '/robots.txt',
      '/docs',
    ]);
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([request]) => request.address.address === '8.8.8.8')).toBe(
      true,
    );
  });
  it('discovers a bounded selection from only the approved landing page without fetching candidates', async () => {
    const { provider, transport } = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('User-agent: *\nAllow: /', 200, { 'content-type': 'text/plain' })
        : response(
            '<title>Brand</title><main>Product facts.</main><a href="/blog">Blog</a><a href="/pricing?utm_source=fixture">Pricing</a><a href="/pricing">Duplicate</a><a href="/docs">Docs</a><a href="https://unapproved.example.com/docs">Other host</a><a href="/login">Login</a>',
          ),
    );
    const pages = await settle(provider.discoverPages({ url: base, approvedDomains: [domain] }, 3));
    expect(pages).toHaveLength(3);
    expect(pages[0]).toEqual({ url: `${base}/`, title: 'Brand' });
    expect(
      pages
        .slice(1)
        .map((item) => item.url)
        .sort(),
    ).toEqual([`${base}/docs`, `${base}/pricing`]);
    expect(transport.mock.calls.map(([request]) => request.url.pathname)).toEqual([
      '/robots.txt',
      '/',
    ]);
    await expect(provider.discoverPages(input, 101)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each([
    'file:///etc/passwd',
    'ftp://brand.example.com/docs',
    'https://127.0.0.1/',
    'http://2130706433/',
    'https://0x7f000001/',
    'https://127.1/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://localhost/',
    'https://service.internal/',
    'https://brand.example.com:8443/docs',
    'https://user:password@brand.example.com/docs',
    'https://reddit.com/r/test',
    'https://old.reddit.com/r/test',
    'https://redd.it/abc',
    'https://brand.example.com.evil.com/docs',
    'https://bränd.com/',
    'https://xn--brnd-loa.com/',
    'https://brand.example.com/%6cogin',
    'https://brand.example.com/%252fadmin',
    'https://brand.example.com/cart',
    'https://brand.example.com/picture.svg',
    'https://brand.example.com/docs.pdf',
    'https://brand.example.com/secret%00',
  ])('rejects unsafe target %s before DNS or transport', async (url) => {
    const { provider, resolve, transport } = setup();
    const host = new URL(url).hostname;
    const approvedDomains = host.includes('evil') ? [domain] : [host];
    await expect(provider.fetchPage({ url, approvedDomains })).rejects.toMatchObject({
      code: 'invalid_target',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.2',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.0.8',
    '192.0.2.2',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '::ffff:127.0.0.1',
    '64:ff9b::a00:1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::',
    '3fff::1',
  ])('rejects private/special DNS answer %s', async (address) => {
    expect(isPublicAddress(address)).toBe(false);
    const { provider, resolve, transport } = setup();
    resolve.mockResolvedValue([{ address, family: 4 }]);
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'blocked_address',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'accepts public unicast %s',
    (address) => expect(isPublicAddress(address)).toBe(true),
  );
  it('rejects a mixed public/private answer rather than selecting a public entry', async () => {
    const { provider, resolve, transport } = setup();
    resolve.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.2', family: 4 },
    ]);
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'blocked_address',
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it('revalidates DNS after robots to prevent rebinding before the content socket', async () => {
    const { provider, resolve, transport } = setup();
    resolve
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'blocked_address',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('pins both lookup modes, preserves original host and uses no shared agent or credentials', () => {
    const options = pinnedRequestOptions({
      url: new URL(input.url),
      address: { address: '8.8.8.8', family: 4 },
      signal: new AbortController().signal,
      maxBytes: 100,
    });
    expect(options).toMatchObject({
      hostname: domain,
      agent: false,
      autoSelectFamily: false,
      method: 'GET',
      port: 443,
    });
    const callback = vi.fn();
    options.lookup?.(domain, {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    options.lookup?.(domain, { all: true }, callback);
    expect(callback).toHaveBeenLastCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
    expect(options.headers).not.toHaveProperty('authorization');
    expect(options.headers).not.toHaveProperty('cookie');
  });
  it('honors disallow and never fetches a prohibited page', async () => {
    const { provider, transport } = setup();
    await expect(
      settle(provider.fetchPage({ ...input, url: `${base}/private` })),
    ).rejects.toMatchObject({ code: 'robots_denied' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 500, 503])('fails closed on unavailable robots %i', async (status) => {
    const { provider, transport } = setup(async () => response('', status));
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'robots_unavailable',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([404, 410])('treats missing robots %i as no rules', async (status) => {
    const { provider } = setup(async ({ url }) =>
      response(
        url.pathname === '/robots.txt' ? '' : page,
        url.pathname === '/robots.txt' ? status : 200,
      ),
    );
    expect((await settle(provider.fetchPage(input))).text).toContain('Verified product');
  });
  it.each([
    'https://evil.com/docs',
    'http://brand.example.com/docs',
    'https://127.0.0.1/docs',
    'https://old.reddit.com/r/test',
  ])('rejects redirect %s without fetching it', async (location) => {
    const { provider, transport } = setup(async ({ url }) =>
      url.pathname === '/robots.txt' ? response('', 404) : response('', 302, { location }),
    );
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'invalid_target',
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('checks robots and fresh DNS for an explicitly approved redirected subdomain', async () => {
    const docs = 'docs.brand.example.com';
    const { provider, resolve, transport } = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('', 404)
        : url.hostname === domain
          ? response('', 301, { location: `https://${docs}/guide` })
          : response(page),
    );
    expect(
      (await settle(provider.fetchPage({ ...input, approvedDomains: [domain, docs] }))).url,
    ).toBe(`https://${docs}/guide`);
    expect(resolve.mock.calls.map((args) => args[0])).toEqual([domain, domain, docs, docs]);
    expect(transport).toHaveBeenCalledTimes(4);
  });
  it('blocks a disallowed redirect destination and redirect loops', async () => {
    const { provider, transport } = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('User-agent: *\nDisallow: /private', 200, { 'content-type': 'text/plain' })
        : response('', 302, { location: '/private' }),
    );
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'robots_denied',
    });
    expect(transport).toHaveBeenCalledTimes(2);
    const loop = setup(async ({ url }) =>
      url.pathname === '/robots.txt' ? response('', 404) : response('', 302, { location: '/docs' }),
    );
    await expect(settle(loop.provider.fetchPage(input))).rejects.toMatchObject({
      code: 'redirect_limit',
    });
  });
  it('caps redirect hops', async () => {
    let count = 0;
    const { provider, transport } = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('', 404)
        : response('', 302, { location: `/redirect-${++count}` }),
    );
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'redirect_limit',
    });
    expect(transport).toHaveBeenCalledTimes(7);
  });
  it('does not carry queries or fragments into robots/page requests', async () => {
    const { provider, transport } = setup();
    await settle(provider.fetchPage({ ...input, url: `${base}//docs/?token=private#section` }));
    expect(transport.mock.calls.map(([request]) => request.url.href)).toEqual([
      `${base}/robots.txt`,
      `${base}/docs`,
    ]);
  });
  it.each([
    { 'content-type': 'application/pdf' },
    { 'content-type': 'text/html; charset=iso-8859-1' },
    { 'content-type': 'text/html', 'content-encoding': 'gzip' },
  ])('rejects unsupported content %j', async (headers) => {
    const { provider } = setup(async ({ url }) =>
      url.pathname === '/robots.txt' ? response('', 404) : response(page, 200, headers),
    );
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({
      code: 'unsupported_content',
    });
  });
  it('bounds response bytes and rejects invalid UTF-8', async () => {
    const huge = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('', 404)
        : response('x'.repeat(2 * 1024 * 1024 + 1)),
    );
    await expect(settle(huge.provider.fetchPage(input))).rejects.toMatchObject({
      code: 'response_limit',
    });
    const invalid = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('', 404)
        : { ...response(''), body: new Uint8Array([0xff]) },
    );
    await expect(settle(invalid.provider.fetchPage(input))).rejects.toMatchObject({
      code: 'unsupported_content',
    });
  });
  it('bounds DNS and transport timeouts and removes internal failures from errors', async () => {
    const dns = setup();
    dns.resolve.mockImplementation(() => new Promise(() => undefined));
    await expect(settle(dns.provider.fetchPage(input))).rejects.toMatchObject({ code: 'timeout' });
    const timeout = setup(() => new Promise(() => undefined));
    await expect(settle(timeout.provider.fetchPage(input))).rejects.toMatchObject({
      code: 'timeout',
    });
    const failure = setup(async () => {
      throw new Error('sensitive body or credential');
    });
    await expect(settle(failure.provider.fetchPage(input))).rejects.toThrow(
      'Website crawl failed (request_failed).',
    );
  });
  it('bounds concurrency and waiting callers', async () => {
    let active = 0;
    let maximum = 0;
    const { provider } = setup(async ({ url }) => {
      active++;
      maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active--;
      return url.pathname === '/robots.txt' ? response('', 404) : response(page);
    });
    await settle(Promise.all(Array.from({ length: 5 }, () => provider.fetchPage(input))));
    expect(maximum).toBeLessThanOrEqual(2);
    const stuck = setup(() => new Promise(() => undefined));
    const requests = Array.from({ length: 35 }, () =>
      stuck.provider.fetchPage(input).catch((error: unknown) => error),
    );
    await expect(requests[34]).resolves.toMatchObject({ code: 'crawl_limit' });
    await vi.advanceTimersByTimeAsync(300_000);
    await Promise.all(requests);
  });
  it('enforces request spacing and honors Retry-After without immediate retry', async () => {
    const times: number[] = [];
    const { provider, transport } = setup(async ({ url }) => {
      times.push(Date.now());
      return url.pathname === '/robots.txt'
        ? response('', 404)
        : response('', 429, { 'retry-after': '3600' });
    });
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(settle(provider.fetchPage(input))).rejects.toMatchObject({ code: 'rate_limited' });
    expect(transport).toHaveBeenCalledTimes(2);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(500);
  });
  it('discovers approved preferred pages, deduplicates queries and honors page/exclusion budgets', async () => {
    const { provider, transport } = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('', 404)
        : response(
            `${page}<nav><a href='/news'>News</a><a href='/pricing?utm=1'>Pricing</a><a href='/pricing?utm=2'>Duplicate</a><a href='/private'>Exclude</a><a href='https://evil.com/x'>External</a></nav>`,
          ),
    );
    const result = await settle(
      provider.crawlWebsite({
        url: `${base}/`,
        approvedDomains: [domain],
        maxPages: 2,
        excludedUrls: [`${base}/private`],
      }),
    );
    expect(result.pages.map(({ url }) => url)).toEqual([`${base}/`, `${base}/pricing`]);
    expect(result.partial).toBe(true);
    expect(transport.mock.calls.map(([request]) => request.url.pathname)).toEqual([
      '/robots.txt',
      '/',
      '/pricing',
    ]);
    expect(result.pages[0]?.text).not.toContain('Duplicate');
  });
  it('returns partial success for bounded page failures without inventing content', async () => {
    const { provider } = setup(async ({ url }) =>
      url.pathname === '/robots.txt'
        ? response('', 404)
        : url.pathname === '/'
          ? response(`${page}<a href='/missing'>Missing</a>`)
          : response('', 404),
    );
    const result = await settle(
      provider.crawlWebsite({ url: `${base}/`, approvedDomains: [domain] }),
    );
    expect(result).toMatchObject({ failures: 1, partial: true });
    expect(result.pages).toHaveLength(1);
    await expect(
      provider.crawlWebsite({ url: `${base}/`, approvedDomains: [domain], maxPages: 101 }),
    ).rejects.toMatchObject({ code: 'invalid_target' });
  });
});

describe('HTML and robots contracts', () => {
  it('extracts literal text with entities while excluding scripts, forms and hidden content', () => {
    const result = extractHtml(
      `<title>A &amp; B</title><script>alert('bad')</script><style>.bad{}</style><form>private form</form><main><p>Useful &lt;code&gt; &copy; text</p><p hidden>hidden</p><p aria-hidden='true'>hidden</p><div style='display:none'>hidden</div></main><link rel='canonical' href='/guide/?x=1'>`,
      new URL(input.url),
      [domain],
    );
    expect(result.title).toBe('A & B');
    expect(result.text).toBe('Useful <code> © text');
    expect(result.canonical).toBe(`${base}/guide`);
  });
  it('ignores cross-origin canonicals, base href and unsafe links', () => {
    const result = extractHtml(
      `${page}<base href='https://evil.com/'><link rel=canonical href='https://evil.com/x'><a href='/docs'>docs</a><a href='javascript:alert(1)'>bad</a>`,
      new URL(input.url),
      [domain],
    );
    expect(result.canonical).toBe(input.url);
    expect(result.links).toEqual([input.url]);
  });
  it('merges exact agent groups, gives them precedence and permits the longest allow on ties', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /\nUser-agent: ThreadSignalKnowledgeBot\nDisallow: /private\nAllow: /private/public\nUser-agent: threadsignalknowledgebot\nAllow: /private/public\nCrawl-delay: 2',
    );
    expect(policy.delayMs).toBe(2000);
    expect(robotsAllows(policy, '/docs')).toBe(true);
    expect(robotsAllows(policy, '/private/file')).toBe(false);
    expect(robotsAllows(policy, '/private/public')).toBe(true);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /same\nAllow: /same'), '/same')).toBe(
      true,
    );
  });
  it('matches case-sensitive paths, UTF-8 octets, wildcard and terminal rules without regex evaluation', () => {
    const policy = parseRobots(
      'User-agent: *\nDisallow: /files/*.pdf$\nDisallow: /café\nDisallow: /%7esecret\nDisallow: /CASE',
    );
    expect(robotsAllows(policy, '/files/one.pdf')).toBe(false);
    expect(robotsAllows(policy, '/files/one.pdf/guide')).toBe(true);
    expect(robotsAllows(policy, '/caf%C3%A9')).toBe(false);
    expect(robotsAllows(policy, '/~secret')).toBe(false);
    expect(robotsAllows(policy, '/case')).toBe(true);
  });
  it('bounds adversarial robots rules and validates exact ASCII domains', () => {
    expect(() => parseRobots(`User-agent: *\n${'Disallow: /private\n'.repeat(2001)}`)).toThrow(
      'robots_unavailable',
    );
    expect(() => normalizeNetworkUrl(`${base}/`, ['example.com'])).toThrow('invalid_target');
  });
});
