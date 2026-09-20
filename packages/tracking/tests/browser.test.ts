import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  createThreadSignalSnippet,
  createTrackingClient,
  type ThreadSignalSnippet,
  type TrackingBrowserEnvironment,
  type TrackOptions,
} from '../src/browser.js';
import { browserEventInputSchema } from '../src/contracts.js';

const brandId = '7ceeb18e-534f-4c67-8d4f-a15739841947';
const clickId = 'cf3f51f1-0406-4781-bb67-d7393aaf80b3';
const key = '325ec5cb-9846-492a-83e2-038d880358c6';
const token = `tsp_${'a'.repeat(43)}`;
const endpoint = 'http://127.0.0.1:3000/api/v1/browser-events';
const cookieName = `ts_attribution_${brandId.replaceAll('-', '')}`;
const options = { brandId, endpoint, consent: false };

function harness() {
  let now = Date.parse('2026-09-18T12:00:00Z');
  let privacy = false;
  let href = `https://clarityscale.example/pricing?plan=pro&ts_click_id=${clickId}&ts_click_token=${token}#pricing`;
  let cookie = '';
  let sequence = 0;
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
  const readCookie = vi.fn(() => cookie);
  const writeCookie = vi.fn((value: string) => {
    cookie = value.includes('Max-Age=0;') ? '' : (value.split(';')[0] ?? '');
  });
  const replaceUrl = vi.fn((value: string) => {
    href = value;
  });
  const env: TrackingBrowserEnvironment = {
    locationHref: () => href,
    replaceUrl,
    readCookie,
    writeCookie,
    privacySignal: () => privacy,
    fetch: transport,
    now: () => now,
    randomUUID: () => `325ec5cb-9846-492a-83e2-${String(++sequence).padStart(12, '0')}`,
  };
  return {
    env,
    transport,
    readCookie,
    writeCookie,
    replaceUrl,
    setPrivacy: (value: boolean) => {
      privacy = value;
    },
    setHref: (value: string) => {
      href = value;
    },
    setCookie: (value: string) => {
      cookie = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('consent-controlled browser tracking', () => {
  it('scrubs receipt query in memory while consent is absent, without cookies or event network', async () => {
    const h = harness();
    const client = createTrackingClient(options, h.env);
    expect(h.replaceUrl).toHaveBeenCalledWith(
      'https://clarityscale.example/pricing?plan=pro#pricing',
    );
    expect(await client.track('signup')).toEqual({ status: 'skipped', reason: 'consent_required' });
    expect(h.readCookie).not.toHaveBeenCalled();
    expect(h.writeCookie).not.toHaveBeenCalled();
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('requires explicit consent, then sends only a minimal validated body with no browser credentials', async () => {
    const h = harness();
    const client = createTrackingClient(options, h.env);
    expect(client.setConsent(true)).toBe(true);
    expect(h.writeCookie.mock.calls[0]?.[0]).toContain('Path=/; SameSite=Lax; Secure');
    expect(h.writeCookie.mock.calls[0]?.[0]).not.toContain('Domain=');
    const result = await client.track('purchase', {
      value: 99,
      currency: 'USD',
      externalId: 'order_123',
      metadata: { plan: 'Growth' },
    });
    expect(result.status).toBe('sent');
    const [url, request] = h.transport.mock.calls[0] ?? [];
    expect(url).toBe(endpoint);
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    });
    const body = browserEventInputSchema.parse(JSON.parse(String(request?.body)));
    expect(body).toMatchObject({
      brandId,
      clickId,
      clickToken: token,
      event: 'purchase',
      value: 99,
      consent: true,
      metadata: { plan: 'Growth' },
    });
    expect(Object.keys(body).sort()).toEqual([
      'brandId',
      'clickId',
      'clickToken',
      'consent',
      'currency',
      'event',
      'externalId',
      'idempotencyKey',
      'metadata',
      'occurredAt',
      'value',
    ]);
  });
  it('honors DNT/GPC even when the integration requests consent=true', async () => {
    const h = harness();
    h.setPrivacy(true);
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    expect(client.setConsent(true)).toBe(false);
    expect(await client.track('signup')).toEqual({ status: 'skipped', reason: 'privacy_signal' });
    expect(h.readCookie).not.toHaveBeenCalled();
    expect(h.writeCookie).not.toHaveBeenCalled();
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('revocation clears its cookie, receipt and retry memory and stops later events', async () => {
    const h = harness();
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    await client.track('signup', { idempotencyKey: key });
    expect(client.setConsent(false)).toBe(false);
    expect(h.writeCookie.mock.calls.at(-1)?.[0]).toContain('Max-Age=0');
    expect((await client.track('purchase', { value: 99 })).reason).toBe('consent_required');
    client.setConsent(true);
    expect((await client.retry(key)).reason).toBe('no_attribution');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('honors a privacy signal enabled after initial consent and removes its existing cookie', async () => {
    const h = harness();
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    h.setPrivacy(true);
    expect((await client.track('signup')).reason).toBe('privacy_signal');
    expect(h.writeCookie.mock.calls.at(-1)?.[0]).toContain('Max-Age=0');
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('explicitly revokes a previous page’s cookie without reading stored attribution', () => {
    const h = harness();
    const client = createTrackingClient(options, h.env);
    expect(h.writeCookie).not.toHaveBeenCalled();
    client.setConsent(false);
    expect(h.readCookie).not.toHaveBeenCalled();
    expect(h.writeCookie.mock.calls.at(-1)?.[0]).toContain('Max-Age=0');
  });
  it('retains attribution in a first-party cookie only after consent, and restores it on a later consented page', async () => {
    const h = harness();
    const first = createTrackingClient(options, h.env);
    first.setConsent(true);
    const second = createTrackingClient(options, h.env);
    expect(h.readCookie).not.toHaveBeenCalled();
    second.setConsent(true);
    expect(h.readCookie).toHaveBeenCalledTimes(1);
    expect((await second.track('signup')).status).toBe('sent');
  });
  it.each(['expired', 'other-brand', 'malformed', 'overlong'])(
    'refuses %s stored attribution',
    async (kind) => {
      const h = harness();
      h.setHref('https://clarityscale.example/');
      const receipt = {
        brandId,
        clickId,
        clickToken: token,
        expiresAt: h.env.now() + (kind === 'overlong' ? 91 : 1) * 86_400_000,
      };
      if (kind === 'expired') receipt.expiresAt = h.env.now() - 1;
      if (kind === 'other-brand') receipt.brandId = clickId;
      h.setCookie(
        `${cookieName}=${kind === 'malformed' ? '%notjson' : encodeURIComponent(JSON.stringify(receipt))}`,
      );
      const client = createTrackingClient({ ...options, consent: true }, h.env);
      expect((await client.track('signup')).reason).toBe('no_attribution');
      expect(h.transport).not.toHaveBeenCalled();
    },
  );
  it('expires an in-memory receipt even if its cookie cannot be removed', async () => {
    const h = harness();
    const client = createTrackingClient({ ...options, consent: true, cookieDays: 1 }, h.env);
    h.advance(86_400_001);
    h.writeCookie.mockImplementation(() => {
      throw new Error('cookies blocked');
    });
    expect((await client.track('signup')).reason).toBe('no_attribution');
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('does not renew receipt expiry on repeated consent or page reload', () => {
    const h = harness();
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    h.advance(86_400_000);
    client.setConsent(true);
    expect(h.writeCookie.mock.calls.at(-1)?.[0]).toContain(`Max-Age=${29 * 86400}`);
  });
  it('deduplicates successful and concurrent calls sharing an external identity', async () => {
    const h = harness();
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    const input = { externalId: 'order_123', value: 99 };
    const result = await Promise.all([
      client.track('purchase', input),
      client.track('purchase', input),
    ]);
    expect(result.every((item) => item.status === 'sent')).toBe(true);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect((await client.track('purchase', input)).status).toBe('duplicate');
    expect((await client.track('purchase', { ...input, value: 100 })).reason).toBe('invalid_event');
    expect(h.transport).toHaveBeenCalledTimes(1);
  });
  it('retries the identical failed payload with its timestamp and UUID preserved', async () => {
    const h = harness();
    h.transport.mockRejectedValueOnce(new Error('offline'));
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    const metadata = { plan: 'Growth' };
    const first = await client.track('purchase', { value: 99, idempotencyKey: key, metadata });
    expect(first).toEqual({ status: 'failed', reason: 'unavailable', idempotencyKey: key });
    metadata.plan = 'changed';
    h.advance(10_000);
    expect((await client.retry(key)).status).toBe('sent');
    expect(h.transport.mock.calls[0]?.[1]?.body).toBe(h.transport.mock.calls[1]?.[1]?.body);
    expect((await client.retry(key)).status).toBe('duplicate');
    expect(h.transport).toHaveBeenCalledTimes(2);
  });
  it('aborts in-flight transmission when consent is withdrawn', async () => {
    const h = harness();
    h.transport.mockImplementation(
      (_url, request) =>
        new Promise((_resolve, reject) =>
          request?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    const pending = client.track('signup');
    client.setConsent(false);
    expect(await pending).toEqual({ status: 'skipped', reason: 'consent_required' });
    expect(h.transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it('passes no synthetic receiver to native fetch', async () => {
    const h = harness();
    h.env.fetch = async function (this: unknown) {
      expect(this).toBeUndefined();
      return new Response(null, { status: 202 });
    };
    expect(
      (await createTrackingClient({ ...options, consent: true }, h.env).track('signup')).status,
    ).toBe('sent');
  });
  it.each([
    { value: -1 },
    { value: Infinity },
    { value: null },
    { value: 1.11, currency: 'JPY' },
    { currency: 'ZZZ' },
    { currency: null },
    { metadata: { email: 'person@example.test' } },
    { externalId: 'person@example.test' },
    { occurredAt: 'not a date' },
    { clickId: 'forged' },
  ])('refuses invalid event options without transmission %j', async (input) => {
    const h = harness();
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    expect((await client.track('signup', input as TrackOptions)).reason).toBe('invalid_event');
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('requires an initialized snippet and does not perform any automatic event', async () => {
    const h = harness();
    const snippet = createThreadSignalSnippet(h.env);
    expect((await snippet.track('signup')).reason).toBe('not_initialized');
    expect(snippet.setConsent(true)).toBe(false);
    snippet.init(options);
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('keeps a captured receipt across repeated identical initialization', async () => {
    const h = harness();
    const snippet = createThreadSignalSnippet(h.env);
    snippet.init(options);
    snippet.init(options);
    snippet.setConsent(true);
    expect((await snippet.track('signup')).status).toBe('sent');
    expect(h.replaceUrl).toHaveBeenCalledTimes(1);
  });
  it('bounds the unsent retry queue', async () => {
    const h = harness();
    h.transport.mockResolvedValue(new Response(null, { status: 503 }));
    const client = createTrackingClient({ ...options, consent: true }, h.env);
    for (let index = 0; index < 100; index++) await client.track('signup');
    expect((await client.track('signup')).reason).toBe('queue_full');
    expect(h.transport).toHaveBeenCalledTimes(100);
  });
  it('executes the actual bundled script with no cookie/storage/network use before consent', async () => {
    const h = harness();
    let installed: ThreadSignalSnippet | undefined;
    const document = {
      get cookie() {
        return h.env.readCookie();
      },
      set cookie(value: string) {
        h.env.writeCookie(value);
      },
    };
    const window = {
      location: { href: h.env.locationHref() },
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: string) => h.env.replaceUrl(url),
      },
      fetch: h.transport,
      get threadSignal() {
        return installed;
      },
      set threadSignal(value: ThreadSignalSnippet | undefined) {
        installed = value;
      },
      get localStorage() {
        throw new Error('storage forbidden');
      },
    };
    const navigator = {
      doNotTrack: '0',
      globalPrivacyControl: false,
      get userAgent() {
        throw new Error('fingerprinting forbidden');
      },
    };
    const script = readFileSync(
      new URL('../../../apps/web/public/threadsignal.js', import.meta.url),
      'utf8',
    );
    runInNewContext(script, {
      window,
      document,
      navigator,
      crypto: { randomUUID: () => key },
      URL,
      Date,
      AbortController,
      setTimeout,
      clearTimeout,
    });
    expect(installed).toBeDefined();
    installed?.init(options);
    expect((await installed?.track('signup'))?.reason).toBe('consent_required');
    expect(h.readCookie).not.toHaveBeenCalled();
    expect(h.writeCookie).not.toHaveBeenCalled();
    expect(h.transport).not.toHaveBeenCalled();
    installed?.setConsent(true);
    expect((await installed?.track('purchase', { value: 99 }))?.status).toBe('sent');
    expect(
      browserEventInputSchema.safeParse(JSON.parse(String(h.transport.mock.calls[0]?.[1]?.body)))
        .success,
    ).toBe(true);
    expect(script.length).toBeLessThan(16_000);
  });
});
