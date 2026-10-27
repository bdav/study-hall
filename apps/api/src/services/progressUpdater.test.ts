import { describe, it, expect } from 'vitest';
import { type RecallGrade } from '@prisma/client';
import {
  applyAnswer,
  markKnown,
  replayAnswers,
  NEW_PROGRESS,
  type ScheduledAnswer,
  type ScheduledProgress,
} from './progressUpdater.js';

const now = new Date('2026-10-22T12:00:00Z');
const HOUR_IN_MS = 60 * 60 * 1000;
const DAY_IN_MS = 24 * HOUR_IN_MS;

function daysAgo(days: number) {
  return new Date(now.getTime() - days * DAY_IN_MS);
}

function progress(overrides: Partial<ScheduledProgress> = {}) {
  return { ...NEW_PROGRESS, lifecycleState: 'LEARNING' as const, ...overrides };
}

/** An answer, now and in this session unless said otherwise. */
function answer(
  recallGrade: RecallGrade,
  { at = now, studySession = 'session-now' } = {},
): ScheduledAnswer {
  return { recallGrade, answeredAt: at, studySessionId: studySession };
}

function intervalInDays(next: { dueAt: Date | null }) {
  return (next.dueAt!.getTime() - now.getTime()) / DAY_IN_MS;
}

