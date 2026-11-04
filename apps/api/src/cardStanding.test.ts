import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  type PrismaClient,
  type RecallGrade,
  type StudyDirection,
  type StudyMode,
} from '@prisma/client';
import {
  createDeckWithCards,
  createTestPrisma,
  recordCardHistory,
  type HistoryAnswer,
} from './test-helpers.js';
import {
  applyCardAnswer,
  type CardStanding,
  readCardStanding,
  recordMarkedKnown,
  replayCardAnswers,
  resetCardProgress,
  startCardProgress,
} from './services/cardStanding.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const now = new Date('2026-11-02T12:00:00.000Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * day);

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
  const user = await prisma.user.create({
    data: { email: 'standing-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
});

afterAll(async () => {
  await cleanup();
});

/** A deck of cards "Card 1" to "Card n", answered "A1" to "An". */
function deckOf(n: number) {
  return createDeckWithCards(prisma, {
    userId,
    cards: Array.from({ length: n }, (_, i) => ({
      front: `Card ${i + 1}`,
      canonicalAnswers: [`A${i + 1}`],
    })),
  });
}

function history(
  cardId: string,
  answers: HistoryAnswer[],
  options: Omit<
    Parameters<typeof recordCardHistory>[1],
    'userId' | 'cardId' | 'answers'
  > = {},
) {
  return recordCardHistory(prisma, { userId, cardId, answers, ...options });
}

const nailed = (at: Date): HistoryAnswer => ({ grade: 'NAILED', at });
const missed = (at: Date): HistoryAnswer => ({ grade: 'MISSED', at });

/**
 * Nailed the day before `at` and again at `at`: REINFORCING from `at`, at
 * mastery 4, due 4 days later.
 */
const graduated = (at: Date): HistoryAnswer[] => [
  nailed(new Date(at.getTime() - day)),
  nailed(at),
];

/** Answers with these grades, a day apart, the last at `last`. */
function answers(grades: RecallGrade[], last = daysAgo(1)): HistoryAnswer[] {
  return grades.map((grade, i) => ({
    grade,
    at: new Date(last.getTime() - (grades.length - 1 - i) * day),
  }));
}

/** Nailed twice, so REINFORCING at mastery 4, then answered with `grades`. */
const reinforcing = (...grades: RecallGrade[]) =>
  answers(['NAILED', 'NAILED', ...grades]);

/** The standings read, each as `pick` gives it, by card id. */
async function byCard<T>(
  deckIds: string[],
  pick: (standing: CardStanding) => T,
  options = {},
) {
  const { cards } = await standing(deckIds, options);
  return Object.fromEntries(cards.map((card) => [card.cardId, pick(card)]));
}

function standing(deckIds: string[], options = {}) {
  return readCardStanding(prisma, { userId, deckIds, now, ...options });
}

describe('Card Standing', () => {
  it("reads each card's Lifecycle State and whether it's due", async () => {
    const deck = await deckOf(3);
    const [learning, unanswered, notDue] = deck.cards;
    // Missed 2 days ago: LEARNING, due again 30 minutes later
    await history(learning.id, [missed(daysAgo(2))]);
    // Nailed an hour ago: LEARNING, due in 2 days
    await history(notDue.id, [nailed(new Date(now.getTime() - hour))]);

    const { cards } = await standing([deck.id], { direction: 'FORWARD' });

    expect(
      cards.map(({ cardId, lifecycleState, isDue }) => ({
        cardId,
        lifecycleState,
        isDue,
      })),
    ).toEqual([
      { cardId: learning.id, lifecycleState: 'LEARNING', isDue: true },
      { cardId: unanswered.id, lifecycleState: 'NEW', isDue: false },
      { cardId: notDue.id, lifecycleState: 'LEARNING', isDue: false },
    ]);
  });

  it("gives each card's mastery band, never its score, and whether it's known already", async () => {
    const deck = await deckOf(3);
    const [unanswered, learning, graduatedCard] = deck.cards;
    await history(learning.id, [nailed(daysAgo(1))]);
    // Mastery 4
    await history(graduatedCard.id, reinforcing());

    const read = await byCard([deck.id], (card) => card);

    expect(read[unanswered.id]).toMatchObject({
      masteryBand: 'fragile',
      isKnown: false,
    });
    expect(read[learning.id]).toMatchObject({
      masteryBand: 'fragile',
      isKnown: false,
    });
    expect(read[graduatedCard.id]).toMatchObject({
      masteryBand: 'developing',
      isKnown: true,
    });
    expect(read[graduatedCard.id]).not.toHaveProperty('masteryScore');
  });

  it('counts the cards in each Lifecycle State, and the answered ones in each mastery band', async () => {
    const deck = await deckOf(4);
    const [, learning, graduated, missedAfter] = deck.cards;
    // Mastery 2, 4 and 1
    await history(learning.id, [nailed(daysAgo(1))]);
    await history(graduated.id, reinforcing());
    await history(missedAfter.id, reinforcing('MISSED'));

    const { counts } = await standing([deck.id]);

    expect(counts.lifecycle).toEqual({
      NEW: 1,
      LEARNING: 1,
      REINFORCING: 2,
      RETIRED: 0,
    });
    // The NEW card has no mastery to speak of
    expect(counts.bands).toEqual({
      fragile: 2,
      developing: 1,
      solid: 0,
      mastered: 0,
    });
  });

  it('reads several decks at once, each in deck order, in the order asked', async () => {
    const first = await deckOf(2);
    const second = await deckOf(2);
    await history(second.cards[1].id, [missed(daysAgo(1))]);

    const { cards } = await standing([second.id, first.id]);

    expect(cards.map(({ cardId, deckId }) => ({ cardId, deckId }))).toEqual([
      { cardId: second.cards[0].id, deckId: second.id },
      { cardId: second.cards[1].id, deckId: second.id },
      { cardId: first.cards[0].id, deckId: first.id },
      { cardId: first.cards[1].id, deckId: first.id },
    ]);
  });

  describe('the cards asked for', () => {
    it('reads them alone, by the same rules as a deck', async () => {
      const deck = await deckOf(3);
      const [leftOut, missedCard, unanswered] = deck.cards;
      await history(leftOut.id, [missed(daysAgo(1))]);
      // Missed a day ago: LEARNING, due again 30 minutes later
      await history(missedCard.id, [missed(daysAgo(1))]);

      const { cards, counts } = await readCardStanding(prisma, {
        userId,
        cardIds: [missedCard.id, unanswered.id],
        direction: 'FORWARD',
        now,
      });

      expect(
        cards.map(({ cardId, lifecycleState, isDue, dueAt }) => ({
          cardId,
          lifecycleState,
          isDue,
          dueAt,
        })),
      ).toEqual([
        {
          cardId: missedCard.id,
          lifecycleState: 'LEARNING',
          isDue: true,
          dueAt: new Date(daysAgo(1).getTime() + hour / 2),
        },
        {
          cardId: unanswered.id,
          lifecycleState: 'NEW',
          isDue: false,
          dueAt: null,
        },
      ]);
      // The card left out's miss isn't counted
      expect(counts.answers.MISSED).toBe(1);
    });

    it("has no Reverse standing while their deck isn't reversible", async () => {
      const [card] = (await deckOf(1)).cards;

      const { cards } = await readCardStanding(prisma, {
        userId,
        cardIds: [card.id],
        direction: 'REVERSE',
        now,
      });

      expect(cards).toEqual([]);
    });

    it("reads only the learner's own cards", async () => {
      const [card] = (await deckOf(1)).cards;
      const someoneElse = await prisma.user.create({
        data: { email: 'standing-other@example.com', passwordHash: 'x' },
      });

      const { cards } = await readCardStanding(prisma, {
        userId: someoneElse.id,
        cardIds: [card.id],
        now,
      });

      expect(cards).toEqual([]);
    });
  });

  describe('Reverse', () => {
    it("has no standing while its deck isn't reversible", async () => {
      const deck = await deckOf(1);
      const [card] = deck.cards;

      const directions = async () =>
        (await standing([deck.id])).cards.map(({ direction }) => direction);

      expect(await directions()).toEqual(['FORWARD']);
      expect(
        (await standing([deck.id], { direction: 'REVERSE' })).cards,
      ).toEqual([]);

      await prisma.deck.update({
        where: { id: deck.id },
        data: { reversible: true },
      });
      expect(await directions()).toEqual(['FORWARD', 'REVERSE']);
      expect(
        (await standing([deck.id], { direction: 'REVERSE' })).cards,
      ).toMatchObject([{ cardId: card.id, direction: 'REVERSE' }]);
    });
  });

  describe('Due', () => {
    it('counts a card due in Cram once half its interval has passed, but not before', async () => {
      const deck = await deckOf(2);
      const [halfway, early] = deck.cards;
      // 4-day intervals: three quarters gone, and one quarter
      await history(halfway.id, graduated(daysAgo(3)));
      await history(early.id, graduated(daysAgo(1)));

      const due = async (studyMode: StudyMode) =>
        (await standing([deck.id], { studyMode })).cards.map(
          ({ isDue }) => isDue,
        );

      expect(await due('CRAM')).toEqual([true, false]);
      expect(await due('STUDY')).toEqual([false, false]);
      expect(await due('DRILL_WEAKEST')).toEqual([false, false]);
    });

    describe('with a Cram Date (#87)', () => {
      const untilInTwoDays = new Date('2026-11-04');

      /**
       * A deck with a Cram Date and three cards: two on 4-day intervals,
       * reviewed a day ago and 6 hours ago, and one NEW.
       */
      async function pacedDeck(cramUntil: Date) {
        const deck = await deckOf(3);
        const [early, soon] = deck.cards;
        await prisma.deck.update({
          where: { id: deck.id },
          data: { cramUntil },
        });
        await history(early.id, graduated(daysAgo(1)));
        await history(soon.id, graduated(new Date(now.getTime() - 6 * hour)));
        return deck;
      }

      it('reads a card as due and when, by half the days left when reviewed', async () => {
        // Ends 60 hours from now. Reviewed 24 hours ago: 84 left then, so
        // 42 after it, 18 from now. Half its 4-day interval is 48 after it,
        // so the date comes first
        const deck = await pacedDeck(untilInTwoDays);

        const { cards, counts, nextDueAt } = await standing([deck.id], {
          studyMode: 'CRAM',
        });

        expect(cards.map(({ dueAt }) => dueAt)).toEqual([
          new Date(now.getTime() + 18 * hour),
          new Date(now.getTime() + 27 * hour),
          null,
        ]);
        expect(counts.due).toBe(0);
        expect(nextDueAt).toEqual(new Date(now.getTime() + 18 * hour));
      });

      it('reads a card due once that much has passed', async () => {
        const deck = await pacedDeck(untilInTwoDays);

        const { cards, counts } = await standing([deck.id], {
          studyMode: 'CRAM',
          now: new Date(now.getTime() + 18 * hour),
        });

        expect(cards.map(({ isDue }) => isDue)).toEqual([true, false, false]);
        expect(counts.due).toBe(1);
      });

      it("isn't read by any other Study Mode", async () => {
        const deck = await pacedDeck(untilInTwoDays);
        const dueAt = (studyMode: StudyMode, at: Date) =>
          standing([deck.id], { studyMode, now: at }).then(({ cards }) =>
            cards.map(({ dueAt }) => dueAt),
          );

        expect(await dueAt('DRILL_WEAKEST', now)).toEqual(
          await dueAt('STUDY', now),
        );
        expect((await standing([deck.id])).newPerDay).toBeNull();
      });

      it('says how many NEW cards a day reach the date, in Cram', async () => {
        const deck = await deckOf(9);
        await prisma.deck.update({
          where: { id: deck.id },
          data: { cramUntil: untilInTwoDays },
        });

        const { newPerDay } = await standing([deck.id], { studyMode: 'CRAM' });

        expect(newPerDay).toBe(3);
      });

      it('reads a date that has passed as none', async () => {
        const deck = await pacedDeck(new Date('2026-11-01'));
        const dated = await standing([deck.id], { studyMode: 'CRAM' });

        await prisma.deck.update({
          where: { id: deck.id },
          data: { cramUntil: null },
        });
        const undated = await standing([deck.id], { studyMode: 'CRAM' });

        expect(dated).toEqual(undated);
        expect(dated.newPerDay).toBeNull();
      });

      it('paces each deck by its own date', async () => {
        const dated = await pacedDeck(untilInTwoDays);
        const undated = await deckOf(1);
        await history(undated.cards[0].id, graduated(daysAgo(1)));

        const { cards } = await standing([dated.id, undated.id], {
          studyMode: 'CRAM',
        });

        expect(cards[0].dueAt).toEqual(new Date(now.getTime() + 18 * hour));
        // Half its 4-day interval, 1 day of it gone
        expect(cards[3].dueAt).toEqual(new Date(now.getTime() + day));
      });
    });

    it('gives each card in review its next due time in the Study Mode, and a NEW card none', async () => {
      const deck = await deckOf(2);
      const [inThreeDays] = deck.cards;
      // A 4-day interval, 1 day gone: due in 3 days, halfway in 1
      await history(inThreeDays.id, graduated(daysAgo(1)));
      const dueAt = (studyMode: StudyMode) =>
        byCard([deck.id], (card) => card.dueAt, { studyMode });

      expect(Object.values(await dueAt('STUDY'))).toEqual([
        new Date(now.getTime() + 3 * day),
        null,
      ]);
      expect(Object.values(await dueAt('CRAM'))).toEqual([
        new Date(now.getTime() + day),
        null,
      ]);
    });

    it('says when the next card not yet due comes due in the Study Mode, if any', async () => {
      const deck = await deckOf(3);
      const [alreadyDue, inThreeDays] = deck.cards;
      await history(alreadyDue.id, [missed(daysAgo(1))]);
      // A 4-day interval, 1 day gone: due in 3 days, halfway in 1
      await history(inThreeDays.id, graduated(daysAgo(1)));
      const nextDueAt = async (studyMode: StudyMode) =>
        (await standing([deck.id], { studyMode })).nextDueAt;

      expect(await nextDueAt('STUDY')).toEqual(
        new Date(now.getTime() + 3 * day),
      );
      expect(await nextDueAt('CRAM')).toEqual(new Date(now.getTime() + day));
      expect((await standing([(await deckOf(1)).id])).nextDueAt).toBeNull();
    });
  });

  it('lists the due cards most overdue first, and counts due and NEW cards', async () => {
    const deck = await deckOf(5);
    // Card 2 stays NEW
    const [missedYesterday, , weak, missedEarlier, notDue] = deck.cards;
    // Missed a day ago: LEARNING, due 30 minutes later
    await history(missedYesterday.id, [missed(daysAgo(1))]);
    // Mastery 1 after missing a day ago: Weak, due 6 hours later
    await history(weak.id, reinforcing('MISSED'));
    await history(missedEarlier.id, [missed(daysAgo(3))]);
    await history(notDue.id, [nailed(new Date(now.getTime() - hour))]);

    const { due, counts } = await standing([deck.id]);

    expect(due.map(({ cardId }) => cardId)).toEqual([
      missedEarlier.id,
      missedYesterday.id,
      weak.id,
    ]);
    expect(counts).toMatchObject({ due: 3 });
    expect(counts.lifecycle.NEW).toBe(1);
  });

  it(
    'considers every card, however many are due',
    { timeout: 20_000 },
    async () => {
      const deck = await deckOf(205);
      // Independent, so recorded at once
      await Promise.all(
        deck.cards.map((card) => history(card.id, [missed(daysAgo(1))])),
      );

      const { due, counts } = await standing([deck.id]);

      expect(due).toHaveLength(205);
      expect(counts.due).toBe(205);
    },
  );

  describe('Counted Answers', () => {
    it("tallies each card's by Recall Grade, and the read's together", async () => {
      const deck = await deckOf(2);
      const [retried, reset] = deck.cards;
      // A miss with its Retry nailed, then a Good and a Nailed
      await history(retried.id, [
        missed(daysAgo(4)),
        { grade: 'NAILED', at: daysAgo(3.9), retry: true },
        { grade: 'GOOD', at: daysAgo(3) },
        nailed(daysAgo(2)),
      ]);
      // Two misses, a reset, then a Nailed
      await history(
        reset.id,
        answers(['MISSED', 'MISSED', 'NAILED'], daysAgo(3)),
        {
          resetAt: daysAgo(3.5),
        },
      );

      const read = await standing([deck.id]);

      expect(
        Object.fromEntries(
          read.cards.map(({ cardId, countedAnswers }) => [
            cardId,
            countedAnswers,
          ]),
        ),
      ).toEqual({
        [retried.id]: { MISSED: 1, PARTIALLY_CORRECT: 0, GOOD: 1, NAILED: 1 },
        [reset.id]: { MISSED: 0, PARTIALLY_CORRECT: 0, GOOD: 0, NAILED: 1 },
      });
      expect(read.counts.answers).toEqual({
        MISSED: 1,
        PARTIALLY_CORRECT: 0,
        GOOD: 1,
        NAILED: 2,
      });
    });

    it("leaves out a Retry's miss", async () => {
      const deck = await deckOf(1);
      const [card] = deck.cards;
      // A miss, then its Retry missed too, in the same session
      const missedTwice = reinforcing('NAILED', 'NAILED', 'MISSED');
      missedTwice.push({ grade: 'MISSED', at: daysAgo(0.5), retry: true });
      await history(card.id, missedTwice);

      expect(
        await byCard([deck.id], ({ isWeak, recentMisses }) => ({
          isWeak,
          recentMisses,
        })),
      ).toEqual({ [card.id]: { isWeak: false, recentMisses: 1 } });
    });

    it("leaves out answers from before the card's progress last reset", async () => {
      const deck = await deckOf(1);
      const [card] = deck.cards;
      // Two misses, a reset, then nailed into REINFORCING at mastery 6
      await history(
        card.id,
        answers(['MISSED', 'MISSED', 'NAILED', 'NAILED', 'NAILED']),
        { resetAt: daysAgo(3.5) },
      );

      expect(
        await byCard([deck.id], ({ lifecycleState, isWeak, recentMisses }) => ({
          lifecycleState,
          isWeak,
          recentMisses,
        })),
      ).toEqual({
        [card.id]: {
          lifecycleState: 'REINFORCING',
          isWeak: false,
          recentMisses: 0,
        },
      });
    });
  });

  describe('Weak', () => {
    it('takes a REINFORCING card with mastery 3 or less, but not 4', async () => {
      const deck = await deckOf(2);
      const [three, four] = deck.cards;
      // Mastery 4, then 6, then a miss takes 3: still REINFORCING
      await history(three.id, reinforcing('NAILED', 'MISSED'));
      await history(four.id, reinforcing());

      expect(
        await byCard([deck.id], ({ lifecycleState, isWeak }) => ({
          lifecycleState,
          isWeak,
        })),
      ).toEqual({
        [three.id]: { lifecycleState: 'REINFORCING', isWeak: true },
        [four.id]: { lifecycleState: 'REINFORCING', isWeak: false },
      });
    });

    it('leaves out a card Marked Known since it was last answered, until answered again', async () => {
      const deck = await deckOf(2);
      const [markedSince, answeredSince] = deck.cards;
      // Missed while LEARNING, then marked known: REINFORCING at mastery 3
      await history(markedSince.id, [missed(daysAgo(3))], {
        markedKnownAt: daysAgo(2),
      });
      // And then missed again: mastery 0
      await history(
        answeredSince.id,
        [missed(daysAgo(3)), missed(daysAgo(1))],
        {
          markedKnownAt: daysAgo(2),
        },
      );

      expect(
        await byCard([deck.id], ({ lifecycleState, isWeak }) => ({
          lifecycleState,
          isWeak,
        })),
      ).toEqual({
        [markedSince.id]: { lifecycleState: 'REINFORCING', isWeak: false },
        [answeredSince.id]: { lifecycleState: 'REINFORCING', isWeak: true },
      });
    });

    it('ranks Weak cards by recent misses, then mastery, then how overdue', async () => {
      const deck = await deckOf(5);
      const [lessOverdue, moreOverdue, lowMastery, twoMisses, notWeak] =
        deck.cards;
      // Mastery 3 and a miss each, one due 2 days before the other
      await history(lessOverdue.id, reinforcing('NAILED', 'MISSED'));
      await history(
        moreOverdue.id,
        answers(['NAILED', 'NAILED', 'NAILED', 'MISSED'], daysAgo(3)),
      );
      // Mastery 1 and a miss
      await history(lowMastery.id, reinforcing('MISSED'));
      // Mastery 7 and 2 misses
      await history(
        twoMisses.id,
        reinforcing(
          'NAILED',
          'NAILED',
          'NAILED',
          'MISSED',
          'NAILED',
          'NAILED',
          'MISSED',
        ),
      );
      await history(notWeak.id, reinforcing());

      const { weak } = await standing([deck.id]);

      expect(weak.map(({ cardId }) => cardId)).toEqual([
        twoMisses.id,
        lowMastery.id,
        moreOverdue.id,
        lessOverdue.id,
      ]);
    });

    it('takes one missed twice in its last 5 Counted Answers, but not 6', async () => {
      const deck = await deckOf(2);
      const [inFive, inSix] = deck.cards;
      // Mastery 7 or more throughout, and never 2 misses in 3
      await history(
        inFive.id,
        reinforcing(
          'NAILED',
          'NAILED',
          'NAILED',
          'MISSED',
          'NAILED',
          'NAILED',
          'MISSED',
        ),
      );
      await history(
        inSix.id,
        reinforcing(
          'NAILED',
          'NAILED',
          'NAILED',
          'MISSED',
          'NAILED',
          'NAILED',
          'NAILED',
          'NAILED',
          'MISSED',
        ),
      );

      expect(
        await byCard([deck.id], ({ lifecycleState, isWeak, recentMisses }) => ({
          lifecycleState,
          isWeak,
          recentMisses,
        })),
      ).toEqual({
        [inFive.id]: {
          lifecycleState: 'REINFORCING',
          isWeak: true,
          recentMisses: 2,
        },
        [inSix.id]: {
          lifecycleState: 'REINFORCING',
          isWeak: false,
          recentMisses: 1,
        },
      });
    });
  });
});

describe('changing card progress through Card Standing', () => {
  // Cards are created now, so their answers come after, on the real clock
  const minutesFromNow = (minutes: number) =>
    new Date(Date.now() + minutes * 60 * 1000);
  /** An attempt at a card, recorded in a finished Study Session. */
  async function attempt(
    deckId: string,
    cardId: string,
    grade: RecallGrade,
    at: Date,
    {
      isRetry = false,
      studySessionId,
      direction = 'FORWARD',
    }: {
      isRetry?: boolean;
      studySessionId?: string;
      direction?: StudyDirection;
    } = {},
  ) {
    const sessionId =
      studySessionId ??
      (
        await prisma.studySession.create({
          data: {
            userId,
            deckId,
            sessionType: 'STANDARD',
            status: 'COMPLETED',
            startedAt: at,
            endedAt: at,
          },
        })
      ).id;
    return prisma.cardAttempt.create({
      data: {
        studySessionId: sessionId,
        cardId,
        direction,
        recallGrade: grade,
        attemptNumber: isRetry ? 2 : 1,
        isRetry,
        createdAt: at,
      },
    });
  }

  /** A card's standing an hour from now, without its ids, to compare. */
  async function standingOf(deckId: string, cardId: string) {
    const { cards } = await standing([deckId], { now: minutesFromNow(60) });
    const card = cards.find((card) => card.cardId === cardId)!;
    return {
      direction: card.direction,
      lifecycleState: card.lifecycleState,
      masteryBand: card.masteryBand,
      isKnown: card.isKnown,
      isDue: card.isDue,
      isWeak: card.isWeak,
      recentMisses: card.recentMisses,
    };
  }

  it('applies an answer, and records a Retry without changing anything', async () => {
    const deck = await deckOf(1);
    const [card] = deck.cards;
    const first = await attempt(deck.id, card.id, 'MISSED', minutesFromNow(1));

    await applyCardAnswer(prisma, { userId, attempt: first });
    const afterAnswer = await standingOf(deck.id, card.id);
    const retry = await attempt(deck.id, card.id, 'NAILED', minutesFromNow(2), {
      isRetry: true,
      studySessionId: first.studySessionId,
    });
    await applyCardAnswer(prisma, { userId, attempt: retry });

    // Missed: LEARNING, due 30 minutes later
    expect(afterAnswer).toMatchObject({
      lifecycleState: 'LEARNING',
      isDue: true,
      recentMisses: 1,
    });
    expect(await standingOf(deck.id, card.id)).toEqual(afterAnswer);
  });

  /** Answers a card in a session of its own, applying the answer. */
  async function answered(
    deckId: string,
    cardId: string,
    grade: RecallGrade,
    at: Date,
  ) {
    const recorded = await attempt(deckId, cardId, grade, at);
    await applyCardAnswer(prisma, { userId, attempt: recorded });
    return recorded;
  }

  const markedKnown = (cardIds: string[], at: Date) =>
    recordMarkedKnown(prisma, {
      userId,
      cardIds,
      directions: ['FORWARD'],
      at,
    });

  it('marks NEW and LEARNING cards known, leaving known ones as they are', async () => {
    const deck = await deckOf(3);
    const [unanswered, learning, graduated] = deck.cards;
    await answered(deck.id, learning.id, 'MISSED', minutesFromNow(1));
    await answered(deck.id, graduated.id, 'NAILED', minutesFromNow(1));
    await answered(deck.id, graduated.id, 'NAILED', minutesFromNow(2));

    const marked = await markedKnown(
      deck.cards.map(({ id }) => id),
      minutesFromNow(3),
    );

    expect(marked).toBe(2);
    for (const card of [unanswered, learning]) {
      // Mastery raised to 3, due 5 days on
      expect(await standingOf(deck.id, card.id)).toMatchObject({
        lifecycleState: 'REINFORCING',
        masteryBand: 'developing',
        isKnown: true,
        isDue: false,
      });
    }
  });

  it('replays a re-graded answer, keeping a Marked Known before or after it', async () => {
    const deck = await deckOf(4);
    const [beforeMark, asIfBefore, afterMark, asIfAfter] = deck.cards;
    // Each answered, marked known, then answered again
    const history = async (
      cardId: string,
      grades: [RecallGrade, RecallGrade],
    ) => {
      const first = await answered(
        deck.id,
        cardId,
        grades[0],
        minutesFromNow(1),
      );
      await markedKnown([cardId], minutesFromNow(2));
      const second = await answered(
        deck.id,
        cardId,
        grades[1],
        minutesFromNow(3),
      );
      return [first, second];
    };
    const [missedBefore] = await history(beforeMark.id, ['MISSED', 'MISSED']);
    await history(asIfBefore.id, ['NAILED', 'MISSED']);
    const [, missedAfter] = await history(afterMark.id, ['MISSED', 'MISSED']);
    await history(asIfAfter.id, ['MISSED', 'NAILED']);

    for (const missed of [missedBefore, missedAfter]) {
      await prisma.cardAttempt.update({
        where: { id: missed.id },
        data: { recallGrade: 'NAILED' },
      });
      await replayCardAnswers(prisma, {
        userId,
        cardId: missed.cardId,
        direction: 'FORWARD',
      });
    }

    expect(await standingOf(deck.id, beforeMark.id)).toEqual(
      await standingOf(deck.id, asIfBefore.id),
    );
    expect(await standingOf(deck.id, afterMark.id)).toEqual(
      await standingOf(deck.id, asIfAfter.id),
    );
    // Still known from the mark
    expect(await standingOf(deck.id, beforeMark.id)).toMatchObject({
      lifecycleState: 'REINFORCING',
    });
  });

  it('starts a new card NEW in each Study Direction', async () => {
    const deck = await deckOf(0);
    await prisma.deck.update({
      where: { id: deck.id },
      data: { reversible: true },
    });
    const card = await prisma.card.create({
      data: { deckId: deck.id, front: 'Card 1', position: 0 },
    });

    await startCardProgress(prisma, {
      userId,
      deckId: deck.id,
      cardId: card.id,
      startedAt: new Date(),
    });

    expect(
      (await standing([deck.id])).cards.map(
        ({ direction, lifecycleState }) => ({
          direction,
          lifecycleState,
        }),
      ),
    ).toEqual([
      { direction: 'FORWARD', lifecycleState: 'NEW' },
      { direction: 'REVERSE', lifecycleState: 'NEW' },
    ]);
  });

  it('resets a card to NEW in every Study Direction, so only answers since count', async () => {
    const deck = await deckOf(1);
    await prisma.deck.update({
      where: { id: deck.id },
      data: { reversible: true },
    });
    const [card] = deck.cards;
    for (const direction of ['FORWARD', 'REVERSE'] as const) {
      const missed = await attempt(
        deck.id,
        card.id,
        'MISSED',
        minutesFromNow(1),
        {
          direction,
        },
      );
      await applyCardAnswer(prisma, { userId, attempt: missed });
    }
    const byDirection = async () =>
      (await standing([deck.id], { now: minutesFromNow(60) })).cards.map(
        ({ direction, lifecycleState, recentMisses }) => ({
          direction,
          lifecycleState,
          recentMisses,
        }),
      );

    await resetCardProgress(prisma, {
      cardId: card.id,
      resetAt: minutesFromNow(2),
    });
    const afterReset = await byDirection();
    await answered(deck.id, card.id, 'NAILED', minutesFromNow(3));

    expect(afterReset).toEqual([
      { direction: 'FORWARD', lifecycleState: 'NEW', recentMisses: 0 },
      { direction: 'REVERSE', lifecycleState: 'NEW', recentMisses: 0 },
    ]);
    expect(await byDirection()).toEqual([
      { direction: 'FORWARD', lifecycleState: 'LEARNING', recentMisses: 0 },
      { direction: 'REVERSE', lifecycleState: 'NEW', recentMisses: 0 },
    ]);
  });
});
