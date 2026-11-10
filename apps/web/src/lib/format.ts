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

// A date with no time in the UTC day it's stored for, as the API reads it
const calendarDayFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** A date with no time, such as a Cram Date: "1 Jun" */
export function formatCalendarDay(date: string | Date): string {
  return calendarDayFormat.format(new Date(date));
}

const dueTimeFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** When a card comes due: "Thu, Nov 12, 3:30 PM" */
export function formatDueTime(date: string | Date): string {
  return dueTimeFormat.format(new Date(date));
}

const dayMs = 24 * 60 * 60 * 1000;

/**
 * How far off a deadline, a date with no time, is from today, in UTC as
 * the API reads it: "Deadline today", "Deadline in 5 days", "Deadline in 3
 * weeks", or "Deadline passed".
 */
export function deadlineLine(deadline: string | Date, now = new Date()) {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days = Math.round((new Date(deadline).getTime() - today) / dayMs);
  if (days < 0) return 'Deadline passed';
  if (days === 0) return 'Deadline today';
  if (days === 1) return 'Deadline tomorrow';
  if (days < 14) return `Deadline in ${days} days`;
  return `Deadline in ${countOf(Math.round(days / 7), 'week')}`;
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