describe('applyAnswer', () => {
  it('moves a NEW card to LEARNING on its first answer, even when MISSED', () => {
    const next = applyAnswer(NEW_PROGRESS, answer('MISSED'), []);

    expect(next.lifecycleState).toBe('LEARNING');
    expect(next.lifecycleChangedAt).toEqual(now);
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
      progress({ masteryScore: from }),
      answer(grade),
      [],
    );

    expect(next.masteryScore).toBe(to);
  });

  it('keeps mastery from dropping below 0', () => {
    const next = applyAnswer(
      progress({ masteryScore: 1 }),
      answer('MISSED'),
      [],
    );

    expect(next.masteryScore).toBe(0);
  });

  it('keeps mastery from rising above 10', () => {
    const next = applyAnswer(
      progress({ masteryScore: 10 }),
      answer('NAILED'),
      [],
    );

    expect(next.masteryScore).toBe(10);
  });

  it('records when the card was reviewed and the interval it was given', () => {
    const next = applyAnswer(
      progress({ masteryScore: 2 }),
      answer('MISSED'),
      [],
    );

    expect(next.lastReviewedAt).toEqual(now);
    expect(next.lastIntervalDays).toBeCloseTo(30 / (24 * 60));
  });

  describe('LEARNING intervals', () => {
    it.each([
      ['MISSED', '2026-10-22T12:30:00Z'],
      ['PARTIALLY_CORRECT', '2026-10-23T12:00:00Z'],
      ['GOOD', '2026-10-23T12:00:00Z'],
      ['NAILED', '2026-10-24T12:00:00Z'],
    ] as const)(
      'schedules a LEARNING card answered %s due %s',
      (grade, dueAt) => {
        const next = applyAnswer(progress(), answer(grade), [
          answer('MISSED', { at: daysAgo(1), studySession: 'earlier' }),
        ]);

        expect(next.dueAt).toEqual(new Date(dueAt));
      },
    );

    it("gives a NEW card's first NAILED the interval of GOOD", () => {
      const next = applyAnswer(NEW_PROGRESS, answer('NAILED'), []);

      expect(next.dueAt).toEqual(new Date('2026-10-23T12:00:00Z'));
      expect(next.masteryScore).toBe(2);
    });
  });

  describe('LEARNING → STABLE', () => {
    const goodYesterday = answer('GOOD', {
      at: daysAgo(1),
      studySession: 'yesterday',
    });

    it('graduates a card after 2 successes in 2 sessions, the latest one of them', () => {
      const next = applyAnswer(progress(), answer('GOOD'), [goodYesterday]);

      expect(next.lifecycleState).toBe('STABLE');
      expect(next.lifecycleChangedAt).toEqual(now);
    });

    it('counts NAILED as a success', () => {
      const next = applyAnswer(progress(), answer('NAILED'), [
        answer('NAILED', { at: daysAgo(1), studySession: 'yesterday' }),
      ]);

      expect(next.lifecycleState).toBe('STABLE');
    });

    it('graduates a card after 2 successes on 2 days of one session', () => {
      const lateLastNight = new Date('2026-10-21T23:50:00Z');
      const justAfterMidnight = new Date('2026-10-22T00:10:00Z');

      const next = applyAnswer(
        progress(),
        answer('GOOD', { at: justAfterMidnight, studySession: 'one' }),
        [answer('GOOD', { at: lateLastNight, studySession: 'one' })],
      );

      expect(next.lifecycleState).toBe('STABLE');
    });

    it("doesn't graduate a card after 2 successes in one session on one day", () => {
      const next = applyAnswer(progress(), answer('GOOD'), [
        answer('GOOD', { at: new Date(now.getTime() - HOUR_IN_MS) }),
      ]);

      expect(next.lifecycleState).toBe('LEARNING');
    });

    it("doesn't graduate a card whose latest answer isn't a success", () => {
      const next = applyAnswer(progress(), answer('PARTIALLY_CORRECT'), [
        answer('GOOD', { at: daysAgo(2), studySession: 'two days ago' }),
        goodYesterday,
      ]);

      expect(next.lifecycleState).toBe('LEARNING');
      expect(next.lifecycleChangedAt).toBeNull();
    });

    it("doesn't count PARTIALLY_CORRECT as a success", () => {
      const next = applyAnswer(progress(), answer('GOOD'), [
        answer('PARTIALLY_CORRECT', {
          at: daysAgo(1),
          studySession: 'yesterday',
        }),
      ]);

      expect(next.lifecycleState).toBe('LEARNING');
    });

    it('counts only the successes since the card last entered LEARNING', () => {
      const next = applyAnswer(
        progress({ lifecycleChangedAt: daysAgo(1) }),
        answer('GOOD'),
        [
          answer('GOOD', { at: daysAgo(3), studySession: 'before' }),
          answer('MISSED', { at: daysAgo(1), studySession: 'yesterday' }),
        ],
      );

      expect(next.lifecycleState).toBe('LEARNING');
    });

    it("doesn't graduate a card on its first answer", () => {
      const next = applyAnswer(NEW_PROGRESS, answer('NAILED'), []);

      expect(next.lifecycleState).toBe('LEARNING');
    });
  });

  describe('STABLE → LEARNING', () => {
    const stable = progress({
      lifecycleState: 'STABLE',
      masteryScore: 7,
      lapseCount: 1,
      lifecycleChangedAt: daysAgo(10),
    });
    function earlier(...grades: RecallGrade[]) {
      return grades.map((grade, i) =>
        answer(grade, {
          at: daysAgo(grades.length - i),
          studySession: `earlier-${i}`,
        }),
      );
    }

    it('keeps a card STABLE on a single miss, counting a lapse', () => {
      const next = applyAnswer(
        stable,
        answer('MISSED'),
        earlier('GOOD', 'GOOD'),
      );

      expect(next.lifecycleState).toBe('STABLE');
      expect(next.lifecycleChangedAt).toEqual(daysAgo(10));
      expect(next.lapseCount).toBe(2);
    });

    it.each([
      ['MISSED', 'GOOD'],
      ['GOOD', 'MISSED'],
      ['MISSED', 'PARTIALLY_CORRECT'],
    ] as const)(
      'moves a card back to LEARNING on a second miss in its last 3 answers (%s, %s, MISSED)',
      (first, second) => {
        const next = applyAnswer(
          stable,
          answer('MISSED'),
          earlier('GOOD', first, second),
        );

        expect(next.lifecycleState).toBe('LEARNING');
        expect(next.lifecycleChangedAt).toEqual(now);
        expect(next.lapseCount).toBe(2);
        expect(next.dueAt).toEqual(new Date('2026-10-22T12:30:00Z'));
      },
    );

    it("keeps a card STABLE when its earlier miss isn't in its last 3 answers", () => {
      const next = applyAnswer(
        stable,
        answer('MISSED'),
        earlier('MISSED', 'GOOD', 'GOOD'),
      );

      expect(next.lifecycleState).toBe('STABLE');
    });

    it.each(['PARTIALLY_CORRECT', 'GOOD', 'NAILED'] as const)(
      "doesn't count a lapse on %s, nor move the card",
      (grade) => {
        const next = applyAnswer(stable, answer(grade), earlier('MISSED'));

        expect(next.lifecycleState).toBe('STABLE');
        expect(next.lapseCount).toBe(1);
      },
    );

    it("doesn't count a lapse on a LEARNING card's miss", () => {
      const next = applyAnswer(progress(), answer('MISSED'), []);

      expect(next.lapseCount).toBe(0);
    });
  });

  describe('STABLE intervals', () => {
    const hours = (n: number) => n / 24;

    it.each([
      // band, mastery before the answer, grade, interval in days
      ['fragile', 1, 'MISSED', hours(1)],
      ['fragile', 1, 'PARTIALLY_CORRECT', 1],
      ['fragile', 1, 'GOOD', 2],
      ['fragile', 1, 'NAILED', 4],
      ['developing', 4, 'MISSED', hours(6)],
      ['developing', 4, 'PARTIALLY_CORRECT', 2],
      ['developing', 4, 'GOOD', 5],
      ['developing', 4, 'NAILED', 10],
      ['solid', 7, 'MISSED', 1],
      ['solid', 7, 'PARTIALLY_CORRECT', 5],
      ['solid', 7, 'GOOD', 14],
      ['solid', 7, 'NAILED', 30],
      ['mastered', 10, 'MISSED', 3],
      ['mastered', 10, 'PARTIALLY_CORRECT', 10],
      ['mastered', 10, 'GOOD', 45],
      ['mastered', 10, 'NAILED', 90],
    ] as const)(
      'schedules a %s card (mastery %i) answered %s in %f days',
      (_, masteryScore, grade, days) => {
        const next = applyAnswer(
          progress({ lifecycleState: 'STABLE', masteryScore }),
          answer(grade),
          [],
        );

        expect(intervalInDays(next)).toBeCloseTo(days);
        expect(next.lastIntervalDays).toBeCloseTo(days);
      },
    );

    it.each([
      [2, 2],
      [3, 5],
      [5, 5],
      [6, 14],
      [8, 14],
      [9, 45],
    ])(
      'bands a card by its mastery before the answer: GOOD at %i is %i days',
      (masteryScore, days) => {
        const next = applyAnswer(
          progress({ lifecycleState: 'STABLE', masteryScore }),
          answer('GOOD'),
          [],
        );

        expect(intervalInDays(next)).toBeCloseTo(days);
      },
    );

    it('schedules a card that graduates on the STABLE table', () => {
      const next = applyAnswer(progress({ masteryScore: 4 }), answer('GOOD'), [
        answer('GOOD', { at: daysAgo(1), studySession: 'yesterday' }),
      ]);

      expect(next.lifecycleState).toBe('STABLE');
      expect(intervalInDays(next)).toBeCloseTo(5);
    });
  });

  describe('RETIRED', () => {
    it("never retires a card, however well it's known", () => {
      const next = applyAnswer(
        progress({ lifecycleState: 'STABLE', masteryScore: 10 }),
        answer('NAILED'),
        [answer('NAILED', { at: daysAgo(90), studySession: 'earlier' })],
      );

      expect(next.lifecycleState).toBe('STABLE');
    });

    it.each(['MISSED', 'NAILED'] as const)(
      'leaves a RETIRED card RETIRED when answered %s',
      (grade) => {
        const next = applyAnswer(
          progress({ lifecycleState: 'RETIRED', masteryScore: 9 }),
          answer(grade),
          [answer('MISSED', { at: daysAgo(1), studySession: 'earlier' })],
        );

        expect(next.lifecycleState).toBe('RETIRED');
      },
    );
  });

  describe('lateness bonus', () => {
    /** A solid STABLE card last given 10 days, answered this late. */
    function solidCardDaysLate(daysLate: number) {
      return progress({
        lifecycleState: 'STABLE',
        masteryScore: 7,
        lastIntervalDays: 10,
        dueAt: daysAgo(daysLate),
      });
    }

    it.each([
      ['GOOD', 14 * 1.25],
      ['NAILED', 30 * 1.25],
    ] as const)(
      'gives a card answered %s at 1.5 intervals overdue 1.25× its interval',
      (grade, days) => {
        const next = applyAnswer(solidCardDaysLate(15), answer(grade), []);

        expect(intervalInDays(next)).toBeCloseTo(days);
      },
    );

    it('gives no bonus just under 1.5 intervals overdue', () => {
      const next = applyAnswer(solidCardDaysLate(14.9), answer('GOOD'), []);

      expect(intervalInDays(next)).toBeCloseTo(14);
    });

    it('gives no bonus on time, or early', () => {
      for (const daysLate of [0, -3]) {
        const next = applyAnswer(
          solidCardDaysLate(daysLate),
          answer('GOOD'),
          [],
        );
        expect(intervalInDays(next)).toBeCloseTo(14);
      }
    });

    it.each([
      ['PARTIALLY_CORRECT', 5],
      ['MISSED', 1],
    ] as const)('gives no bonus on %s', (grade, days) => {
      const next = applyAnswer(solidCardDaysLate(30), answer(grade), []);

      expect(intervalInDays(next)).toBeCloseTo(days);
    });

    it("doesn't change mastery", () => {
      const next = applyAnswer(solidCardDaysLate(30), answer('GOOD'), []);

      expect(next.masteryScore).toBe(8);
    });

    it('never gives more than 90 days', () => {
      const next = applyAnswer(
        progress({
          lifecycleState: 'STABLE',
          masteryScore: 10,
          lastIntervalDays: 60,
          dueAt: daysAgo(120),
        }),
        answer('NAILED'),
        [],
      );

      expect(intervalInDays(next)).toBeCloseTo(90);
    });

    it("doesn't lengthen the interval of the answer that graduates a card", () => {
      const next = applyAnswer(
        progress({ masteryScore: 4, lastIntervalDays: 1, dueAt: daysAgo(5) }),
        answer('GOOD'),
        [answer('GOOD', { at: daysAgo(6), studySession: 'earlier' })],
      );

      expect(next.lifecycleState).toBe('STABLE');
      expect(intervalInDays(next)).toBeCloseTo(5);
    });

    it("doesn't lengthen a LEARNING interval", () => {
      const next = applyAnswer(
        progress({ lastIntervalDays: 1, dueAt: daysAgo(5) }),
        answer('GOOD'),
        [],
      );

      expect(intervalInDays(next)).toBeCloseTo(1);
    });
  });
});

