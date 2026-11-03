import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PrismaClient, type RecallGrade } from '@prisma/client';
import {
  createDeckWithCards,
  createTestPrisma,
  recordCardHistory,
  type HistoryAnswer,
} from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;

const day = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
  const user = await prisma.user.create({
    data: { email: 'stats-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
});

afterAll(async () => {
  await cleanup();
});

function createCaller(overrideUserId?: string) {
  return appRouter.createCaller({
    prisma,
    userId: overrideUserId ?? userId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

/** A deck of cards "Card 1" to "Card n", answered "A1" to "An". */
function deckOf(n: number, name = 'Stats Deck') {
  return createDeckWithCards(prisma, {
    userId,
    name,
    cards: Array.from({ length: n }, (_, i) => ({
      front: `Card ${i + 1}`,
      canonicalAnswers: [`A${i + 1}`],
    })),
  });
}

function history(
  cardId: string,
  answers: HistoryAnswer[],
  options: { resetAt?: Date } = {},
) {
  return recordCardHistory(prisma, { userId, cardId, answers, ...options });
}

/** Answers with these grades, a day apart, the last a day ago. */
function answers(grades: RecallGrade[]): HistoryAnswer[] {
  return grades.map((grade, i) => ({
    grade,
    at: daysAgo(grades.length - i),
  }));
}

describe('statsRouter', () => {
  describe('deckStats', () => {
    it('counts Counted Answers by Recall Grade, with accuracy over them', async () => {
      const deck = await deckOf(2);
      const [retried, reset] = deck.cards;
      // A miss with its Retry right, then a Good
      await history(retried.id, [
        { grade: 'MISSED', at: daysAgo(3) },
        { grade: 'NAILED', at: daysAgo(2.9), retry: true },
        { grade: 'GOOD', at: daysAgo(2) },
      ]);
      // Two misses, a reset, then a Nailed
      await history(reset.id, answers(['MISSED', 'MISSED', 'NAILED']), {
        resetAt: daysAgo(1.5),
      });

      const stats = await createCaller().stats.deckStats({ deckId: deck.id });

      expect(stats.answers).toEqual({
        MISSED: 1,
        PARTIALLY_CORRECT: 0,
        GOOD: 1,
        NAILED: 1,
      });
      expect(stats.answerCount).toBe(3);
      expect(stats.accuracy).toBeCloseTo(2 / 3, 5);
    });

    it('counts the cards in each Lifecycle State and mastery band', async () => {
      const deck = await deckOf(3);
      const [learning, graduated] = deck.cards;
      // Mastery 2, and 4
      await history(learning.id, answers(['NAILED']));
      await history(graduated.id, answers(['NAILED', 'NAILED']));

      const stats = await createCaller().stats.deckStats({ deckId: deck.id });

      expect(stats.lifecycle).toEqual({
        NEW: 1,
        LEARNING: 1,
        REINFORCING: 1,
        RETIRED: 0,
      });
      expect(stats.bands).toEqual({
        fragile: 1,
        developing: 1,
        solid: 0,
        mastered: 0,
      });
      // Counts, never a card's mastery score
      expect(JSON.stringify(stats)).not.toMatch(/mastery/i);
    });

    it('lists the Weak cards Drill Weakest would take, ranked, with what they ask', async () => {
      const deck = await deckOf(3);
      const [lowMastery, twoMisses, notWeak] = deck.cards;
      // Mastery 1 after a miss, and mastery 7 with 2 misses in its last 5
      await history(lowMastery.id, answers(['NAILED', 'NAILED', 'MISSED']));
      await history(
        twoMisses.id,
        answers([
          'NAILED',
          'NAILED',
          'NAILED',
          'NAILED',
          'NAILED',
          'MISSED',
          'NAILED',
          'NAILED',
          'MISSED',
        ]),
      );
      await history(notWeak.id, answers(['NAILED', 'NAILED']));
      const caller = createCaller();

      const stats = await caller.stats.deckStats({ deckId: deck.id });
      const drill = await caller.study.startSession({
        deckId: deck.id,
        studyMode: 'DRILL_WEAKEST',
      });

      expect(stats.weakCount).toBe(2);
      expect(stats.weakCards).toMatchObject([
        {
          cardId: twoMisses.id,
          direction: 'FORWARD',
          question: 'Card 2',
          recentMisses: 2,
        },
        {
          cardId: lowMastery.id,
          direction: 'FORWARD',
          question: 'Card 1',
          recentMisses: 1,
        },
      ]);
      expect(drill!.items.map((item) => item.cardId).sort()).toEqual(
        stats.weakCards.map((card) => card.cardId).sort(),
      );
    });

    it('lists recent Study Sessions, newest first, finished or abandoned', async () => {
      // Cards still NEW after each session, so another can start
      const deck = await deckOf(4);
      const caller = createCaller();
      const finished = await caller.study.startSession({
        deckId: deck.id,
        sessionType: 'QUICK',
        studyMode: 'CRAM',
      });
      const [first, second] = finished!.items;
      await caller.study.submitAnswer({ itemId: first.id, userAnswer: 'A1' });
      await caller.study.dontKnow({ itemId: second.id });
      await caller.study.finishSession({ id: finished!.id });
      const abandoned = await caller.study.startSession({ deckId: deck.id });
      await caller.study.abandonSession({ id: abandoned!.id });
      // Under way, so not listed
      await caller.study.startSession({ deckId: deck.id });

      const { sessions } = await caller.stats.deckStats({ deckId: deck.id });

      expect(sessions).toMatchObject([
        {
          id: abandoned!.id,
          sessionType: 'STANDARD',
          studyMode: 'STUDY',
          status: 'ABANDONED',
          answered: 0,
          right: 0,
        },
        {
          id: finished!.id,
          sessionType: 'QUICK',
          studyMode: 'CRAM',
          status: 'COMPLETED',
          answered: 2,
          right: 1,
        },
      ]);
      expect(sessions[0].startedAt).toBeInstanceOf(Date);
    });

    it('has nothing to show for a deck never studied', async () => {
      const deck = await deckOf(2);

      const stats = await createCaller().stats.deckStats({ deckId: deck.id });

      expect(stats).toMatchObject({
        answerCount: 0,
        accuracy: 0,
        weakCards: [],
        sessions: [],
      });
    });

    it('throws NOT_FOUND for a nonexistent deck', async () => {
      await expect(
        createCaller().stats.deckStats({ deckId: 'nonexistent-id' }),
      ).rejects.toThrow(/not found/i);
    });

    it('throws NOT_FOUND for a deck owned by another user', async () => {
      const otherUser = await prisma.user.create({
        data: { email: 'other-stats@example.com', passwordHash: 'fakehash' },
      });
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Stats Deck', userId: otherUser.id },
      });

      await expect(
        createCaller().stats.deckStats({ deckId: otherDeck.id }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('overallStats', () => {
    it("adds up the active decks, naming each Weak card and session's deck and course", async () => {
      const userA = await prisma.user.create({
        data: { email: 'overall-a@example.com', passwordHash: 'x' },
      });
      const caller = createCaller(userA.id);
      const plain = await createDeckWithCards(prisma, {
        userId: userA.id,
        name: 'Capitals',
        cards: [{ front: 'Capital of France', canonicalAnswers: ['Paris'] }],
      });
      const courseDeck = await createDeckWithCards(prisma, {
        userId: userA.id,
        name: 'Italian',
        cards: [{ front: 'Hello', canonicalAnswers: ['Ciao'] }],
      });
      const course = await prisma.course.create({
        data: {
          userId: userA.id,
          title: 'Italian for travel',
          topic: 'Italian',
          goal: 'A2',
          priorKnowledge: '',
          minutesPerWeek: 60,
          sessionMinutes: 20,
          depth: 'Balanced',
          notes: '',
        },
      });
      await prisma.deck.update({
        where: { id: courseDeck.id },
        data: { courseId: course.id },
      });
      // Weak: mastery 1 after a miss
      await recordCardHistory(prisma, {
        userId: userA.id,
        cardId: courseDeck.cards[0].id,
        answers: answers(['NAILED', 'NAILED', 'MISSED']),
      });
      await recordCardHistory(prisma, {
        userId: userA.id,
        cardId: plain.cards[0].id,
        answers: answers(['NAILED']),
      });

      const stats = await caller.stats.overallStats();

      expect(stats.answers).toEqual({
        MISSED: 1,
        PARTIALLY_CORRECT: 0,
        GOOD: 0,
        NAILED: 3,
      });
      expect(stats).toMatchObject({
        answerCount: 4,
        accuracy: 0.75,
        deckCount: 2,
        weakCount: 1,
      });
      expect(stats.lifecycle).toEqual({
        NEW: 0,
        LEARNING: 1,
        REINFORCING: 1,
        RETIRED: 0,
      });
      // Mastery 2, and 1
      expect(stats.bands).toEqual({
        fragile: 2,
        developing: 0,
        solid: 0,
        mastered: 0,
      });
      expect(stats.weakCards).toMatchObject([
        {
          question: 'Hello',
          recentMisses: 1,
          deck: {
            id: courseDeck.id,
            name: 'Italian',
            course: { title: 'Italian for travel' },
          },
        },
      ]);
      expect(stats.sessions).toHaveLength(4);
      expect(stats.sessions[0]).toMatchObject({
        deck: { id: plain.id, name: 'Capitals', course: null },
      });
      expect(stats.sessions.at(-1)).toMatchObject({
        deck: { name: 'Italian', course: { title: 'Italian for travel' } },
      });
    });

    it('stops counting a card once it is edited', async () => {
      const userB = await prisma.user.create({
        data: { email: 'overall-b@example.com', passwordHash: 'x' },
      });
      const deck = await createDeckWithCards(prisma, {
        userId: userB.id,
        cards: [{ front: '5+5', canonicalAnswers: ['11'] }],
      });
      const cardId = deck.cards[0].id;
      await recordCardHistory(prisma, {
        userId: userB.id,
        cardId,
        answers: answers(['NAILED', 'NAILED', 'MISSED']),
      });
      const caller = createCaller(userB.id);
      expect((await caller.stats.overallStats()).weakCards).toHaveLength(1);

      await caller.card.update({ cardId, canonicalAnswers: [{ text: '10' }] });

      expect(await caller.stats.overallStats()).toMatchObject({
        answerCount: 0,
        weakCards: [],
      });
    });

    it('has nothing to show for a learner who has never studied', async () => {
      const freshUser = await prisma.user.create({
        data: { email: 'fresh-stats@example.com', passwordHash: 'fakehash' },
      });

      expect(await createCaller(freshUser.id).stats.overallStats()).toEqual({
        answers: { MISSED: 0, PARTIALLY_CORRECT: 0, GOOD: 0, NAILED: 0 },
        answerCount: 0,
        accuracy: 0,
        lifecycle: { NEW: 0, LEARNING: 0, REINFORCING: 0, RETIRED: 0 },
        bands: { fragile: 0, developing: 0, solid: 0, mastered: 0 },
        weakCount: 0,
        deckCount: 0,
        weakCards: [],
        sessions: [],
      });
    });
  });
});
