import { describe, expect, it } from 'vitest';
import { deadlineLine } from './format';

describe('deadlineLine', () => {
  // Late on 10 Nov in UTC, where a deadline's day is read
  const now = new Date('2026-11-10T23:30:00.000Z');
  const deadline = (date: string) => `${date}T00:00:00.000Z`;

  it.each([
    ['2026-11-09', 'Deadline passed'],
    ['2026-11-10', 'Deadline today'],
    ['2026-11-11', 'Deadline tomorrow'],
    ['2026-11-15', 'Deadline in 5 days'],
    ['2026-11-23', 'Deadline in 13 days'],
    ['2026-11-24', 'Deadline in 2 weeks'],
    ['2026-12-01', 'Deadline in 3 weeks'],
    ['2027-03-02', 'Deadline in 16 weeks'],
  ])('a deadline of %s reads "%s"', (date, line) => {
    expect(deadlineLine(deadline(date), now)).toBe(line);
  });
});
