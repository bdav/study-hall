import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

let userId: string;
let deckId: string;
let deck2Id: string;
let cardIds: string[];
let deck2CardIds: string[];

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: {
      email: 'stats-test@example.com',
      passwordHash: 'fakehash',
    },
  });
  userId = user.id;

  const deck = await createDeckWithCards(prisma, {
    userId: user.id,
    name: 'Stats Deck 1',
    cards: [
      { front: 'Capital of France', canonicalAnswer: 'Paris' },
      { front: 'Capital of Japan', canonicalAnswer: 'Tokyo' },
      { front: 'Capital of Brazil', canonicalAnswer: 'Brasília' },
    ],
  });
  deckId = deck.id;
  cardIds = deck.cards.map((c) => c.id);

  const deck2 = await createDeckWithCards(prisma, {
    userId: user.id,
    name: 'Stats Deck 2',
    cards: [
      { front: '2+2', canonicalAnswer: '4' },
      { front: '3+3', canonicalAnswer: '6' },
    ],
  });
  deck2Id = deck2.id;
  deck2CardIds = deck2.cards.map((c) => c.id);
});

beforeEach(async () => {
  // Clean up all study sessions and attempts between tests for isolation
  await prisma.cardAttempt.deleteMany({});
  await prisma.studySession.deleteMany({});
});

afterAll(async () => {
  await cleanup();
});

function createCaller(overrideUserId?: string) {
  return appRouter.createCaller({
    prisma,
    userId: overrideUserId ?? userId,
    sessionToken: null,
  });
}

