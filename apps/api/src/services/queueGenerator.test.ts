import { describe, expect, it } from 'vitest';
import { composeQueue, type QueueCandidates } from './queueGenerator.js';

/** Card ids "<prefix>1" to "<prefix>n", in priority order. */
function ids(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

function candidates(counts: Partial<Record<keyof QueueCandidates, number>>) {
  return {
    dueLearning: ids('L', counts.dueLearning ?? 0),
    dueStable: ids('S', counts.dueStable ?? 0),
    weakStable: ids('W', counts.weakStable ?? 0),
    newCards: ids('N', counts.newCards ?? 0),
  };
}

/** How many of each bucket a queue holds, by id prefix. */
function composition(queue: string[]) {
  const count = (prefix: string) =>
    queue.filter((id) => id.startsWith(prefix)).length;
  return {
    dueLearning: count('L'),
    dueStable: count('S'),
    weakStable: count('W'),
    newCards: count('N'),
  };
}

// A Quick session's queue for seed 42, recorded once: a change to it is a
// change to which cards a seed gives, or their order
const GOLDEN = ['L2', 'L1', 'N1', 'S2', 'S3', 'N2', 'W1', 'S1'];
// Drill Weakest's and Cram's Quick queues for seed 42, recorded likewise
// prettier-ignore
const DRILL_GOLDEN = ['L3', 'L1', 'W3', 'W8', 'W7', 'W9', 'W1', 'L2', 'W4', 'W6', 'W2', 'W5'];
// prettier-ignore
const CRAM_GOLDEN = ['L3', 'S4', 'N1', 'L2', 'N2', 'L1', 'S3', 'N3', 'S2', 'N4', 'W1', 'S1'];

describe('composeQueue', () => {
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
        weakStable: 8,
        dueStable: 40,
        newCards: 40,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    // NEW and weak at their 20% caps (5 of 25), every due LEARNING card,
    // and due STABLE the rest, under its 60% cap
    expect(composition(queue)).toEqual({
      dueLearning: 4,
      weakStable: 5,
      dueStable: 11,
      newCards: 5,
    });
  });

  it('takes the most urgent of each bucket', () => {
    const queue = composeQueue({
      candidates: candidates({
        dueLearning: 4,
        weakStable: 8,
        dueStable: 40,
        newCards: 40,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(queue.filter((id) => id.startsWith('W')).sort()).toEqual(
      ids('W', 5).sort(),
    );
    expect(queue.filter((id) => id.startsWith('S')).sort()).toEqual(
      ids('S', 11).sort(),
    );
  });

  it('gives NEW cards a tenth when shaky cards could fill half the session, due LEARNING up to half, past its share, leaving due STABLE some', () => {
    const queue = composeQueue({
      candidates: candidates({
        dueLearning: 20,
        weakStable: 10,
        dueStable: 40,
        newCards: 40,
      }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    // NEW 2 (a tenth of 25), weak 5 (its cap), due LEARNING 12 (half),
    // due STABLE the rest
    expect(composition(queue)).toEqual({
      dueLearning: 12,
      weakStable: 5,
      dueStable: 6,
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
    const backlog = candidates({ dueStable: 1000 });
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
    ).toEqual(ids('S', 25).sort());
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
      candidates: candidates({ dueStable: 100, newCards: 3 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(composition(queue)).toMatchObject({ dueStable: 22, newCards: 3 });
  });

  it('keeps NEW cards to their cap once the session reaches its minimum', () => {
    const queue = composeQueue({
      candidates: candidates({ dueStable: 6, newCards: 100 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    // 5 NEW (20% of 25) and 6 reviews: 11, past the minimum of 10
    expect(composition(queue)).toMatchObject({ dueStable: 6, newCards: 5 });
  });

  it('studies all of a sparse deck, and nothing of an empty one', () => {
    const sparse = composeQueue({
      candidates: candidates({ dueLearning: 1, dueStable: 1, newCards: 1 }),
      sessionType: 'STANDARD',
      seed: 1,
    });

    expect(sparse.sort()).toEqual(['L1', 'N1', 'S1']);
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
      candidates: candidates({ dueStable: 20, newCards: 5 }),
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
        candidates: candidates({ dueLearning: 5, dueStable: 20 }),
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
          weakStable: 1,
          dueStable: 3,
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
        drill({ weakStable: 40, dueLearning: 20, dueStable: 40, newCards: 40 }),
      ),
    ).toEqual({ weakStable: 20, dueLearning: 5, dueStable: 0, newCards: 0 });
  });

  it('gives due LEARNING the room weak cards leave, and due STABLE only what overflows', () => {
    expect(
      composition(drill({ weakStable: 5, dueLearning: 20, dueStable: 40 })),
    ).toEqual({ weakStable: 5, dueLearning: 20, dueStable: 0, newCards: 0 });
    expect(
      composition(drill({ weakStable: 5, dueLearning: 3, dueStable: 40 })),
    ).toEqual({ weakStable: 5, dueLearning: 3, dueStable: 17, newCards: 0 });
  });

  it('takes weak cards past 80% when nothing else is left', () => {
    expect(composition(drill({ weakStable: 40 }))).toMatchObject({
      weakStable: 25,
    });
  });

  it('has nothing to study in a deck of NEW cards', () => {
    expect(drill({ newCards: 40 })).toEqual([]);
  });

  it('gives this seeded queue (golden)', () => {
    expect(
      composeQueue({
        candidates: candidates({
          weakStable: 12,
          dueLearning: 4,
          dueStable: 4,
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
        cram({ dueLearning: 20, weakStable: 10, dueStable: 40, newCards: 40 }),
      ),
    ).toEqual({ newCards: 10, weakStable: 2, dueLearning: 12, dueStable: 1 });
  });

  it("gives due STABLE the reviews' room when there is no LEARNING", () => {
    expect(composition(cram({ dueStable: 40, newCards: 40 }))).toEqual({
      newCards: 10,
      weakStable: 0,
      dueLearning: 0,
      dueStable: 15,
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
          weakStable: 2,
          dueStable: 6,
          newCards: 8,
        }),
        sessionType: 'QUICK',
        studyMode: 'CRAM',
        seed: 42,
      }),
    ).toEqual(CRAM_GOLDEN);
  });
});
