import { describe, it, expect } from 'vitest';
import { applyAnswer } from './progressUpdater.js';

const now = new Date('2026-10-22T12:00:00Z');

describe('applyAnswer', () => {
  it('moves a NEW card to LEARNING on its first answer, even when MISSED', () => {
    const next = applyAnswer(
      { lifecycleState: 'NEW', masteryScore: 0 },
      'MISSED',
      now,
    );

    expect(next.lifecycleState).toBe('LEARNING');
  });

  it.each([
    ['MISSED', 7, 5],
    ['MISSED', 6, 3],
    ['PARTIALLY_CORRECT', 7, 6],
    ['PARTIALLY_CORRECT', 6, 4],
    ['GOOD', 3, 5],
    ['GOOD', 4, 5],
    ['NAILED', 6, 8],
    ['NAILED', 7, 8],
  ] as const)('changes mastery on %s from %i to %i', (grade, from, to) => {
    const next = applyAnswer(
      { lifecycleState: 'LEARNING', masteryScore: from },
      grade,
      now,
    );

    expect(next.masteryScore).toBe(to);
  });

  it.each([
    ['MISSED', '2026-10-22T12:30:00Z'],
    ['PARTIALLY_CORRECT', '2026-10-23T12:00:00Z'],
    ['GOOD', '2026-10-23T12:00:00Z'],
    ['NAILED', '2026-10-24T12:00:00Z'],
  ] as const)(
    'schedules a card answered %s on the LEARNING table, due %s',
    (grade, dueAt) => {
      const next = applyAnswer(
        { lifecycleState: 'NEW', masteryScore: 0 },
        grade,
        now,
      );

      expect(next.dueAt).toEqual(new Date(dueAt));
    },
  );

  it('records when the card was reviewed and the interval it was given', () => {
    const next = applyAnswer(
      { lifecycleState: 'LEARNING', masteryScore: 2 },
      'MISSED',
      now,
    );

    expect(next.lastReviewedAt).toEqual(now);
    expect(next.lastIntervalDays).toBeCloseTo(30 / (24 * 60));
  });

  it('keeps mastery from dropping below 0', () => {
    const next = applyAnswer(
      { lifecycleState: 'LEARNING', masteryScore: 1 },
      'MISSED',
      now,
    );

    expect(next.masteryScore).toBe(0);
  });

  it('keeps mastery from rising above 10', () => {
    const next = applyAnswer(
      { lifecycleState: 'LEARNING', masteryScore: 10 },
      'NAILED',
      now,
    );

    expect(next.masteryScore).toBe(10);
  });
});
