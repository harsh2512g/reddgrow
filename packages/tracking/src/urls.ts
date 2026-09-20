import type { UtmConfig } from './contracts.js';

export const TRACKING_FIXTURE_URL = 'http://127.0.0.1:3000/tracking-fixture';
export const TRACKING_CLICK_PARAM = 'ts_click_id';
export const TRACKING_PROOF_PARAM = 'ts_click_token';

/** Exact approved DNS names only: no suffix match, IP literals, wildcard or URL authority tricks. */
export function normalizeApprovedDomain(value: string): string | null {
  const host = value.toLowerCase();
  if (
    host !== value.trim().toLowerCase() ||
    host.length > 253 ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.endsWith('.')
  )
    return null;
  const labels = host.split('.');
  if (
    labels.length < 2 ||
    labels.some(
      (part) =>
        part.length < 1 || part.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part),
    )
  )
    return null;
  const last = labels.at(-1);
  if (
    !last ||
    /^\d+$/.test(last) ||
    ['localhost', 'local', 'internal', 'lan', 'home', 'onion', 'invalid'].includes(last)
  )
    return null;
  return host;
}

export function validateDestinationUrl(
  input: string,
  approvedDomains: readonly string[],
  options: { allowFixture?: boolean } = {},
): URL {
  if (
    input.length > 2048 ||
    input.trim() !== input ||
    [...input].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\',
    )
  )
    throw new Error('INVALID_DESTINATION');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('INVALID_DESTINATION');
  }
  if (url.username || url.password || url.hash) throw new Error('INVALID_DESTINATION');
  if (
    options.allowFixture &&
    url.origin === 'http://127.0.0.1:3000' &&
    url.pathname === '/tracking-fixture'
  )
    return url;
  const host = normalizeApprovedDomain(url.hostname);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    !host ||
    !approvedDomains.some((allowed) => normalizeApprovedDomain(allowed) === host)
  )
    throw new Error('DESTINATION_NOT_ALLOWED');
  return url;
}

export function mergeTrackingUtm(
  destination: URL,
  utm: Partial<UtmConfig> = {},
  overwrite = false,
): URL {
  const result = new URL(destination.href);
  const values = { source: 'reddit', medium: 'community', campaign: 'threadsignal', ...utm };
  for (const [key, value] of Object.entries(values)) {
    if (value && (overwrite || !result.searchParams.has(`utm_${key}`)))
      result.searchParams.set(`utm_${key}`, value);
  }
  return result;
}

export function buildTrackedDestination(input: {
  destinationUrl: string;
  approvedDomains: readonly string[];
  utm?: Partial<UtmConfig>;
  overwriteUtm?: boolean;
  clickId: string;
  clickToken: string;
  allowFixture?: boolean;
}): string {
  const destination = validateDestinationUrl(
    input.destinationUrl,
    input.approvedDomains,
    input.allowFixture ? { allowFixture: true } : {},
  );
  const result = mergeTrackingUtm(destination, input.utm, input.overwriteUtm);
  result.searchParams.set(TRACKING_CLICK_PARAM, input.clickId);
  result.searchParams.set(TRACKING_PROOF_PARAM, input.clickToken);
  return result.href;
}

export function validateBrowserEndpoint(input: string): string {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== '/api/v1/browser-events'
  )
    throw new Error('INVALID_TRACKING_ENDPOINT');
  const local = url.origin === 'http://127.0.0.1:3000';
  if (!local && (url.protocol !== 'https:' || url.port || !normalizeApprovedDomain(url.hostname)))
    throw new Error('INVALID_TRACKING_ENDPOINT');
  return url.href;
}
