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

const dayFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

/** "Oct 24" */
export function formatDay(date: string | Date): string {
  return dayFormat.format(new Date(date));
}

/** "Answered 3 times · 2 right" */
export function answeredLine(answeredCount: number, rightCount: number) {
  const times = answeredCount === 1 ? 'time' : 'times';
  return `Answered ${answeredCount} ${times} · ${rightCount} right`;
}
