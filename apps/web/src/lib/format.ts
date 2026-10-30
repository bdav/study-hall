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

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "Sep 2, 2026" */
export function formatDate(date: string | Date): string {
  return dateFormat.format(new Date(date));
}

/** "Answered 3 times · 2 right" */
export function answeredLine(answeredCount: number, rightCount: number) {
  const times = answeredCount === 1 ? 'time' : 'times';
  return `Answered ${answeredCount} ${times} · ${rightCount} right`;
}

/** "1 lesson", "12 lessons" */
export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** An amount of time in hours and minutes: "1 hour 30 minutes" */
export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return [
    ...(hours > 0 ? [countOf(hours, 'hour')] : []),
    ...(minutes > 0 ? [countOf(minutes, 'minute')] : []),
  ].join(' ');
}