describe('replayAnswers', () => {
  function onDay(day: number, recallGrade: RecallGrade): ScheduledAnswer {
    return {
      recallGrade,
      answeredAt: new Date(Date.UTC(2026, 9, day, 12)),
      studySessionId: `day-${day}`,
    };
  }

  it('rebuilds a card that graduated, then lapsed back to LEARNING', () => {
    const replayed = replayAnswers([
      onDay(1, 'GOOD'),
      onDay(2, 'GOOD'),
      onDay(6, 'MISSED'),
      onDay(7, 'MISSED'),
    ]);

    expect(replayed).toMatchObject({
      lifecycleState: 'LEARNING',
      lifecycleChangedAt: new Date(Date.UTC(2026, 9, 7, 12)),
      lapseCount: 2,
    });
  });

  it('keeps a card STABLE on its first miss, whatever it missed before it graduated', () => {
    const replayed = replayAnswers([
      onDay(1, 'GOOD'),
      onDay(2, 'MISSED'),
      onDay(3, 'GOOD'),
      onDay(8, 'MISSED'),
    ]);

    expect(replayed).toMatchObject({ lifecycleState: 'STABLE', lapseCount: 1 });
  });

  it('needs 2 new successes to graduate again, not the ones from before it lapsed', () => {
    const lapsed = [
      onDay(1, 'GOOD'),
      onDay(2, 'GOOD'),
      onDay(6, 'MISSED'),
      onDay(7, 'MISSED'),
    ];

    expect(replayAnswers([...lapsed, onDay(8, 'GOOD')]).lifecycleState).toBe(
      'LEARNING',
    );
    expect(
      replayAnswers([...lapsed, onDay(8, 'GOOD'), onDay(9, 'GOOD')])
        .lifecycleState,
    ).toBe('STABLE');
  });
});

