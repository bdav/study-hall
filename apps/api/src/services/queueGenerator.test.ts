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
