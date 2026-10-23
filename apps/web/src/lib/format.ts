export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatUsd(value: number): string {
  return usd.format(value);
}