describe('statsRouter', () => {
  describe('deckStats', () => {
    it('returns total attempts, first-try accuracy, and overall accuracy for a single session', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      // Card 0: correct on first try
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });
      // Card 1: incorrect first, then correct
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'Beijing',
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'Tokyo',
      });
      // Card 2: incorrect (never corrected)
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[2],
        userAnswer: 'Lima',
      });
      await caller.study.finishSession({ id: session.id });

      const stats = await caller.stats.deckStats({ deckId });

      expect(stats.totalAttempts).toBe(4);
      expect(stats.uniqueCardsStudied).toBe(3);
      // First-try: card0=correct, card1=incorrect, card2=incorrect → 1/3
      expect(stats.firstTryAccuracy).toBeCloseTo(1 / 3, 5);
      // Overall: 2 correct out of 4 total
      expect(stats.overallAccuracy).toBeCloseTo(2 / 4, 5);
    });

    it('scopes first-try accuracy per session when deck is studied multiple times', async () => {
      const caller = createCaller();

      // Session 1: card 0 incorrect
      const s1 = await caller.study.startSession({ deckId });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: cardIds[0],
        userAnswer: 'London',
      });
      await caller.study.finishSession({ id: s1.id });

      // Session 2: card 0 correct on first try
      const s2 = await caller.study.startSession({ deckId });
      await caller.study.submitAttempt({
        studySessionId: s2.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });
      await caller.study.finishSession({ id: s2.id });

      const stats = await caller.stats.deckStats({ deckId });

      // 2 total attempts across sessions
      expect(stats.totalAttempts).toBe(2);
      // Per-session first try: s1 card0=incorrect, s2 card0=correct → 1 of 2 first tries correct
      expect(stats.firstTryAccuracy).toBeCloseTo(1 / 2, 5);
    });

    it('returns per-card attempts-to-correct averaged across sessions', async () => {
      const caller = createCaller();

      // Session 1: card 0 correct on first try
      const s1 = await caller.study.startSession({ deckId: deck2Id });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: deck2CardIds[0],
        userAnswer: '4',
      });
      // Session 1: card 1 takes 3 attempts
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: deck2CardIds[1],
        userAnswer: '5',
      });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: deck2CardIds[1],
        userAnswer: '7',
      });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: deck2CardIds[1],
        userAnswer: '6',
      });
      await caller.study.finishSession({ id: s1.id });

      const stats = await caller.stats.deckStats({ deckId: deck2Id });

      expect(stats.cardStats).toHaveLength(2);

      const card0Stats = stats.cardStats.find(
        (c: { cardId: string }) => c.cardId === deck2CardIds[0],
      );
      const card1Stats = stats.cardStats.find(
        (c: { cardId: string }) => c.cardId === deck2CardIds[1],
      );

      expect(card0Stats.avgAttemptsToCorrect).toBe(1);
      expect(card1Stats.avgAttemptsToCorrect).toBe(3);
    });

    it('includes card front text in cardStats', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });
      await caller.study.finishSession({ id: session.id });

      const stats = await caller.stats.deckStats({ deckId });

      const card0Stats = stats.cardStats.find(
        (c: { cardId: string }) => c.cardId === cardIds[0],
      );
      expect(card0Stats.front).toBe('Capital of France');
    });

    it('returns null avgAttemptsToCorrect for cards never answered correctly', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      // Only attempt card 2, get it wrong
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[2],
        userAnswer: 'Lima',
      });
      await caller.study.finishSession({ id: session.id });

      const stats = await caller.stats.deckStats({ deckId });

      const card2Stats = stats.cardStats.find(
        (c: { cardId: string }) => c.cardId === cardIds[2],
      );

      expect(card2Stats.avgAttemptsToCorrect).toBeNull();
    });

    it("counts only attempts made since the card's latest progress reset", async () => {
      const editedDeck = await createDeckWithCards(prisma, {
        userId,
        name: 'Edited Deck',
        cards: [
          { front: 'Capital of Australia', canonicalAnswer: 'Sydney' },
          { front: 'Capital of Canada', canonicalAnswer: 'Ottawa' },
        ],
      });
      const [australia, canada] = editedDeck.cards;
      const caller = createCaller();

      // Before the edit: Australia answered with the old answer, Canada missed
      const s1 = await caller.study.startSession({ deckId: editedDeck.id });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: australia.id,
        userAnswer: 'Melbourne',
      });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: australia.id,
        userAnswer: 'Sydney',
      });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: canada.id,
        userAnswer: 'Toronto',
      });
      await caller.study.finishSession({ id: s1.id });

      await caller.card.update({
        cardId: australia.id,
        canonicalAnswer: 'Canberra',
      });

      // After the edit: Australia right first time
      const s2 = await caller.study.startSession({ deckId: editedDeck.id });
      await caller.study.submitAttempt({
        studySessionId: s2.id,
        cardId: australia.id,
        userAnswer: 'Canberra',
      });
      await caller.study.finishSession({ id: s2.id });

      const stats = await caller.stats.deckStats({ deckId: editedDeck.id });

      // Australia: only the post-edit attempt. Canada: its one miss.
      expect(stats.totalAttempts).toBe(2);
      expect(stats.uniqueCardsStudied).toBe(2);
      expect(stats.overallAccuracy).toBeCloseTo(1 / 2, 5);
      expect(stats.firstTryAccuracy).toBeCloseTo(1 / 2, 5);
      const australiaStats = stats.cardStats.find(
        (c: { cardId: string }) => c.cardId === australia.id,
      );
      expect(australiaStats.totalAttempts).toBe(1);
      expect(australiaStats.avgAttemptsToCorrect).toBe(1);
    });

    it('handles zero-attempt case gracefully', async () => {
      const emptyDeck = await createDeckWithCards(prisma, {
        userId,
        name: 'Empty Deck',
        cards: [{ front: 'Q', canonicalAnswer: 'A' }],
      });

      const caller = createCaller();
      const stats = await caller.stats.deckStats({ deckId: emptyDeck.id });

      expect(stats.totalAttempts).toBe(0);
      expect(stats.uniqueCardsStudied).toBe(0);
      expect(stats.firstTryAccuracy).toBe(0);
      expect(stats.overallAccuracy).toBe(0);
      expect(stats.cardStats).toHaveLength(0);
    });

    it('throws NOT_FOUND for a nonexistent deck', async () => {
      const caller = createCaller();
      await expect(
        caller.stats.deckStats({ deckId: 'nonexistent-id' }),
      ).rejects.toThrow(/not found/i);
    });

    it('throws NOT_FOUND for a deck owned by another user', async () => {
      const otherUser = await prisma.user.create({
        data: { email: 'other-stats@example.com', passwordHash: 'fakehash' },
      });
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Stats Deck', userId: otherUser.id },
      });

      const caller = createCaller();
      await expect(
        caller.stats.deckStats({ deckId: otherDeck.id }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('overallStats', () => {
    it('aggregates across all decks with weakCards', async () => {
      const caller = createCaller();

      // Deck 1: card 0 correct first try, card 1 takes 2 attempts
      const s1 = await caller.study.startSession({ deckId });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: cardIds[1],
        userAnswer: 'Beijing',
      });
      await caller.study.submitAttempt({
        studySessionId: s1.id,
        cardId: cardIds[1],
        userAnswer: 'Tokyo',
      });
      await caller.study.finishSession({ id: s1.id });

      // Deck 2: card 0 takes 3 attempts
      const s2 = await caller.study.startSession({ deckId: deck2Id });
      await caller.study.submitAttempt({
        studySessionId: s2.id,
        cardId: deck2CardIds[0],
        userAnswer: '1',
      });
      await caller.study.submitAttempt({
        studySessionId: s2.id,
        cardId: deck2CardIds[0],
        userAnswer: '2',
      });
      await caller.study.submitAttempt({
        studySessionId: s2.id,
        cardId: deck2CardIds[0],
        userAnswer: '4',
      });
      await caller.study.finishSession({ id: s2.id });

      const stats = await caller.stats.overallStats();

      expect(stats.totalAttempts).toBe(6);
      expect(stats.totalCorrect).toBe(3);
      expect(stats.overallAccuracy).toBeCloseTo(3 / 6, 5);
      expect(stats.deckCount).toBe(2);

      // weakCards: only cards with avgAttemptsToCorrect > 1, sorted descending
      // deck1 card0 = 1 attempt (excluded), deck1 card1 = 2, deck2 card0 = 3
      expect(stats.weakCards).toHaveLength(2);
      // deck2 card0 took 3 attempts — should be first
      expect(stats.weakCards[0].cardId).toBe(deck2CardIds[0]);
      expect(stats.weakCards[0].avgAttemptsToCorrect).toBe(3);
      expect(stats.weakCards[0].front).toBe('2+2');
      expect(stats.weakCards[0].deckId).toBe(deck2Id);
      expect(stats.weakCards[0].deckName).toBe('Stats Deck 2');
      // deck1 card1 took 2 attempts
      expect(stats.weakCards[1].cardId).toBe(cardIds[1]);
      expect(stats.weakCards[1].avgAttemptsToCorrect).toBe(2);
      expect(stats.weakCards[1].front).toBe('Capital of Japan');
      expect(stats.weakCards[1].deckName).toBe('Stats Deck 1');
    });

    it('stops treating a card as weak once it is edited', async () => {
      const editedDeck = await createDeckWithCards(prisma, {
        userId,
        name: 'Weak Deck',
        cards: [{ front: '5+5', canonicalAnswer: '11' }],
      });
      const cardId = editedDeck.cards[0].id;
      const caller = createCaller();

      const session = await caller.study.startSession({
        deckId: editedDeck.id,
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId,
        userAnswer: '10',
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId,
        userAnswer: '11',
      });
      await caller.study.finishSession({ id: session.id });

      const before = await caller.stats.overallStats();
      expect(before.weakCards.map((c) => c.cardId)).toContain(cardId);

      await caller.card.update({ cardId, canonicalAnswer: '10' });

      const after = await caller.stats.overallStats();
      expect(after.totalAttempts).toBe(0);
      expect(after.weakCards).toHaveLength(0);
    });

    it('handles no study data gracefully', async () => {
      const freshUser = await prisma.user.create({
        data: { email: 'fresh-stats@example.com', passwordHash: 'fakehash' },
      });

      const caller = createCaller(freshUser.id);
      const stats = await caller.stats.overallStats();

      expect(stats.totalAttempts).toBe(0);
      expect(stats.totalCorrect).toBe(0);
      expect(stats.overallAccuracy).toBe(0);
      expect(stats.deckCount).toBe(0);
      expect(stats.weakCards).toHaveLength(0);
    });
  });
});
