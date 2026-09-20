/** Explicit supported ISO 4217 currencies, with their monetary minor-unit precision. */
export const currencyMinorDigits = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  SGD: 2,
  HKD: 2,
  CHF: 2,
  CNY: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  BRL: 2,
  MXN: 2,
  ZAR: 2,
  AED: 2,
  SAR: 2,
  JPY: 0,
  KRW: 0,
  CLP: 0,
  VND: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
} as const;

export type TrackingCurrency = keyof typeof currencyMinorDigits;
export const supportedCurrencies = Object.keys(currencyMinorDigits) as TrackingCurrency[];

export function isTrackingCurrency(value: unknown): value is TrackingCurrency {
  return typeof value === 'string' && Object.hasOwn(currencyMinorDigits, value);
}

export function validMonetaryAmount(value: unknown, currency: unknown): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1_000_000_000 ||
    !isTrackingCurrency(currency)
  )
    return false;
  const scaled = value * 10 ** currencyMinorDigits[currency];
  // Tolerance only covers binary representation of decimal amounts (for example 0.29).
  return Math.abs(scaled - Math.round(scaled)) <= Number.EPSILON * Math.max(1, scaled) * 2;
}

export function monetaryMinorUnits(value: number, currency: TrackingCurrency): number {
  if (!validMonetaryAmount(value, currency)) throw new Error('INVALID_AMOUNT');
  return Math.round(value * 10 ** currencyMinorDigits[currency]);
}
