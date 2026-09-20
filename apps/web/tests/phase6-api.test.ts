// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsFiltersSchema } from '@threadsignal/analytics';
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  db: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
  context: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('@/lib/phase6/server', () => ({
  attributionEnabled: mocks.enabled,
  loadTracking: vi.fn(),
  loadAnalytics: vi.fn(),
}));
vi.mock('@/lib/phase6/database', () => ({ attributionDatabase: mocks.db }));
vi.mock('@/lib/phase6/rate-limit', () => ({ enforceAttributionLimit: mocks.rate }));
vi.mock('@/lib/env/server', () => ({
  getServerEnv: () => ({
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
    THREADSIGNAL_SUPABASE_MODE: 'local',
  }),
}));
vi.mock('@/lib/organizations/server', () => ({ requireOrganization: mocks.context }));
import {
  trackingRedirect,
  ingestBrowserEvent,
  ingestServerConversion,
  browserOptions,
  shouldRecordClick,
} from '../src/lib/phase6/public';
import { createConversionKey, hashTrackingSecret, attributionRoute } from '../src/lib/phase6/api';
const org = '60000000-0000-4000-8000-000000000001',
  brand = '60000000-0000-4000-8000-000000000002',
  click = '60000000-0000-4000-8000-000000000003',
  eventId = '60000000-0000-4000-8000-000000000004';
const key = `tsk_${'a'.repeat(43)}`,
  proof = `tsp_${'b'.repeat(43)}`;