describe('replayAnswers, with a card marked known', () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day, 12));
  function onDay(day: number, recallGrade: RecallGrade): ScheduledAnswer {
    return { recallGrade, answeredAt: at(day), studySessionId: `day-${day}` };
  }

  it('replays the mark, with no answers since', () => {
    expect(replayAnswers([], at(1))).toMatchObject({
      lifecycleState: 'STABLE',
      masteryScore: 3,
      markedKnownAt: at(1),
    });
  });

  it('replays a miss at the review after the mark as a lapse', () => {
    expect(replayAnswers([onDay(6, 'MISSED')], at(1))).toMatchObject({
      lifecycleState: 'STABLE',
      lapseCount: 1,
    });
  });

  it('replays the mark between the answers given before and after it', () => {
    const replayed = replayAnswers(
      [onDay(1, 'MISSED'), onDay(8, 'MISSED')],
      at(2),
    );

    // Missed while LEARNING, marked known, then a first STABLE miss
    expect(replayed).toMatchObject({ lifecycleState: 'STABLE', lapseCount: 1 });
  });
});

describe('markKnown', () => {
  it.each(['NEW', 'LEARNING'] as const)(
    'makes a %s card STABLE as if it had just graduated, due 5 days on',
    (lifecycleState) => {
      const known = markKnown(
        progress({
          lifecycleState,
          masteryScore: 0,
          lapseCount: 2,
          lastReviewedAt: daysAgo(3),
        }),
        now,
      );

      expect(known).toEqual({
        lifecycleState: 'STABLE',
        lifecycleChangedAt: now,
        masteryScore: 3,
        dueAt: new Date('2026-10-27T12:00:00Z'),
        lastIntervalDays: 5,
        // Not a review, and not a lapse
        lastReviewedAt: daysAgo(3),
        lapseCount: 2,
        markedKnownAt: now,
      });
    },
  );

  it('keeps a higher mastery, scheduling the card by its band', () => {
    const known = markKnown(progress({ masteryScore: 7 }), now);

    expect(known).toMatchObject({ masteryScore: 7, lastIntervalDays: 14 });
  });

  it.each(['STABLE', 'RETIRED'] as const)(
    'leaves a %s card as it is',
    (lifecycleState) => {
      expect(markKnown(progress({ lifecycleState }), now)).toBeNull();
    },
  );

  it("doesn't count misses from before the card was marked known", () => {
    const marked = markKnown(progress(), daysAgo(10))!;

    const next = applyAnswer(marked, answer('MISSED'), [
      answer('MISSED', { at: daysAgo(12), studySession: 'before' }),
      answer('GOOD', { at: daysAgo(11), studySession: 'before' }),
    ]);

    expect(next.lifecycleState).toBe('STABLE');
  });
});
