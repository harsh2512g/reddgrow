import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, RequestOptions } from 'node:http';
const mocks = vi.hoisted(() => ({ https: vi.fn(), http: vi.fn() }));
vi.mock('node:https', () => ({ request: mocks.https }));
vi.mock('node:http', () => ({ request: mocks.http }));
import { pinnedNodeTransport } from '../src/transport.js';

const target = {
  url: new URL('https://brand.example.com/docs'),
  address: { address: '8.8.8.8', family: 4 as const },
  signal: new AbortController().signal,
  maxBytes: 100,
};
function setup(
  input: {
    chunks?: Buffer[];
    headers?: Record<string, string>;
    status?: number;
    complete?: boolean;
  } = {},
) {
  const body = Object.assign(Readable.from(input.chunks ?? [Buffer.from('content')]), {
    statusCode: input.status ?? 200,
    headers: input.headers ?? { 'content-type': 'text/plain' },
    complete: input.complete ?? true,
  });
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
  const start = (_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    request.end.mockImplementation(() =>
      queueMicrotask(() => {
        // This controlled stream intentionally supplies exactly the Node response surface used.
        callback(body as unknown as IncomingMessage);
      }),
    );
    return request;
  };
  mocks.https.mockImplementation(start);
  mocks.http.mockImplementation(start);
  return { body, request };
}

describe('pinned Node socket adapter without sockets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('uses native HTTPS with a pinned lookup and returns bounded UTF-8 bytes', async () => {
    setup({ chunks: [Buffer.from('first '), Buffer.from('second')] });
    const result = await pinnedNodeTransport(target);
    expect(Buffer.from(result.body).toString('utf8')).toBe('first second');
    expect(mocks.https).toHaveBeenCalledOnce();
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.https.mock.calls[0]?.[0]).toMatchObject({
      hostname: 'brand.example.com',
      agent: false,
      signal: target.signal,
      method: 'GET',
      maxHeaderSize: 16384,
    });
  });
  it('uses HTTP only for explicitly approved HTTP URLs', async () => {
    setup();
    await pinnedNodeTransport({ ...target, url: new URL('http://brand.example.com/docs') });
    expect(mocks.http).toHaveBeenCalledOnce();
    expect(mocks.https).not.toHaveBeenCalled();
  });
  it('destroys an oversized chunked response and its request', async () => {
    const { body, request } = setup({ chunks: [Buffer.alloc(50), Buffer.alloc(51)] });
    await expect(pinnedNodeTransport(target)).rejects.toMatchObject({ code: 'response_limit' });
    expect(body.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
  });
  it.each(['101', '100000000000', 'invalid'])(
    'rejects oversized or malformed content length %s before reading',
    async (length) => {
      const { body } = setup({ headers: { 'content-length': length } });
      await expect(pinnedNodeTransport(target)).rejects.toMatchObject({ code: 'response_limit' });
      expect(body.destroyed).toBe(true);
    },
  );
  it('refuses compression instead of accepting decompression bombs', async () => {
    setup({ headers: { 'content-encoding': 'gzip' } });
    await expect(pinnedNodeTransport(target)).rejects.toMatchObject({
      code: 'unsupported_content',
    });
  });
  it('returns redirect metadata and destroys the body without following it', async () => {
    const { body } = setup({ status: 302, headers: { location: 'https://127.0.0.1/' } });
    expect(await pinnedNodeTransport(target)).toMatchObject({
      status: 302,
      headers: { location: 'https://127.0.0.1/' },
      body: new Uint8Array(),
    });
    expect(body.destroyed).toBe(true);
    expect(mocks.https).toHaveBeenCalledOnce();
  });
  it('rejects truncated streams and suppresses transport exception details', async () => {
    setup({ complete: false });
    await expect(pinnedNodeTransport(target)).rejects.toMatchObject({ code: 'request_failed' });
    const request = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => request.emit('error', new Error('private content'))),
      destroy: vi.fn(),
    });
    mocks.https.mockReturnValue(request);
    await expect(pinnedNodeTransport(target)).rejects.toThrow(
      'Website crawl failed (request_failed).',
    );
  });
  it('closes protocol-upgrade sockets without supporting WebSockets', async () => {
    const socket = { destroy: vi.fn() };
    const request = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => request.emit('upgrade', {}, socket)),
      destroy: vi.fn(),
    });
    mocks.https.mockReturnValue(request);
    await expect(pinnedNodeTransport(target)).rejects.toMatchObject({
      code: 'unsupported_content',
    });
    expect(socket.destroy).toHaveBeenCalled();
  });
});
