import { describe, expect, it } from 'vitest';
import {
  buildTrackedDestination,
  mergeTrackingUtm,
  normalizeApprovedDomain,
  validateBrowserEndpoint,
  validateDestinationUrl,
} from '../src/urls.js';

describe('destination boundaries', () => {
  it('requires an exact approved hostname and preserves harmless query parameters', () => {
    expect(
      validateDestinationUrl('https://clarityscale.example/pricing?plan=pro', [
        'clarityscale.example',
      ]).href,
    ).toBe('https://clarityscale.example/pricing?plan=pro');
    expect(() =>
      validateDestinationUrl('https://docs.clarityscale.example/', ['clarityscale.example']),
    ).toThrow();
    expect(() =>
      validateDestinationUrl('https://clarityscale.example.attacker.test/', [
        'clarityscale.example',
      ]),
    ).toThrow();
    expect(
      validateDestinationUrl('https://DOCS.clarityscale.example/', ['docs.clarityscale.example'])
        .hostname,
    ).toBe('docs.clarityscale.example');
  });
  it.each([
    'javascript:alert(1)',
    'http://clarityscale.example/',
    'https://clarityscale.example:8443/',
    'https://x:secret@clarityscale.example/',
    'https://clarityscale.example/#secret',
    'https://clarityscale.example\\@evil.test/',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://[::1]/',
    'https://169.254.169.254/',
    'https://10.0.0.1/',
    'https://app.localhost/',
    'https://app.internal/',
    'https://clarityscale.example./',
    ' https://clarityscale.example/',
  ])('refuses unsafe destination %s', (url) =>
    expect(() =>
      validateDestinationUrl(url, [
        'clarityscale.example',
        '127.0.0.1',
        '2130706433',
        '::1',
        '169.254.169.254',
        '10.0.0.1',
        'app.localhost',
        'app.internal',
        'clarityscale.example.',
      ]),
    ).toThrow(),
  );
  it('does not allow wildcard or IP approved domains', () => {
    for (const host of [
      '*.example.test',
      'localhost',
      '127.0.0.1',
      '[::1]',
      'example.test/',
      'https://example.test',
      'example.test.',
    ])
      expect(normalizeApprovedDomain(host)).toBeNull();
  });
  it('allows only the exact synthetic landing path when the caller explicitly enables fixtures', () => {
    expect(() => validateDestinationUrl('http://127.0.0.1:3000/tracking-fixture', [])).toThrow();
    expect(
      validateDestinationUrl('http://127.0.0.1:3000/tracking-fixture?plan=pro', [], {
        allowFixture: true,
      }).pathname,
    ).toBe('/tracking-fixture');
    for (const url of [
      'http://localhost:3000/tracking-fixture',
      'http://127.0.0.1:3002/tracking-fixture',
      'http://127.0.0.1:3000/api/secret',
      'http://127.0.0.1:3000/tracking-fixture/',
      'http://127.0.0.1:3000/tracking-fixture#fragment',
    ])
      expect(() => validateDestinationUrl(url, [], { allowFixture: true })).toThrow();
  });
  it('preserves customer UTM values by default and overrides only explicitly', () => {
    const destination = new URL(
      'https://clarityscale.example/?utm_source=customer&utm_campaign=spring&plan=pro',
    );
    const preserved = mergeTrackingUtm(destination, { campaign: 'launch', content: 'opportunity' });
    expect(preserved.searchParams.get('utm_source')).toBe('customer');
    expect(preserved.searchParams.get('utm_campaign')).toBe('spring');
    expect(preserved.searchParams.get('utm_medium')).toBe('community');
    expect(preserved.searchParams.get('plan')).toBe('pro');
    expect(
      mergeTrackingUtm(destination, { campaign: 'launch' }, true).searchParams.get('utm_campaign'),
    ).toBe('launch');
    expect(destination.searchParams.has('utm_medium')).toBe(false);
  });
  it('always replaces spoofed or duplicate reserved receipt parameters', () => {
    const destination = buildTrackedDestination({
      destinationUrl:
        'https://clarityscale.example/?ts_click_id=spoof&ts_click_id=second&ts_click_token=fake',
      approvedDomains: ['clarityscale.example'],
      clickId: 'new',
      clickToken: 'proof',
    });
    const url = new URL(destination);
    expect(url.searchParams.getAll('ts_click_id')).toEqual(['new']);
    expect(url.searchParams.getAll('ts_click_token')).toEqual(['proof']);
  });
  it('validates a fixed browser events endpoint without credentials or tracking query', () => {
    expect(validateBrowserEndpoint('https://app.example.test/api/v1/browser-events')).toBe(
      'https://app.example.test/api/v1/browser-events',
    );
    expect(validateBrowserEndpoint('http://127.0.0.1:3000/api/v1/browser-events')).toBe(
      'http://127.0.0.1:3000/api/v1/browser-events',
    );
    for (const url of [
      'http://app.example.test/api/v1/browser-events',
      'https://app.example.test/api/v1/browser-events?key=secret',
      'https://secret@app.example.test/api/v1/browser-events',
      'https://127.0.0.1/api/v1/browser-events',
      'http://localhost:3000/api/v1/browser-events',
      'https://app.example.test/api/other',
    ])
      expect(() => validateBrowserEndpoint(url)).toThrow();
  });
});
