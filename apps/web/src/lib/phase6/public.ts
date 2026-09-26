import 'server-only';
import { apiErrorResponse } from '../api-errors';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createLogger } from '@threadsignal/shared';
import {
  browserEventInputSchema,
  conversionInputSchema,
  conversionKeySchema,
  trackingCodeSchema,
  buildTrackedDestination,
  mergeTrackingUtm,
  validateDestinationUrl,
  currencyMinorDigits,
  monetaryMinorUnits,
  TRACKING_CLICK_PARAM,
  TRACKING_PROOF_PARAM,
  type ConversionInput,
} from '@threadsignal/tracking';
import { getServerEnv } from '../env/server';
import { attributionEnabled } from './server';
import { attributionDatabase } from './database';
import { attributionJson, hashTrackingSecret } from './api';
import { AttributionError, attributionFailure } from './errors';
import { enforceAttributionLimit } from './rate-limit';
const resultSchema = z.object({ id: z.uuid(), duplicate: z.boolean() });
function canonicalConversion<T extends ConversionInput>(event: T): T {
  return {
    ...event,
    clickId: event.clickId.toLowerCase(),
    value:
      monetaryMinorUnits(event.value, event.currency) / 10 ** currencyMinorDigits[event.currency],
    ...(event.idempotencyKey ? { idempotencyKey: event.idempotencyKey.toLowerCase() } : {}),
  };
}
const redirectSchema = z.object({
  destination_url: z.string(),
  utm_config: z.record(z.string(), z.string()),
  overwrite_utm: z.boolean(),
  click_id: z.uuid().nullable(),
  brand_id: z.uuid(),
  attribution_days: z.number().int(),
  approved_domains: z.array(z.string()),
});
export function shouldRecordClick(request: Request) {
  return (
    request.method === 'GET' &&
    !/bot\b|crawler|spider|facebookexternalhit|slackbot|discordbot|linkpreview/i.test(
      request.headers.get('user-agent') ?? '',
    ) &&
    !/prefetch|prerender/i.test(
      [
        request.headers.get('purpose'),
        request.headers.get('sec-purpose'),
        request.headers.get('x-purpose'),
      ].join(' '),
    )
  );
}
function trustedApiHost(request: Request) {
  const expected = new URL(getServerEnv().NEXT_PUBLIC_APP_URL);
  const actual = new URL(request.url);
  return (
    request.headers.get('host') === expected.host &&
    (actual.origin === expected.origin ||
      (expected.origin === 'http://127.0.0.1:3000' && actual.origin === 'http://localhost:3000'))
  );
}
function guard(request: Request) {
  if (!attributionEnabled()) throw new AttributionError('LOCAL_ONLY', 503);
  if (!trustedApiHost(request)) throw new AttributionError('FORBIDDEN', 403);
}
function failed(error: unknown, headers: Headers) {
  const fail = attributionFailure(error);
  createLogger({ service: 'tracking' }).warn(
    { event: 'tracking_request_failed', status: fail.status, code: fail.error.code },
    'Tracking request rejected.',
  );
  headers.set('X-Request-ID', fail.error.requestId);
  if (fail.status === 429) headers.set('Retry-After', '60');
  return apiErrorResponse(fail, headers);
}
const publicHeaders = () =>
  new Headers({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
export async function trackingRedirect(request: Request, code: string) {
  const start = performance.now();
  const headers = publicHeaders();
  let status = 500;
  try {
    guard(request);
    if (!trackingCodeSchema.safeParse(code).success)
      throw new AttributionError('TRACKING_LINK_UNAVAILABLE', 404);
    await enforceAttributionLimit('redirect', code);
    const record = shouldRecordClick(request),
      clickId = randomUUID(),
      token = `tsp_${randomBytes(32).toString('base64url')}`;
    const result = redirectSchema.parse(
      await attributionDatabase('redirect', [
        code,
        clickId,
        hashTrackingSecret(token),
        null,
        record,
      ]),
    );
    // This never fetches the target. SQL and the shared parser independently enforce its allowlist.
    const validated = validateDestinationUrl(result.destination_url, result.approved_domains);
    const fixture =
      getServerEnv().THREADSIGNAL_SUPABASE_MODE === 'local' &&
      validated.hostname === 'clarityscale.example';
    const destination = fixture
      ? `http://127.0.0.1:3000/tracking-fixture${validated.search}`
      : validated.href;
    const utm = {
      source: result.utm_config.utm_source ?? 'reddit',
      medium: result.utm_config.utm_medium ?? 'community',
      campaign: result.utm_config.utm_campaign ?? 'threadsignal',
      ...(result.utm_config.utm_content ? { content: result.utm_config.utm_content } : {}),
      ...(result.utm_config.utm_term ? { term: result.utm_config.utm_term } : {}),
    };
    const target = record
      ? new URL(
          buildTrackedDestination({
            destinationUrl: destination,
            approvedDomains: result.approved_domains,
            utm,
            overwriteUtm: result.overwrite_utm,
            clickId,
            clickToken: token,
            ...(fixture ? { allowFixture: true } : {}),
          }),
        )
      : mergeTrackingUtm(new URL(destination), utm, result.overwrite_utm);
    if (!record) {
      target.searchParams.delete(TRACKING_CLICK_PARAM);
      target.searchParams.delete(TRACKING_PROOF_PARAM);
    }
    if (fixture) {
      target.searchParams.set('brandId', result.brand_id);
      target.searchParams.set('attributionDays', String(result.attribution_days));
    }
    headers.set('Location', target.href);
    headers.set('X-Request-ID', randomUUID());
    headers.set('Server-Timing', `redirect;dur=${(performance.now() - start).toFixed(1)}`);
    status = 302;
    return new Response(null, { status, headers });
  } catch (error) {
    const response = failed(error, headers);
    status = response.status;
    return response;
  } finally {
    createLogger({ service: 'tracking' }).info(
      { event: 'tracking_redirect', status, durationMs: Math.round(performance.now() - start) },
      'Tracking redirect completed.',
    );
  }
}
async function allowBrowserOrigin(request: Request, brandId: string | null) {
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') throw new AttributionError('FORBIDDEN', 403);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AttributionError('FORBIDDEN', 403);
  }
  if (parsed.origin !== origin || parsed.username || parsed.password)
    throw new AttributionError('FORBIDDEN', 403);
  if ((await attributionDatabase('origin', [brandId, origin, true])) !== true)
    throw new AttributionError('FORBIDDEN', 403);
  return origin;
}
export async function browserOptions(request: Request) {
  const headers = publicHeaders();
  headers.set('Vary', 'Origin');
  try {
    guard(request);
    await enforceAttributionLimit('browser');
    const requested = (request.headers.get('access-control-request-headers') ?? '')
      .toLowerCase()
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (
      request.headers.get('access-control-request-method') !== 'POST' ||
      requested.some((v) => v !== 'content-type')
    )
      throw new AttributionError('FORBIDDEN', 403);
    const origin = await allowBrowserOrigin(request, null);
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '300');
    return new Response(null, { status: 204, headers });
  } catch (error) {
    return failed(error, headers);
  }
}
export async function ingestBrowserEvent(request: Request) {
  const headers = publicHeaders();
  headers.set('Vary', 'Origin');
  try {
    guard(request);
    if (request.headers.has('authorization') || request.headers.has('cookie'))
      throw new AttributionError('FORBIDDEN', 403);
    await enforceAttributionLimit('browser');
    const parsed = await attributionJson(request, browserEventInputSchema);
    const input = { ...canonicalConversion(parsed), brandId: parsed.brandId.toLowerCase() };
    const origin = await allowBrowserOrigin(request, input.brandId);
    headers.set('Access-Control-Allow-Origin', origin);
    await enforceAttributionLimit('browser', input.clickId);
    const { clickToken, ...event } = input;
    const result = resultSchema.parse(
      await attributionDatabase('conversion', [
        null,
        hashTrackingSecret(clickToken),
        origin,
        JSON.stringify(event),
        true,
      ]),
    );
    headers.set('X-Request-ID', randomUUID());
    return Response.json({ data: result }, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    return failed(error, headers);
  }
}
export async function ingestServerConversion(request: Request) {
  const headers = publicHeaders();
  try {
    guard(request);
    if (request.headers.has('cookie') || request.headers.has('origin'))
      throw new AttributionError('FORBIDDEN', 403);
    const authorization = request.headers.get('authorization') ?? '';
    const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    await enforceAttributionLimit(
      'conversion',
      conversionKeySchema.safeParse(candidate).success ? candidate : 'invalid',
    );
    const key = conversionKeySchema.safeParse(candidate);
    if (!key.success) throw new AttributionError('CONVERSION_KEY_INVALID', 401);
    const body = await attributionJson(request, z.record(z.string(), z.unknown()));
    const idempotency = request.headers.get('idempotency-key');
    if (idempotency) {
      const normalizedIdempotency = z.uuid().parse(idempotency).toLowerCase();
      if (
        body.idempotencyKey !== undefined &&
        z.uuid().parse(body.idempotencyKey).toLowerCase() !== normalizedIdempotency
      )
        throw new AttributionError('INVALID_INPUT');
      body.idempotencyKey = normalizedIdempotency;
    }
    const event = canonicalConversion(conversionInputSchema.parse(body));
    const result = resultSchema.parse(
      await attributionDatabase('conversion', [
        hashTrackingSecret(key.data),
        null,
        null,
        JSON.stringify(event),
        false,
      ]),
    );
    headers.set('X-Request-ID', randomUUID());
    return Response.json({ data: result }, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    return failed(error, headers);
  }
}