const body = {
  clickId: click,
  event: 'purchase',
  externalId: 'order-123',
  value: 99,
  currency: 'USD',
  occurredAt: '2026-09-18T12:00:00Z',
};
function req(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method = body === undefined ? 'GET' : 'POST',
) {
  return new Request('http://127.0.0.1:3000' + path, {
    method,
    headers: {
      Host: '127.0.0.1:3000',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.rate.mockResolvedValue(undefined);
  mocks.context.mockResolvedValue({
    organization: { id: org, role: 'owner' },
    supabase: { rpc: mocks.rpc },
  });
});
describe('Phase6 public attribution boundary', () => {
  it('fails closed outside the verified Supabase runtime before SQL', async () => {
    mocks.enabled.mockReturnValue(false);
    expect((await trackingRedirect(req('/go/abcdefgh1234'), 'abcdefgh1234')).status).toBe(503);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each(['localhost:3000', '127.0.0.1:3002', 'attacker.example'])(
    'rejects a different incoming host %s',
    async (host) => {
      expect(
        (await trackingRedirect(req('/go/abcdefgh1234', undefined, { Host: host }), 'abcdefgh1234'))
          .status,
      ).toBe(403);
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it('redirects to an independently allowlisted target with UTMs and hashed receipt only in SQL', async () => {
    mocks.db.mockResolvedValue({
      destination_url: 'https://customer.example/docs?utm_source=customer',
      utm_config: {
        utm_source: 'reddit',
        utm_medium: 'community',
        utm_campaign: 'threadsignal',
        utm_content: org,
        utm_term: 'approved-keyword',
      },
      overwrite_utm: false,
      click_id: click,
      brand_id: brand,
      attribution_days: 30,
      approved_domains: ['customer.example'],
    });
    const response = await trackingRedirect(req('/go/abcdefgh1234'), 'abcdefgh1234');
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location')!);
    expect(target.origin).toBe('https://customer.example');
    expect(target.searchParams.get('utm_source')).toBe('customer');
    expect(target.searchParams.get('utm_medium')).toBe('community');
    expect(target.searchParams.get('utm_term')).toBe('approved-keyword');
    expect(target.searchParams.get('ts_click_id')).toMatch(/^[a-f0-9-]{36}$/);
    const token = target.searchParams.get('ts_click_token')!;
    expect(token).toMatch(/^tsp_/);
    expect(mocks.db.mock.calls[0]![1][2]).toBe(hashTrackingSecret(token));
    expect(JSON.stringify(mocks.db.mock.calls)).not.toContain(token);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Server-Timing')).toMatch(/^redirect;dur=/);
  });
  it.each([false, true])(
    'preserves fixture query values and overrides UTMs only when selected (%s)',
    async (overwrite) => {
      mocks.db.mockResolvedValue({
        destination_url:
          'https://clarityscale.example/docs?utm_source=customer&utm_campaign=spring&plan=pro',
        utm_config: { utm_source: 'reddit', utm_campaign: 'launch' },
        overwrite_utm: overwrite,
        click_id: click,
        brand_id: brand,
        attribution_days: 30,
        approved_domains: ['clarityscale.example'],
      });
      const response = await trackingRedirect(req('/go/abcdefgh1234'), 'abcdefgh1234');
      const target = new URL(response.headers.get('location')!);
      expect(target.origin + target.pathname).toBe('http://127.0.0.1:3000/tracking-fixture');
      expect(target.searchParams.get('brandId')).toBe(brand);
      expect(target.searchParams.get('plan')).toBe('pro');
      expect(target.searchParams.get('utm_source')).toBe(overwrite ? 'reddit' : 'customer');
      expect(target.searchParams.get('utm_campaign')).toBe(overwrite ? 'launch' : 'spring');
    },
  );
  it.each([
    'https://evil.example/',
    'http://127.0.0.1/admin',
    'https://customer.example@evil.example/',
  ])('does not return an unsafe target %s', async (destination) => {
    mocks.db.mockResolvedValue({
      destination_url: destination,
      utm_config: {},
      overwrite_utm: false,
      click_id: click,
      brand_id: brand,
      attribution_days: 30,
      approved_domains: ['customer.example'],
    });
    const response = await trackingRedirect(req('/go/abcdefgh1234'), 'abcdefgh1234');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.has('location')).toBe(false);
  });
  it.each([
    { method: 'HEAD', headers: {} },
    { method: 'GET', headers: { 'User-Agent': 'ExampleBot/1.0' } },
    { method: 'GET', headers: { 'Sec-Purpose': 'prefetch;prerender' } },
  ])('does not count preview/bot traffic $method $headers', ({ method, headers }) => {
    expect(shouldRecordClick(req('/go/abcdefgh1234', undefined, headers, method))).toBe(false);
  });
  it('creates no browser attribution identifiers on HEAD', async () => {
    mocks.db.mockResolvedValue({
      destination_url: 'https://customer.example/',
      utm_config: {},
      overwrite_utm: false,
      click_id: null,
      brand_id: brand,
      attribution_days: 30,
      approved_domains: ['customer.example'],
    });
    const response = await trackingRedirect(
      req('/go/abcdefgh1234', undefined, {}, 'HEAD'),
      'abcdefgh1234',
    );
    expect(response.status).toBe(302);
    expect(mocks.db.mock.calls[0]![1][4]).toBe(false);
    expect(response.headers.get('location')).not.toContain('ts_click');
  });
  it.each([
    { method: 'HEAD', headers: {} },
    { method: 'GET', headers: { 'User-Agent': 'ExampleBot/1.0' } },
    { method: 'GET', headers: { 'Sec-Purpose': 'prefetch' } },
  ])(
    'strips existing click receipts from preview redirects ($method $headers)',
    async ({ method, headers }) => {
      for (const domain of ['customer.example', 'clarityscale.example']) {
        mocks.db.mockResolvedValue({
          destination_url: `https://${domain}/?ts_click_id=old&ts_click_id=duplicate&ts_click_token=old-proof&utm_source=customer&plan=pro`,
          utm_config: {},
          overwrite_utm: false,
          click_id: null,
          brand_id: brand,
          attribution_days: 30,
          approved_domains: [domain],
        });
        const response = await trackingRedirect(
          req('/go/abcdefgh1234', undefined, headers, method),
          'abcdefgh1234',
        );
        expect(response.status).toBe(302);
        const target = new URL(response.headers.get('location')!);
        expect(target.searchParams.has('ts_click_id')).toBe(false);
        expect(target.searchParams.has('ts_click_token')).toBe(false);
        expect(target.searchParams.get('utm_source')).toBe('customer');
        expect(target.searchParams.get('plan')).toBe('pro');
      }
    },
  );
  it('preflights only approved origins and never grants credentialed CORS', async () => {
    mocks.db.mockResolvedValue(true);
    const response = await browserOptions(
      req(
        '/api/v1/browser-events',
        undefined,
        {
          Origin: 'https://customer.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
        'OPTIONS',
      ),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://customer.example');
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    mocks.db.mockResolvedValue(false);
    expect(
      (
        await browserOptions(
          req(
            '/api/v1/browser-events',
            undefined,
            { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
            'OPTIONS',
          ),
        )
      ).status,
    ).toBe(403);
  });
  it('requires consent and removes the raw click proof before SQL', async () => {
    mocks.db.mockImplementation(async (op: string) =>
      op === 'origin' ? true : { id: eventId, duplicate: false },
    );
    const input = { ...body, brandId: brand, clickToken: proof, consent: true };
    const response = await ingestBrowserEvent(
      req('/api/v1/browser-events', input, { Origin: 'https://customer.example' }),
    );
    expect(response.status).toBe(201);
    const call = mocks.db.mock.calls.find((c) => c[0] === 'conversion')!;
    expect(call[1][1]).toBe(hashTrackingSecret(proof));
    expect(JSON.stringify(call)).not.toContain(proof);
    expect(JSON.parse(call[1][3]).brandId).toBe(brand);
    expect(
      (
        await ingestBrowserEvent(
          req(
            '/api/v1/browser-events',
            { ...input, consent: false },
            { Origin: 'https://customer.example' },
          ),
        )
      ).status,
    ).toBe(400);
  });
  it.each([{ Cookie: 'session=not-allowed' }, { Authorization: 'Bearer not-for-browser' }])(
    'refuses ambient/browser secrets in browser ingestion',
    async (headers) => {
      expect(
        (
          await ingestBrowserEvent(
            req(
              '/api/v1/browser-events',
              { ...body, brandId: brand, clickToken: proof, consent: true },
              { Origin: 'https://customer.example', ...headers },
            ),
          )
        ).status,
      ).toBe(403);
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it('uses hashed scoped server credentials and returns the original duplicate receipt', async () => {
    mocks.db.mockResolvedValue({ id: eventId, duplicate: true });
    const response = await ingestServerConversion(
      req('/api/v1/conversions', body, { Authorization: `Bearer ${key}` }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ id: eventId, duplicate: true });
    expect(mocks.db.mock.calls[0]![1][0]).toBe(hashTrackingSecret(key));
    expect(JSON.stringify(mocks.db.mock.calls)).not.toContain(key);
  });
  it.each([
    { transport: 'browser', currency: 'USD', value: 0.1 + 0.2, canonical: 0.3 },
    { transport: 'server', currency: 'USD', value: 0.1 + 0.2, canonical: 0.3 },
    { transport: 'browser', currency: 'KWD', value: 1.001 + 2.002, canonical: 3.003 },
    { transport: 'server', currency: 'KWD', value: 1.001 + 2.002, canonical: 3.003 },
  ])(
    'canonicalizes accepted $currency amounts before $transport SQL ingestion',
    async ({ transport, currency, value, canonical }) => {
      mocks.db.mockImplementation(async (op: string) =>
        op === 'origin' ? true : { id: eventId, duplicate: false },
      );
      const input = { ...body, value, currency };
      const response =
        transport === 'browser'
          ? await ingestBrowserEvent(
              req(
                '/api/v1/browser-events',
                { ...input, brandId: brand, clickToken: proof, consent: true },
                { Origin: 'https://customer.example' },
              ),
            )
          : await ingestServerConversion(
              req('/api/v1/conversions', input, { Authorization: `Bearer ${key}` }),
            );
      expect(response.status).toBe(201);
      const call = mocks.db.mock.calls.find((c) => c[0] === 'conversion')!;
      expect(JSON.parse(call[1][3]).value).toBe(canonical);
    },
  );
  it('normalizes browser UUIDs before origin checks, rate limits and SQL', async () => {
    mocks.db.mockImplementation(async (op: string) =>
      op === 'origin' ? true : { id: eventId, duplicate: false },
    );
    const upperBrand = '7CEEB18E-534F-4C67-8D4F-A15739841947';
    const upperClick = 'CF3F51F1-0406-4781-BB67-D7393AAF80B3';
    const upperIdempotency = '325EC5CB-9846-492A-83E2-038D880358C6';
    const response = await ingestBrowserEvent(
      req(
        '/api/v1/browser-events',
        {
          ...body,
          brandId: upperBrand,
          clickId: upperClick,
          idempotencyKey: upperIdempotency,
          clickToken: proof,
          consent: true,
        },
        { Origin: 'https://customer.example' },
      ),
    );
    expect(response.status).toBe(201);
    expect(mocks.db).toHaveBeenCalledWith('origin', [
      upperBrand.toLowerCase(),
      'https://customer.example',
      true,
    ]);
    expect(mocks.rate).toHaveBeenCalledWith('browser', upperClick.toLowerCase());
    const call = mocks.db.mock.calls.find((c) => c[0] === 'conversion')!;
    expect(JSON.parse(call[1][3])).toMatchObject({
      brandId: upperBrand.toLowerCase(),
      clickId: upperClick.toLowerCase(),
      idempotencyKey: upperIdempotency.toLowerCase(),
    });
  });
  it.each([true, false])(
    'normalizes server UUIDs and compares idempotency header/body without case sensitivity (header=%s)',
    async (withHeader) => {
      mocks.db.mockResolvedValue({ id: eventId, duplicate: false });
      const upperClick = 'CF3F51F1-0406-4781-BB67-D7393AAF80B3';
      const upperIdempotency = '325EC5CB-9846-492A-83E2-038D880358C6';
      const response = await ingestServerConversion(
        req(
          '/api/v1/conversions',
          {
            ...body,
            clickId: upperClick,
            idempotencyKey: upperIdempotency,
          },
          {
            Authorization: `Bearer ${key}`,
            ...(withHeader ? { 'Idempotency-Key': upperIdempotency.toLowerCase() } : {}),
          },
        ),
      );
      expect(response.status).toBe(201);
      const call = mocks.db.mock.calls.find((c) => c[0] === 'conversion')!;
      expect(JSON.parse(call[1][3])).toMatchObject({
        clickId: upperClick.toLowerCase(),
        idempotencyKey: upperIdempotency.toLowerCase(),
      });
    },
  );
  it.each([
    { value: -1 },
    { currency: 'ZZZ' },
    { currency: 'JPY', value: 1.25 },
    { metadata: { email: 'personal@example.test' } },
  ])('rejects malformed conversion before SQL', async (patch) => {
    expect(
      (
        await ingestServerConversion(
          req('/api/v1/conversions', { ...body, ...patch }, { Authorization: `Bearer ${key}` }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('rejects missing keys and conflicting idempotency headers', async () => {
    expect((await ingestServerConversion(req('/api/v1/conversions', body))).status).toBe(401);
    expect(
      (
        await ingestServerConversion(
          req(
            '/api/v1/conversions',
            { ...body, idempotencyKey: org },
            { Authorization: `Bearer ${key}`, 'Idempotency-Key': brand },
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('never returns an upstream error containing credentials', async () => {
    mocks.db.mockRejectedValue(new Error(key));
    const response = await ingestServerConversion(
      req('/api/v1/conversions', body, { Authorization: `Bearer ${key}` }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(key);
  });
  it('shows a new conversion key once while passing only hash/prefix to Supabase', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: eventId,
        brand_id: brand,
        name: 'Backend',
        key_prefix: 'tsk_abcdefgh',
        created_at: body.occurredAt,
        last_used_at: null,
        revoked_at: null,
      },
      error: null,
    });
    const result = await createConversionKey(
      req(
        '/api/conversion-keys',
        { brandId: brand, name: 'Backend' },
        { Origin: 'http://127.0.0.1:3000', 'X-ThreadSignal-Organization': org },
      ),
    );
    expect(result.key).toMatch(/^tsk_[A-Za-z0-9_-]{43}$/);
    expect(mocks.rpc.mock.calls[0]![1].p_hash).toBe(hashTrackingSecret(result.key));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(result.key);
  });
  it('viewers cannot create keys even when they forge management UI', async () => {
    mocks.context.mockResolvedValue({
      organization: { id: org, role: 'viewer' },
      supabase: { rpc: mocks.rpc },
    });
    const response = await attributionRoute(() =>
      createConversionKey(
        req(
          '/api/conversion-keys',
          { brandId: brand, name: 'Backend' },
          { Origin: 'http://127.0.0.1:3000', 'X-ThreadSignal-Organization': org },
        ),
      ),
    );
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('Phase 6 analytics style filter', () => {
  it.each([
    'Helpful and concise',
    'Technical',
    'Founder voice',
    'Product specialist',
    'Customer-support style',
    'Custom',
    'Unspecified',
  ])('accepts persisted persona style %s', (style) => {
    expect(analyticsFiltersSchema.parse({ style }).style).toBe(style);
  });
  it.each(['helpful_and_concise', 'technical', 'arbitrary_style'])(
    'rejects a style that does not match stored labels: %s',
    (style) => {
      expect(analyticsFiltersSchema.safeParse({ style }).success).toBe(false);
    },
  );
});
