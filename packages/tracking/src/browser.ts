import type { BrowserEventInput, ConversionEventName } from './contracts.js';
import { isTrackingCurrency, validMonetaryAmount, type TrackingCurrency } from './currency.js';
import { TRACKING_CLICK_PARAM, TRACKING_PROOF_PARAM, validateBrowserEndpoint } from './urls.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const proofPattern = /^tsp_[A-Za-z0-9_-]{43}$/;
const externalPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const labelPattern = /^[A-Za-z0-9 _.-]{1,64}$/;
const day = 86_400_000;
const events: readonly string[] = ['signup', 'lead', 'trial_started', 'purchase', 'custom'];

export interface BrowserTrackingOptions {
  brandId: string;
  /** Exact ThreadSignal browser-events endpoint; never an API key. */
  endpoint: string;
  consent: boolean;
  cookieDays?: number;
}

export interface TrackOptions {
  value?: number;
  currency?: TrackingCurrency;
  externalId?: string;
  idempotencyKey?: string;
  occurredAt?: string;
  metadata?: { plan?: string; customName?: string };
}

export type TrackResult = {
  status: 'sent' | 'duplicate' | 'skipped' | 'failed';
  reason?:
    | 'consent_required'
    | 'privacy_signal'
    | 'no_attribution'
    | 'invalid_event'
    | 'unavailable'
    | 'rejected'
    | 'queue_full'
    | 'not_initialized'
    | 'unknown_retry';
  idempotencyKey?: string;
};

/** Narrow injected browser capabilities make the consent boundary independently testable. */
export interface TrackingBrowserEnvironment {
  locationHref(): string;
  replaceUrl(url: string): void;
  readCookie(): string;
  writeCookie(value: string): void;
  privacySignal(): boolean;
  fetch: typeof fetch;
  now(): number;
  randomUUID(): string;
}

export interface TrackingClient {
  setConsent(consent: boolean): boolean;
  track(event: ConversionEventName, options?: TrackOptions): Promise<TrackResult>;
  /** Retries the exact failed event, preserving its original timestamp and UUID. */
  retry(idempotencyKey: string): Promise<TrackResult>;
}

interface Receipt {
  brandId: string;
  clickId: string;
  clickToken: string;
  expiresAt: number;
}
interface Delivery {
  payload: BrowserEventInput;
  fingerprint: string;
  sent: boolean;
  inFlight?: Promise<TrackResult>;
}

function readReceipt(
  value: unknown,
  brandId: string,
  now: number,
  maxDays: number,
): Receipt | null {
  if (!value || typeof value !== 'object') return null;
  const receipt = value as Partial<Receipt>;
  if (
    receipt.brandId !== brandId ||
    typeof receipt.clickId !== 'string' ||
    !uuidPattern.test(receipt.clickId) ||
    typeof receipt.clickToken !== 'string' ||
    !proofPattern.test(receipt.clickToken) ||
    typeof receipt.expiresAt !== 'number' ||
    !Number.isFinite(receipt.expiresAt) ||
    receipt.expiresAt <= now ||
    receipt.expiresAt > now + maxDays * day
  )
    return null;
  return {
    brandId,
    clickId: receipt.clickId,
    clickToken: receipt.clickToken,
    expiresAt: receipt.expiresAt,
  };
}

function validOptions(value: TrackOptions, event: string, now: number): boolean {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !['value', 'currency', 'externalId', 'idempotencyKey', 'occurredAt', 'metadata'].includes(
          key,
        ),
    )
  )
    return false;
  if (value.value !== undefined && typeof value.value !== 'number') return false;
  if (value.currency !== undefined && !isTrackingCurrency(value.currency)) return false;
  if (
    !events.includes(event) ||
    !isTrackingCurrency(value.currency ?? 'USD') ||
    !validMonetaryAmount(value.value ?? 0, value.currency ?? 'USD')
  )
    return false;
  if (
    value.externalId !== undefined &&
    (typeof value.externalId !== 'string' || !externalPattern.test(value.externalId))
  )
    return false;
  if (
    value.idempotencyKey !== undefined &&
    (typeof value.idempotencyKey !== 'string' || !uuidPattern.test(value.idempotencyKey))
  )
    return false;
  if (value.occurredAt !== undefined) {
    if (typeof value.occurredAt !== 'string' || value.occurredAt.length > 40) return false;
    const at = Date.parse(value.occurredAt);
    if (
      !Number.isFinite(at) ||
      at > now + 300_000 ||
      at < now - 90 * day ||
      !/^\d{4}-\d\d-\d\dT/.test(value.occurredAt)
    )
      return false;
  }
  if (value.metadata !== undefined) {
    if (
      !value.metadata ||
      typeof value.metadata !== 'object' ||
      Array.isArray(value.metadata) ||
      Object.entries(value.metadata).some(
        ([key, item]) =>
          !['plan', 'customName'].includes(key) ||
          typeof item !== 'string' ||
          !labelPattern.test(item),
      )
    )
      return false;
  }
  return event !== 'custom' || Boolean(value.metadata?.customName);
}

