import { describe, expect, it } from 'vitest';
import { cramDueAt, cramNewPerDay } from './cramDate.js';
import { composeQueue, type QueueCandidates } from './queueGenerator.js';

/** Card ids "<prefix>1" to "<prefix>n", in priority order. */
function ids(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

type Bucket = Exclude<keyof QueueCandidates, 'newPerDay'>;

function candidates(counts: Partial<Record<Bucket, number>>) {
  return {
    dueLearning: ids('L', counts.dueLearning ?? 0),
    dueReinforcing: ids('R', counts.dueReinforcing ?? 0),
    weakReinforcing: ids('W', counts.weakReinforcing ?? 0),
    newCards: ids('N', counts.newCards ?? 0),
    retired: ids('T', counts.retired ?? 0),
  };
}

/** How many of each bucket a queue holds, by id prefix. */
function composition(queue: string[]) {
  const count = (prefix: string) =>
    queue.filter((id) => id.startsWith(prefix)).length;
  return {
    dueLearning: count('L'),
    dueReinforcing: count('R'),
    weakReinforcing: count('W'),
    newCards: count('N'),
  };
}

// A Quick session's queue for seed 42, recorded once: a change to it is a
// change to which cards a seed gives, or their order
const GOLDEN = ['L2', 'L1', 'N1', 'R2', 'R3', 'N2', 'W1', 'R1'];
// Drill Weakest's and Cram's Quick queues for seed 42, recorded likewise
// prettier-ignore
const DRILL_GOLDEN = ['L3', 'L1', 'W3', 'W8', 'W7', 'W9', 'W1', 'L2', 'W4', 'W6', 'W2', 'W5'];
// prettier-ignore
const CRAM_GOLDEN = ['L3', 'R4', 'N1', 'L2', 'N2', 'L1', 'R3', 'N3', 'R2', 'N4', 'W1', 'R1'];

describe('composeQueue', () => {
  describe('Review retired (#86)', () => {
    const review = (retired: number, seed = 42) =>
      composeQueue({
        candidates: candidates({ retired, dueLearning: 5, newCards: 5 }),
        sessionType: 'QUICK',
        studyMode: 'REVIEW_RETIRED',
        seed,
      });

    it('quizzes only retired cards, a random sample when there are more than fit', () => {
      const queue = review(30);

      expect(queue).toHaveLength(12);
      expect(queue.every((id) => id.startsWith('T'))).toBe(true);
      expect(queue).toEqual(review(30));
      // Not simply the first in deck order
      expect(queue).not.toEqual(ids('T', 12));
    });

    it('quizzes every retired card when they all fit', () => {
      expect([...review(3)].sort()).toEqual(ids('T', 3));
    });
  });

  it('gives an all-NEW deck a session of the minimum size, in deck order', () => {
    const queue = (sessionType: 'QUICK' | 'STANDARD' | 'DEEP') =>
      composeQueue({
        candidates: candidates({ newCards: 100 }),
        sessionType,
        seed: 1,
      });

    expect(queue('QUICK')).toEqual(ids('N', 5));
    expect(queue('STANDARD')).toEqual(ids('N', 10));
    expect(queue('DEEP')).toEqual(ids('N', 20));
  });

  it('mixes the buckets by their shares when every bucket has cards', () => {
    const queue = composeQueue({
      candidates: candidates({
        dueLearning: 4,
        weakReinforcing: 8,
        dueReinforcing: 40,
        newCards: 40,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    // NEW and weak at their 20% caps (5 of 25), every due LEARNING card,
    // and due REINFORCING the rest, under its 60% cap
    expect(composition(queue)).toEqual({
      dueLearning: 4,
      weakReinforcing: 5,
      dueReinforcing: 11,
      newCards: 5,
    });
  });

  it('takes the most urgent of each bucket', () => {
    const queue = composeQueue({
      candidates: candidates({
        dueLearning: 4,
        weakReinforcing: 8,
        dueReinforcing: 40,
        newCards: 40,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(queue.filter((id) => id.startsWith('W')).sort()).toEqual(
      ids('W', 5).sort(),
    );
    expect(queue.filter((id) => id.startsWith('R')).sort()).toEqual(
      ids('R', 11).sort(),
    );
  });

  it('gives NEW cards a tenth when shaky cards could fill half the session, due LEARNING up to half, past its share, leaving due REINFORCING some', () => {
    const queue = composeQueue({
      candidates: candidates({
        dueLearning: 20,
        weakReinforcing: 10,
        dueReinforcing: 40,
        newCards: 40,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    // NEW 2 (a tenth of 25), weak 5 (its cap), due LEARNING 12 (half),
    // due REINFORCING the rest
    expect(composition(queue)).toEqual({
      dueLearning: 12,
      weakReinforcing: 5,
      dueReinforcing: 6,
      newCards: 2,
    });
  });

  it('keeps a trickle of one NEW card however shaky the deck', () => {
    const queue = composeQueue({
      candidates: candidates({ dueLearning: 30, newCards: 10 }),
      sessionType: 'QUICK',
      seed: 1,
    });

    expect(composition(queue)).toMatchObject({ dueLearning: 11, newCards: 1 });
  });

  it('is no bigger for a due backlog, which decides only which cards come', () => {
    const backlog = candidates({ dueReinforcing: 1000 });
    const size = (sessionType: 'QUICK' | 'STANDARD' | 'DEEP') =>
      composeQueue({ candidates: backlog, sessionType, seed: 1 }).length;

    expect([size('QUICK'), size('STANDARD'), size('DEEP')]).toEqual([
      12, 25, 50,
    ]);
    expect(
      composeQueue({
        candidates: backlog,
        sessionType: 'STANDARD',
        seed: 1,
      }).sort(),
    ).toEqual(ids('R', 25).sort());
  });

  it('lets due LEARNING past half when other buckets run short', () => {
    const queue = composeQueue({
      candidates: candidates({ dueLearning: 40, newCards: 1 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(composition(queue)).toMatchObject({ dueLearning: 24, newCards: 1 });
  });

  it('lets reviews past their caps when other buckets run short', () => {
    const queue = composeQueue({
      candidates: candidates({ dueReinforcing: 100, newCards: 3 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(composition(queue)).toMatchObject({
      dueReinforcing: 22,
      newCards: 3,
    });
  });

  it('keeps NEW cards to their cap once the session reaches its minimum', () => {
    const queue = composeQueue({
      candidates: candidates({ dueReinforcing: 6, newCards: 100 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    // 5 NEW (20% of 25) and 6 reviews: 11, past the minimum of 10
    expect(composition(queue)).toMatchObject({
      dueReinforcing: 6,
      newCards: 5,
    });
  });

  it('studies all of a sparse deck, and nothing of an empty one', () => {
    const sparse = composeQueue({
      candidates: candidates({
        dueLearning: 1,
        dueReinforcing: 1,
        newCards: 1,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(sparse.sort()).toEqual(['L1', 'N1', 'R1']);
    expect(
      composeQueue({
        candidates: candidates({}),
        sessionType: 'DEEP',
        seed: 1,
      }),
    ).toEqual([]);
  });

  it('spreads NEW cards evenly through the session, in deck order', () => {
    const queue = composeQueue({
      candidates: candidates({ dueReinforcing: 20, newCards: 5 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    const newAt = queue.flatMap((id, i) => (id.startsWith('N') ? [i] : []));
    expect(newAt).toEqual([4, 8, 12, 16, 20]);
    expect(queue.filter((id) => id.startsWith('N'))).toEqual(ids('N', 5));
  });

  it('orders the same cards the same way for the same seed, and differently for another', () => {
    const queue = (seed: number) =>
      composeQueue({
        candidates: candidates({ dueLearning: 5, dueReinforcing: 20 }),
        sessionType: 'STANDARD',
        seed,
      });

    expect(queue(7)).toEqual(queue(7));
    expect(queue(8)).not.toEqual(queue(7));
    expect(queue(8).sort()).toEqual(queue(7).sort());
  });

  it('gives this seeded queue (golden)', () => {
    expect(
      composeQueue({
        candidates: candidates({
          dueLearning: 2,
          weakReinforcing: 1,
          dueReinforcing: 3,
          newCards: 2,
        }),
        sessionType: 'QUICK',
        seed: 42,
      }),
    ).toEqual(GOLDEN);
  });
});

describe('composeQueue in Drill Weakest', () => {
  const drill = (counts: Parameters<typeof candidates>[0]) =>
    composeQueue({
      candidates: candidates(counts),
      sessionType: 'STANDARD',
      studyMode: 'DRILL_WEAKEST',
      seed: 1,
    });

  it('fills 80% with weak cards and the rest with due LEARNING, never NEW', () => {
    expect(
      composition(
        drill({
          weakReinforcing: 40,
          dueLearning: 20,
          dueReinforcing: 40,
          newCards: 40,
        }),
      ),
    ).toEqual({
      weakReinforcing: 20,
      dueLearning: 5,
      dueReinforcing: 0,
      newCards: 0,
    });
  });

  it('gives due LEARNING the room weak cards leave, and due REINFORCING only what overflows', () => {
    expect(
      composition(
        drill({ weakReinforcing: 5, dueLearning: 20, dueReinforcing: 40 }),
      ),
    ).toEqual({
      weakReinforcing: 5,
      dueLearning: 20,
      dueReinforcing: 0,
      newCards: 0,
    });
    expect(
      composition(
        drill({ weakReinforcing: 5, dueLearning: 3, dueReinforcing: 40 }),
      ),
    ).toEqual({
      weakReinforcing: 5,
      dueLearning: 3,
      dueReinforcing: 17,
      newCards: 0,
    });
  });

  it('takes weak cards past 80% when nothing else is left', () => {
    expect(composition(drill({ weakReinforcing: 40 }))).toMatchObject({
      weakReinforcing: 25,
    });
  });

  it('has nothing to study in a deck of NEW cards', () => {
    expect(drill({ newCards: 40 })).toEqual([]);
  });

  it('gives this seeded queue (golden)', () => {
    expect(
      composeQueue({
        candidates: candidates({
          weakReinforcing: 12,
          dueLearning: 4,
          dueReinforcing: 4,
          newCards: 4,
        }),
        sessionType: 'QUICK',
        studyMode: 'DRILL_WEAKEST',
        seed: 42,
      }),
    ).toEqual(DRILL_GOLDEN);
  });
});

describe('composeQueue in Cram', () => {
  const cram = (counts: Parameters<typeof candidates>[0]) =>
    composeQueue({
      candidates: candidates(counts),
      sessionType: 'STANDARD',
      studyMode: 'CRAM',
      seed: 1,
    });

  it('gives NEW cards 40%, weak cards a tenth, and due LEARNING up to half', () => {
    expect(
      composition(
        cram({
          dueLearning: 20,
          weakReinforcing: 10,
          dueReinforcing: 40,
          newCards: 40,
        }),
      ),
    ).toEqual({
      newCards: 10,
      weakReinforcing: 2,
      dueLearning: 12,
      dueReinforcing: 1,
    });
  });

  it("gives due REINFORCING the reviews' room when there is no LEARNING", () => {
    expect(composition(cram({ dueReinforcing: 40, newCards: 40 }))).toEqual({
      newCards: 10,
      weakReinforcing: 0,
      dueLearning: 0,
      dueReinforcing: 15,
    });
  });

  it('fills a session with NEW cards when there is nothing to review, for coverage', () => {
    expect(cram({ newCards: 40 })).toEqual(ids('N', 25));
  });

  it('gives this seeded queue (golden)', () => {
    expect(
      composeQueue({
        candidates: candidates({
          dueLearning: 3,
          weakReinforcing: 2,
          dueReinforcing: 6,
          newCards: 8,
        }),
        sessionType: 'QUICK',
        studyMode: 'CRAM',
        seed: 42,
      }),
    ).toEqual(CRAM_GOLDEN);
  });
});

describe('Cram toward a date (#87)', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date('2026-11-02T12:00:00.000Z');
  const near = new Date('2026-11-03');
  const far = new Date('2026-12-14');

  describe('pacing', () => {
    // Reviewed some days ago, each on an 8-day interval
    const reviewedDaysAgo = [0.5, 1, 3, 4, 5, 6];
    const cards = reviewedDaysAgo.map((days, i) => ({
      id: `R${i + 1}`,
      dueAt: new Date(now.getTime() + (8 - days) * day),
      lastIntervalDays: 8,
    }));
    const quickQueue = (cramDate: Date | null) =>
      composeQueue({
        candidates: {
          ...candidates({}),
          dueReinforcing: cards
            .filter((card) => cramDueAt(card, cramDate) <= now)
            .map(({ id }) => id),
        },
        sessionType: 'QUICK',
        studyMode: 'CRAM',
        seed: 42,
      });

    it('gives this queue with no date, those past half their interval', () => {
      expect(quickQueue(null)).toEqual(['R6', 'R4', 'R5']);
    });

    it('gives this queue with a far date, which half their interval decides', () => {
      expect(quickQueue(far)).toEqual(['R6', 'R4', 'R5']);
    });

    it('gives this queue with a near date, which pulls in cards reviewed longer ago than half the days left', () => {
      // 1.5 days left, half of them 0.75: all but the card reviewed 0.5
      // days ago have gone that long
      expect(quickQueue(near)).toEqual(['R2', 'R6', 'R4', 'R3', 'R5']);
    });

    it('never counts a card due later than half its interval', () => {
      const card = {
        dueAt: new Date(now.getTime() + 2 * day),
        lastIntervalDays: 4,
      };

      expect(cramDueAt(card, far)).toEqual(cramDueAt(card, null));
      expect(cramDueAt(card, null)).toEqual(now);
    });

    it('counts a card with no interval due at its due time, whatever the date', () => {
      const card = { dueAt: now, lastIntervalDays: null };

      expect(cramDueAt(card, near)).toEqual(now);
    });

    it('counts a card due once the time since its review reaches half the days left from then', () => {
      // Reviewed at the start: 30 days to the end of the date, due after
      // 10, when 20 are left and half of them have gone by
      const reviewed = new Date('2026-11-14T00:00:00.000Z');
      const card = {
        dueAt: new Date(reviewed.getTime() + 60 * day),
        lastIntervalDays: 60,
      };

      expect(cramDueAt(card, new Date('2026-12-13'))).toEqual(
        new Date(reviewed.getTime() + 10 * day),
      );
    });

    it("counts a card reviewed on the date's own day due again later that day", () => {
      const noon = new Date('2026-11-03T12:00:00.000Z');
      const card = {
        dueAt: new Date(noon.getTime() + 4 * day),
        lastIntervalDays: 4,
      };

      expect(cramDueAt(card, near)).toEqual(
        new Date('2026-11-03T16:00:00.000Z'),
      );
    });
  });

  describe('the new-card share', () => {
    const cram = (
      counts: Parameters<typeof candidates>[0],
      newPerDay: number | null,
      sessionType: 'QUICK' | 'STANDARD' = 'STANDARD',
    ) =>
      composition(
        composeQueue({
          candidates: { ...candidates(counts), newPerDay },
          sessionType,
          studyMode: 'CRAM',
          seed: 1,
        }),
      );
    const backlog = { dueReinforcing: 40, weakReinforcing: 5, newCards: 40 };

    it('counts how many NEW cards a day reach the date, today and the date included', () => {
      expect(cramNewPerDay(86, far, now)).toBe(2);
      // 43 days: the 29 left in November, this one with them, and 14
      expect(cramNewPerDay(129, far, now)).toBe(3);
      expect(cramNewPerDay(130, far, now)).toBe(4);
      expect(cramNewPerDay(3, near, now)).toBe(2);
      expect(cramNewPerDay(3, new Date('2026-11-02'), now)).toBe(3);
      expect(cramNewPerDay(0, far, now)).toBe(0);
    });

    it('grows to the pace the date needs', () => {
      expect(cram(backlog, 15).newCards).toBe(15);
    });

    it("stays at Cram's 40% when the date needs fewer", () => {
      expect(cram(backlog, 3).newCards).toBe(10);
    });

    it('stays within the session, whatever the date needs', () => {
      expect(cram(backlog, 60)).toEqual({
        newCards: 25,
        weakReinforcing: 0,
        dueLearning: 0,
        dueReinforcing: 0,
      });
      expect(cram(backlog, 60, 'QUICK').newCards).toBe(12);
    });

    it('leaves reviews the room the NEW cards leave', () => {
      expect(cram(backlog, 20)).toEqual({
        newCards: 20,
        weakReinforcing: 2,
        dueLearning: 0,
        dueReinforcing: 3,
      });
    });

    it('leaves other modes as they are', () => {
      const study = (newPerDay: number | null) =>
        composeQueue({
          candidates: { ...candidates(backlog), newPerDay },
          sessionType: 'STANDARD',
          studyMode: 'STUDY',
          seed: 1,
        });

      expect(study(20)).toEqual(study(null));
    });
  });
});
