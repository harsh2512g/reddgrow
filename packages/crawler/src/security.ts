import { BlockList, isIP } from 'node:net';
import { z } from 'zod';

export type CrawlErrorCode =
  | 'invalid_target'
  | 'blocked_address'
  | 'dns_failed'
  | 'request_failed'
  | 'timeout'
  | 'response_limit'
  | 'unsupported_content'
  | 'robots_denied'
  | 'robots_unavailable'
  | 'redirect_limit'
  | 'rate_limited'
  | 'crawl_limit';

/** Never retain the requested URL, remote body, DNS answer, or underlying exception. */
export class CrawlError extends Error {
  constructor(readonly code: CrawlErrorCode) {
    super(`Website crawl failed (${code}).`);
    this.name = 'CrawlError';
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['2620:4f:8000::', 48],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

/** Conservative public-unicast allowlist, including denial of all IPv4-mapped IPv6. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) return globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
  return false;
}

const requestSchema = z
  .object({
    url: z.string().min(1).max(2048),
    approvedDomains: z.array(z.string().min(1).max(253)).min(1).max(100),
  })
  .strict();
export type CrawlRequest = z.infer<typeof requestSchema>;

export function validateCrawlRequest(input: CrawlRequest): CrawlRequest {
  const result = requestSchema.safeParse(input);
  if (!result.success) throw new CrawlError('invalid_target');
  return result.data;
}

/** Exact caller-approved hosts only. No suffix matching or automatic subdomain approval. */
export function normalizeNetworkUrl(
  input: string,
  approvedDomains: readonly string[],
  robots = false,
): URL {
  try {
    if (input.length > 2048 || /[\u0000-\u0020\u007f]/u.test(input)) throw new Error(); // eslint-disable-line no-control-regex
    const url = new URL(input);
    const hostname = url.hostname;
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      isIP(hostname.replace(/^\[|\]$/g, '')) ||
      !approvedDomains.includes(hostname) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(hostname) ||
      hostname.split('.').some((label) => label.startsWith('xn--')) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/u.test(
        hostname,
      ) ||
      /(?:^|\.)(?:reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$/u.test(hostname)
    )
      throw new Error();
    // Drop tracking/query duplicates; they must never carry credentials into a crawl.
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const decoded = decodeURIComponent(url.pathname);
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f\u007f]/u.test(decoded) || /%[0-9a-f]{2}/iu.test(decoded))
      throw new Error();
    if (
      !robots &&
      (/(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|logout|cart|checkout|account|admin|wp-admin|oauth|auth|search)(?:\/|$)/iu.test(
        decoded,
      ) ||
        /\.(?:pdf|jpe?g|png|gif|svg|zip|gz|tar|mp[34]|web[mp]|ico|woff2?|ttf|css|js|json|xml|exe|dmg|bin)$/iu.test(
          decoded,
        ))
    )
      throw new Error();
    if (robots && url.pathname !== '/robots.txt') throw new Error();
    return url;
  } catch {
    throw new CrawlError('invalid_target');
  }
}