export function createTrackingClient(
  options: BrowserTrackingOptions,
  environment: TrackingBrowserEnvironment,
): TrackingClient {
  if (
    !options ||
    !uuidPattern.test(options.brandId) ||
    typeof options.consent !== 'boolean' ||
    Object.keys(options).some(
      (key) => !['brandId', 'endpoint', 'consent', 'cookieDays'].includes(key),
    )
  )
    throw new Error('INVALID_TRACKING_CONFIGURATION');
  const endpoint = validateBrowserEndpoint(options.endpoint);
  const cookieDays = options.cookieDays ?? 30;
  if (!Number.isInteger(cookieDays) || cookieDays < 1 || cookieDays > 90)
    throw new Error('INVALID_TRACKING_CONFIGURATION');
  const cookieName = `ts_attribution_${options.brandId.replaceAll('-', '')}`;
  const pageUrl = new URL(environment.locationHref());
  const secure = pageUrl.protocol === 'https:' ? '; Secure' : '';
  // The script captures only explicit link attribution, never document text or identity.
  const queryReceipt = readReceipt(
    {
      brandId: options.brandId,
      clickId: pageUrl.searchParams.get(TRACKING_CLICK_PARAM),
      clickToken: pageUrl.searchParams.get(TRACKING_PROOF_PARAM),
      expiresAt: environment.now() + cookieDays * day,
    },
    options.brandId,
    environment.now(),
    cookieDays,
  );
  let receipt = queryReceipt;
  if (
    pageUrl.searchParams.has(TRACKING_CLICK_PARAM) ||
    pageUrl.searchParams.has(TRACKING_PROOF_PARAM)
  ) {
    pageUrl.searchParams.delete(TRACKING_CLICK_PARAM);
    pageUrl.searchParams.delete(TRACKING_PROOF_PARAM);
    // Scrubbing a sensitive query does not read/write persistent storage or send an event.
    try {
      environment.replaceUrl(pageUrl.href);
    } catch {
      /* History may be restricted in a sandboxed document. */
    }
  }
  let consent = false;
  let generation = 0;
  const deliveries = new Map<string, Delivery>();
  const externalIds = new Map<string, string>();
  const requests = new Set<AbortController>();

  const clearCookie = () => {
    try {
      environment.writeCookie(`${cookieName}=; Max-Age=0; Path=/; SameSite=Lax${secure}`);
    } catch {
      /* Blocked cookies are not required for in-memory attribution. */
    }
  };
  function setConsent(granted: boolean): boolean {
    if (typeof granted !== 'boolean') return false;
    if (!granted || environment.privacySignal()) {
      // Explicit revocation also removes a previous page's cookie without reading it.
      // Merely initializing with consent=false never calls this operation.
      if (!granted || consent) clearCookie();
      consent = false;
      generation += 1;
      for (const request of requests) request.abort();
      requests.clear();
      deliveries.clear();
      externalIds.clear();
      if (!granted) receipt = null;
      return false;
    }
    consent = true;
    if (!receipt) {
      try {
        const stored = environment
          .readCookie()
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${cookieName}=`));
        if (stored && stored.length < 1024)
          receipt = readReceipt(
            JSON.parse(decodeURIComponent(stored.slice(cookieName.length + 1))) as unknown,
            options.brandId,
            environment.now(),
            cookieDays,
          );
      } catch {
        receipt = null;
      }
    }
    if (receipt && receipt.expiresAt > environment.now()) {
      const seconds = Math.max(0, Math.floor((receipt.expiresAt - environment.now()) / 1000));
      try {
        environment.writeCookie(
          `${cookieName}=${encodeURIComponent(JSON.stringify(receipt))}; Max-Age=${seconds}; Path=/; SameSite=Lax${secure}`,
        );
      } catch {
        /* In-memory attribution still works when cookies are blocked. */
      }
    } else {
      receipt = null;
      clearCookie();
    }
    return true;
  }

  function permission(): TrackResult | null {
    if (environment.privacySignal()) {
      if (consent) setConsent(false);
      return { status: 'skipped', reason: 'privacy_signal' };
    }
    if (!consent) return { status: 'skipped', reason: 'consent_required' };
    if (!receipt || receipt.expiresAt <= environment.now()) {
      receipt = null;
      clearCookie();
      return { status: 'skipped', reason: 'no_attribution' };
    }
    return null;
  }

  async function deliver(id: string, delivery: Delivery): Promise<TrackResult> {
    const denied = permission();
    if (denied) return denied;
    if (delivery.sent) return { status: 'duplicate', idempotencyKey: id };
    if (delivery.inFlight) return delivery.inFlight;
    const currentGeneration = generation;
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const request = (async (): Promise<TrackResult> => {
      try {
        const transport = environment.fetch;
        const response = await transport(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(delivery.payload),
          mode: 'cors',
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (currentGeneration !== generation)
          return { status: 'skipped', reason: 'consent_required' };
        if (!response.ok)
          return {
            status: 'failed',
            reason: response.status >= 500 || response.status === 429 ? 'unavailable' : 'rejected',
            idempotencyKey: id,
          };
        // Response content is not needed: the server validates, authenticates and deduplicates.
        delivery.sent = true;
        return { status: 'sent', idempotencyKey: id };
      } catch {
        return currentGeneration !== generation
          ? { status: 'skipped', reason: 'consent_required' }
          : { status: 'failed', reason: 'unavailable', idempotencyKey: id };
      } finally {
        clearTimeout(timeout);
        requests.delete(controller);
        delete delivery.inFlight;
      }
    })();
    delivery.inFlight = request;
    return request;
  }

  async function track(event: ConversionEventName, input: TrackOptions = {}): Promise<TrackResult> {
    const denied = permission();
    if (denied) return denied;
    if (!validOptions(input, event, environment.now()) || !receipt)
      return { status: 'failed', reason: 'invalid_event' };
    const externalKey = input.externalId ? `${event}:${input.externalId}` : undefined;
    const existingId =
      input.idempotencyKey ?? (externalKey ? externalIds.get(externalKey) : undefined);
    const id = existingId ?? environment.randomUUID();
    const fingerprint = JSON.stringify({
      clickId: receipt.clickId,
      event,
      externalId: input.externalId ?? null,
      value: input.value ?? 0,
      currency: input.currency ?? 'USD',
      metadata: {
        plan: input.metadata?.plan ?? null,
        customName: input.metadata?.customName ?? null,
      },
      occurredAt: input.occurredAt ?? null,
    });
    const existing = deliveries.get(id);
    if (existing)
      return existing.fingerprint === fingerprint
        ? deliver(id, existing)
        : { status: 'failed', reason: 'invalid_event', idempotencyKey: id };
    if (deliveries.size >= 100) {
      const oldestSent = [...deliveries.entries()].find(([, item]) => item.sent);
      if (!oldestSent) return { status: 'failed', reason: 'queue_full' };
      deliveries.delete(oldestSent[0]);
      for (const [key, value] of externalIds) if (value === oldestSent[0]) externalIds.delete(key);
    }
    const payload: BrowserEventInput = {
      brandId: options.brandId,
      clickId: receipt.clickId,
      clickToken: receipt.clickToken,
      consent: true,
      event,
      idempotencyKey: id,
      value: input.value ?? 0,
      currency: input.currency ?? 'USD',
      occurredAt: input.occurredAt ?? new Date(environment.now()).toISOString(),
      metadata: { ...input.metadata },
      ...(input.externalId ? { externalId: input.externalId } : {}),
    };
    const delivery: Delivery = { payload, fingerprint, sent: false };
    deliveries.set(id, delivery);
    if (externalKey) externalIds.set(externalKey, id);
    return deliver(id, delivery);
  }

  if (options.consent) setConsent(true);
  return {
    setConsent,
    track,
    retry: async (id) => {
      const denied = permission();
      if (denied) return denied;
      const delivery = deliveries.get(id);
      return delivery ? deliver(id, delivery) : { status: 'failed', reason: 'unknown_retry' };
    },
  };
}

export interface ThreadSignalSnippet extends TrackingClient {
  init(options: BrowserTrackingOptions): void;
}

export function createThreadSignalSnippet(
  environment: TrackingBrowserEnvironment,
): ThreadSignalSnippet {
  let client: TrackingClient | undefined;
  let initializedConfiguration: string | undefined;
  return {
    init(options) {
      const configuration = JSON.stringify(options);
      if (client && initializedConfiguration === configuration) return;
      if (client) client.setConsent(false);
      client = createTrackingClient(options, environment);
      initializedConfiguration = configuration;
    },
    setConsent: (consent) => client?.setConsent(consent) ?? false,
    track: async (event, options) =>
      client ? client.track(event, options) : { status: 'skipped', reason: 'not_initialized' },
    retry: async (id) =>
      client ? client.retry(id) : { status: 'skipped', reason: 'not_initialized' },
  };
}
