export type RevenueAmount = { currency: string; value: number };

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}
export function formatRevenue(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(value);
}
export function formatPercent(value: number | null): string {
  return value === null
    ? '—'
    : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}
export function formatDate(value: string): string {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export function RevenueValues({ amounts }: { amounts: RevenueAmount[] }) {
  return amounts.length ? (
    amounts.map((amount) => (
      <span key={amount.currency} className="block whitespace-nowrap">
        {formatRevenue(amount.value, amount.currency)}
      </span>
    ))
  ) : (
    <span>—</span>
  );
}
