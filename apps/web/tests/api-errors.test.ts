// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { apiError, apiErrorResponse, createApiRequestId } from '../src/lib/api-errors';
import { AuthActionError, authErrorResponse } from '../src/lib/auth/errors';
import { KnowledgeError, knowledgeErrorResponse } from '../src/lib/knowledge/http';
import { AttributionError, attributionFailure } from '../src/lib/phase6/errors';
import { BillingError, billingFailure } from '../src/lib/phase7/errors';
import { OperationsError, operationFailure } from '../src/lib/phase8/errors';
vi.mock('../src/lib/phase4/api', () => ({ DraftError: class extends Error {} }));
import { ExtensionError, extensionFailure } from '../src/lib/phase5/errors';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const envelope = async (response: Response, status: number, code: string) => {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const body: unknown = await response.json();
  expect(body).toEqual({
    error: {
      code,
      message: expect.any(String),
      details: {},
      requestId: expect.stringMatching(uuid),
    },
  });
  expect(body).toMatchObject({ error: { requestId: response.headers.get('x-request-id') } });
};
describe('standard private API error envelope', () => {
  it('generates fresh server UUIDs and preserves CORS, Retry-After and private caching', async () => {
    const failure = { status: 429, error: apiError('RATE_LIMITED', 'Please retry later.') };
    const response = apiErrorResponse(failure, {
      'X-Request-ID': 'untrusted-input',
      'Access-Control-Allow-Origin': 'https://customer.example',
      Vary: 'Origin',
      'Retry-After': '60',
      'Cache-Control': 'private, no-store',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('https://customer.example');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await envelope(response, 429, 'RATE_LIMITED');
    expect(apiError('RATE_LIMITED', 'Please retry later.').requestId).not.toBe(
      failure.error.requestId,
    );
  });
  it('preserves the auth retry interval without inventing limit counters', async () => {
    const response = authErrorResponse(new AuthActionError('RATE_LIMITED', 120));
    expect(response.headers.get('retry-after')).toBe('120');
    await envelope(response, 429, 'RATE_LIMITED');
  });
  it.each([
    ['knowledge', () => knowledgeErrorResponse(new KnowledgeError('FORBIDDEN', 403))],
    ['auth', () => authErrorResponse(new AuthActionError('INVALID_ORIGIN'))],
    [
      'attribution',
      () => apiErrorResponse(attributionFailure(new AttributionError('FORBIDDEN', 403))),
    ],
    ['billing', () => apiErrorResponse(billingFailure(new BillingError('FORBIDDEN', 403)))],
    [
      'operations',
      () =>
        apiErrorResponse(
          operationFailure(new OperationsError('FORBIDDEN', 403), createApiRequestId()),
        ),
    ],
    [
      'extension',
      () => {
        const failure = extensionFailure(new ExtensionError('FORBIDDEN', 403));
        return apiErrorResponse({ status: failure.status, error: failure.body.error });
      },
    ],
  ] as const)(
    'keeps %s permissions and statuses in the common envelope',
    async (feature, response) => {
      await envelope(response(), 403, feature === 'auth' ? 'INVALID_ORIGIN' : 'FORBIDDEN');
    },
  );
  it.each([
    ['knowledge', (error: unknown) => knowledgeErrorResponse(error), 'PROCESSING_FAILED'],
    ['auth', (error: unknown) => authErrorResponse(error), 'AUTH_UNAVAILABLE'],
    ['attribution', (error: unknown) => apiErrorResponse(attributionFailure(error)), 'UNAVAILABLE'],
    ['billing', (error: unknown) => apiErrorResponse(billingFailure(error)), 'UNAVAILABLE'],
    [
      'operations',
      (error: unknown) => apiErrorResponse(operationFailure(error, createApiRequestId())),
      'UNAVAILABLE',
    ],
    [
      'extension',
      (error: unknown) => {
        const failure = extensionFailure(error);
        return apiErrorResponse({ status: failure.status, error: failure.body.error });
      },
      'UNAVAILABLE',
    ],
  ] as const)(
    'does not disclose raw %s upstream messages, IDs or details',
    async (feature, respond, code) => {
      const response = respond({
        message: 'private-provider-response',
        requestId: 'untrusted-input',
        details: { query: 'private-database-query', limit: 99999 },
      });
      await envelope(response, feature === 'auth' ? 503 : 500, code);
    },
  );
});
