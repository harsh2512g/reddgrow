import { lookup } from 'node:dns/promises';
import { request as requestHttp, type RequestOptions } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';
import { z } from 'zod';
import { CrawlError, isPublicAddress } from './security.js';
import { CRAWLER_USER_AGENT } from './robots.js';

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;
export type CrawlResponse = { status: number; headers: Record<string, string>; body: Uint8Array };
export type PinnedRequest = {
  url: URL;
  address: ResolvedAddress;
  signal: AbortSignal;
  maxBytes: number;
};
/** Injected transports are trusted server dependencies, never client-supplied configuration. */
export type CrawlTransport = (request: PinnedRequest) => Promise<CrawlResponse>;
export const resolveHost: ResolveHost = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map(({ address, family }) => ({ address, family: family === 4 ? 4 : 6 }));
};
const answersSchema = z
  .array(z.object({ address: z.string().max(64), family: z.union([z.literal(4), z.literal(6)]) }))
  .min(1)
  .max(32);

export async function resolvePublicAddress(
  hostname: string,
  resolver: ResolveHost,
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  let records: ResolvedAddress[];
  try {
    records = answersSchema.parse(await abortable(resolver(hostname), signal));
  } catch (error) {
    if (error instanceof CrawlError) throw error;
    throw new CrawlError('dns_failed');
  }
  // Reject a mixed public/private answer set, not merely the selected first address.
  if (records.some(({ address, family }) => isIP(address) !== family || !isPublicAddress(address)))
    throw new CrawlError('blocked_address');
  const selected = records[0];
  if (!selected) throw new CrawlError('dns_failed');
  return selected;
}

/** Deadline races DNS and injected adapters as well as the real cancellable socket. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      void promise.catch(() => undefined);
      reject(new CrawlError('timeout'));
      return;
    }
    const abort = () => reject(new CrawlError('timeout'));
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Exposed for contract tests: DNS cannot be resolved a second time by the HTTP client. */
export function pinnedRequestOptions(
  input: PinnedRequest,
): RequestOptions & { autoSelectFamily: false } {
  if (
    !isPublicAddress(input.address.address) ||
    isIP(input.address.address) !== input.address.family
  )
    throw new CrawlError('blocked_address');
  return {
    protocol: input.url.protocol,
    hostname: input.url.hostname,
    path: `${input.url.pathname}${input.url.search}`,
    port: input.url.protocol === 'https:' ? 443 : 80,
    method: 'GET',
    agent: false,
    family: input.address.family,
    autoSelectFamily: false,
    lookup: (_hostname, options, callback) => {
      // Node may request a single result or an array; both remain pinned.
      if (options.all) callback(null, [input.address]);
      else callback(null, input.address.address, input.address.family);
    },
    signal: input.signal,
    maxHeaderSize: 16 * 1024,
    headers: {
      'user-agent': CRAWLER_USER_AGENT,
      accept: 'text/html, text/plain;q=0.9',
      'accept-encoding': 'identity',
      connection: 'close',
    },
  };
}

/** No global agent, proxy environment, cookies, authorization, JavaScript, or redirect following. */
export const pinnedNodeTransport: CrawlTransport = (input) =>
  new Promise((resolve, reject) => {
    const request = input.url.protocol === 'https:' ? requestHttps : requestHttp;
    const req = request(pinnedRequestOptions(input), (response) => {
      const headers: Record<string, string> = {};
      for (const key of [
        'location',
        'content-type',
        'content-length',
        'content-encoding',
        'retry-after',
      ]) {
        const value = response.headers[key];
        if (typeof value === 'string') headers[key] = value;
      }
      const status = response.statusCode ?? 0;
      let bytes = 0;
      const chunks: Buffer[] = [];
      const fail = (code: 'response_limit' | 'unsupported_content' | 'request_failed') => {
        reject(new CrawlError(code));
        response.destroy();
        req.destroy();
      };
      response.once('error', () => reject(new CrawlError('request_failed')));
      response.once('aborted', () => reject(new CrawlError('request_failed')));
      if (status < 200 || status >= 300) {
        resolve({ status, headers, body: new Uint8Array() });
        response.destroy();
        return;
      }
      if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') {
        fail('unsupported_content');
        return;
      }
      const declared = headers['content-length'];
      if (declared && (!/^\d+$/u.test(declared) || Number(declared) > input.maxBytes)) {
        fail('response_limit');
        return;
      }
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > input.maxBytes) fail('response_limit');
        else chunks.push(chunk);
      });
      response.once('end', () => {
        if (!response.complete) reject(new CrawlError('request_failed'));
        else resolve({ status, headers, body: Buffer.concat(chunks) });
      });
    });
    req.once('error', () =>
      reject(new CrawlError(input.signal.aborted ? 'timeout' : 'request_failed')),
    );
    req.once('upgrade', (_response, socket) => {
      socket.destroy();
      reject(new CrawlError('unsupported_content'));
    });
    req.end();
  });
