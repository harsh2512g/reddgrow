import { describe, expect, it } from 'vitest';
import {
  attributionSettingsSchema,
  browserEventInputSchema,
  conversionInputSchema,
  trackingLinkInputSchema,
} from '../src/contracts.js';
import { monetaryMinorUnits, validMonetaryAmount } from '../src/currency.js';

const id = '7ceeb18e-534f-4c67-8d4f-a15739841947';
const event = {
  clickId: id,
  event: 'purchase',
  externalId: 'order_123',
  value: 99,
  currency: 'USD',
  occurredAt: '2026-09-18T12:00:00Z',
};

describe('conversion contracts', () => {
  it('accepts supported currency-specific decimal precision without dropping money', () => {
    expect(monetaryMinorUnits(99.99, 'USD')).toBe(9999);
    expect(monetaryMinorUnits(0.29, 'USD')).toBe(29);
    expect(monetaryMinorUnits(99, 'JPY')).toBe(99);
    expect(monetaryMinorUnits(99.999, 'KWD')).toBe(99999);
    expect(validMonetaryAmount(99.1, 'JPY')).toBe(false);
    expect(validMonetaryAmount(99.999, 'USD')).toBe(false);
    expect(validMonetaryAmount(99.9999, 'KWD')).toBe(false);
  });
  it.each([NaN, Infinity, -1, 1_000_000_001])('rejects invalid value %s', (value) =>
    expect(conversionInputSchema.safeParse({ ...event, value }).success).toBe(false),
  );
  it.each(['ZZZ', 'XXX', 'XTS', 'usd', 'toString'])('rejects unsupported currency %s', (currency) =>
    expect(conversionInputSchema.safeParse({ ...event, currency }).success).toBe(false),
  );
  it('requires a deduplication identity and supports external and UUID identities', () => {
    expect(conversionInputSchema.parse(event).externalId).toBe('order_123');
    expect(conversionInputSchema.safeParse({ ...event, externalId: undefined }).success).toBe(
      false,
    );
    expect(
      conversionInputSchema.safeParse({ ...event, externalId: undefined, idempotencyKey: id })
        .success,
    ).toBe(true);
    expect(
      conversionInputSchema.safeParse({ ...event, externalId: 'user@example.test' }).success,
    ).toBe(false);
  });
  it('bounds metadata and names custom events', () => {
    expect(
      conversionInputSchema.safeParse({ ...event, metadata: { email: 'secret' } }).success,
    ).toBe(false);
    expect(conversionInputSchema.safeParse({ ...event, event: 'custom' }).success).toBe(false);
    expect(
      conversionInputSchema.safeParse({
        ...event,
        event: 'custom',
        metadata: { customName: 'demo_requested', plan: 'Growth' },
      }).success,
    ).toBe(true);
    expect(
      conversionInputSchema.safeParse({ ...event, metadata: { plan: 'a'.repeat(65) } }).success,
    ).toBe(false);
  });
  it('requires consent plus a click proof for public browser ingestion', () => {
    const browser = { ...event, brandId: id, clickToken: `tsp_${'a'.repeat(43)}`, consent: true };
    expect(browserEventInputSchema.safeParse(browser).success).toBe(true);
    expect(browserEventInputSchema.safeParse({ ...browser, consent: false }).success).toBe(false);
    expect(browserEventInputSchema.safeParse({ ...browser, clickToken: id }).success).toBe(false);
    expect(browserEventInputSchema.safeParse({ ...browser, apiKey: 'secret' }).success).toBe(false);
  });
  it('binds link creation to a draft/version and defaults UTM without caller tenant identity', () => {
    expect(
      trackingLinkInputSchema.parse({
        draftId: id,
        expectedVersion: 3,
        destinationUrl: 'https://clarityscale.example/pricing',
      }),
    ).toMatchObject({
      overwriteUtm: false,
      utm: { source: 'reddit', medium: 'community', campaign: 'threadsignal' },
    });
    expect(
      trackingLinkInputSchema.safeParse({
        draftId: id,
        destinationUrl: 'https://clarityscale.example/',
      }).success,
    ).toBe(false);
    expect(
      trackingLinkInputSchema.safeParse({
        draftId: id,
        expectedVersion: 1,
        destinationUrl: 'https://clarityscale.example/',
        brandId: id,
      }).success,
    ).toBe(false);
  });
  it('bounds attribution configuration', () => {
    expect(
      attributionSettingsSchema.safeParse({
        attributionDays: 30,
        consentText: 'Allow attribution of visits and conversions.',
      }).success,
    ).toBe(true);
    expect(
      attributionSettingsSchema.safeParse({
        attributionDays: 91,
        consentText: 'Allow attribution of visits and conversions.',
      }).success,
    ).toBe(false);
  });
});
