import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

// Test data references
let userId: string;
let deckId: string;
let cardIds: string[];

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  // Seed test data: a user with a deck and cards
  const user = await prisma.user.create({
    data: {
      email: 'study-test@example.com',
      passwordHash: 'fakehash',
    },
  });
  userId = user.id;

  const deck = await createDeckWithCards(prisma, {
    userId: user.id,
    name: 'Test Study Deck',
    cards: [
      { front: 'Capital of France', canonicalAnswer: 'Paris' },
      { front: 'Capital of Japan', canonicalAnswer: 'Tokyo' },
      { front: 'Capital of Brazil', canonicalAnswer: 'Brasília' },
    ],
  });
  deckId = deck.id;
  cardIds = deck.cards.map((c) => c.id);
});

afterAll(async () => {
  await cleanup();
});

function createCaller() {
  return appRouter.createCaller({ prisma, userId, sessionToken: null });
}

describe('deckRouter.getById', () => {
  it('returns the deck with its cards', async () => {
    const caller = createCaller();
    const deck = await caller.deck.getById({ id: deckId });

    expect(deck.id).toBe(deckId);
    expect(deck.name).toBe('Test Study Deck');
    expect(deck.cards).toHaveLength(3);
    expect(deck.cards[0].front).toBe('Capital of France');
  });

  it('throws NOT_FOUND for a nonexistent deck', async () => {
    const caller = createCaller();
    await expect(caller.deck.getById({ id: 'nonexistent-id' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws NOT_FOUND for a deck owned by another user', async () => {
    const otherUser = await prisma.user.create({
      data: { email: 'other-user@example.com', passwordHash: 'fakehash' },
    });
    const otherDeck = await prisma.deck.create({
      data: { name: 'Other Deck', userId: otherUser.id },
    });

    const caller = createCaller();
    await expect(caller.deck.getById({ id: otherDeck.id })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('studyRouter', () => {
  describe('startSession', () => {
    it('creates a StudySession record', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      expect(session.id).toBeDefined();
      expect(session.deckId).toBe(deckId);
      expect(session.userId).toBe(userId);
      expect(session.endedAt).toBeNull();
      expect(session.status).toBe('ACTIVE');
      expect(session.studyMode).toBe('STUDY');
    });

    it('throws NOT_FOUND for a nonexistent deck', async () => {
      const caller = createCaller();
      await expect(
        caller.study.startSession({ deckId: 'nonexistent-deck' }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('submitAttempt', () => {
    it('grades a correct answer and stores the attempt', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      // Card 0's canonical answer is 'Paris'
      const attempt = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });

      expect(attempt.id).toBeDefined();
      expect(attempt.studySessionId).toBe(session.id);
      expect(attempt.cardId).toBe(cardIds[0]);
      expect(attempt.userAnswer).toBe('Paris');
      expect(attempt.recallGrade).toBe('NAILED');
    });

    it('grades correct with normalized matching (case, whitespace, punctuation)', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      // Card 0's canonical answer is 'Paris'
      const attempt = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: '  paris.  ',
      });

      expect(attempt.recallGrade).toBe('NAILED');
    });

    it('grades against the edited canonical answer', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [{ front: 'Capital of Australia', canonicalAnswer: 'Sydney' }],
      });
      const caller = createCaller();
      await caller.card.update({
        cardId: deck.cards[0].id,
        canonicalAnswer: 'Canberra',
      });
      const session = await caller.study.startSession({ deckId: deck.id });

      const attempt = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: deck.cards[0].id,
        userAnswer: 'canberra',
      });

      expect(attempt.recallGrade).toBe('NAILED');
    });

    it('grades an incorrect answer', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      const attempt = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'London',
      });

      expect(attempt.userAnswer).toBe('London');
      expect(attempt.recallGrade).toBe('MISSED');
    });

    it('allows multiple attempts for the same card in a session (re-queue)', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      // First attempt: incorrect
      const attempt1 = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'London',
      });
      expect(attempt1.recallGrade).toBe('MISSED');
      expect(attempt1.attemptNumber).toBe(1);

      // Second attempt: correct
      const attempt2 = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });
      expect(attempt2.recallGrade).toBe('NAILED');
      expect(attempt2.attemptNumber).toBe(2);
      expect(attempt1.isRetry).toBe(false);
      expect(attempt2.isRetry).toBe(true);
    });

    it('assigns incrementing attemptNumber per card per session', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      const a1 = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'wrong1',
      });
      const a2 = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'wrong2',
      });
      const a3 = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'Tokyo',
      });

      expect(a1.attemptNumber).toBe(1);
      expect(a2.attemptNumber).toBe(2);
      expect(a3.attemptNumber).toBe(3);

      // Different card in same session starts at 1
      const b1 = await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[2],
        userAnswer: 'Brasilia',
      });
      expect(b1.attemptNumber).toBe(1);
    });

    it('rejects attempt for a card from a different deck', async () => {
      const otherDeck = await createDeckWithCards(prisma, {
        userId,
        name: 'Other Deck',
        cards: [{ front: 'Other Q', canonicalAnswer: 'Other A' }],
      });

      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      await expect(
        caller.study.submitAttempt({
          studySessionId: session.id,
          cardId: otherDeck.cards[0].id,
          userAnswer: 'Other A',
        }),
      ).rejects.toThrow(/does not belong/i);
    });

    it('rejects attempt on a finished session', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });
      await caller.study.finishSession({ id: session.id });

      await expect(
        caller.study.submitAttempt({
          studySessionId: session.id,
          cardId: cardIds[0],
          userAnswer: 'Paris',
        }),
      ).rejects.toThrow(/already finished/i);
    });
  });

  describe('finishSession', () => {
    it('sets endedAt on the session', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      const finished = await caller.study.finishSession({ id: session.id });

      expect(finished.endedAt).not.toBeNull();
      expect(finished.status).toBe('COMPLETED');
      expect(finished.id).toBe(session.id);
    });

    it('throws BAD_REQUEST when session is already finished', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });
      await caller.study.finishSession({ id: session.id });

      await expect(
        caller.study.finishSession({ id: session.id }),
      ).rejects.toThrow(/already finished/i);
    });
  });

  describe('getSession', () => {
    it('returns session with all attempts including retries', async () => {
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });

      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'London',
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'Paris',
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'Tokyo',
      });

      const fetched = await caller.study.getSession({ id: session.id });

      expect(fetched.id).toBe(session.id);
      expect(fetched.attempts).toHaveLength(3);
      // First attempt for card 0: incorrect
      expect(fetched.attempts[0].cardId).toBe(cardIds[0]);
      expect(fetched.attempts[0].recallGrade).toBe('MISSED');
      expect(fetched.attempts[0].attemptNumber).toBe(1);
      // Retry for card 0: correct
      expect(fetched.attempts[1].cardId).toBe(cardIds[0]);
      expect(fetched.attempts[1].recallGrade).toBe('NAILED');
      expect(fetched.attempts[1].attemptNumber).toBe(2);
      // Card 1
      expect(fetched.attempts[2].cardId).toBe(cardIds[1]);
      expect(fetched.attempts[2].attemptNumber).toBe(1);
    });

    it('throws NOT_FOUND for a nonexistent session', async () => {
      const caller = createCaller();
      await expect(
        caller.study.getSession({ id: 'nonexistent-id' }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('full study flow', () => {
    it('start -> submit all cards -> finish -> getSession shows everything', async () => {
      const caller = createCaller();

      const session = await caller.study.startSession({ deckId });

      // Canonical answers: 'Paris', 'Tokyo', 'Brasília'
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[0],
        userAnswer: 'paris',
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[1],
        userAnswer: 'London',
      });
      await caller.study.submitAttempt({
        studySessionId: session.id,
        cardId: cardIds[2],
        userAnswer: 'Brasilia',
      });

      const finished = await caller.study.finishSession({ id: session.id });
      expect(finished.endedAt).not.toBeNull();

      const fetched = await caller.study.getSession({ id: session.id });
      expect(fetched.attempts).toHaveLength(3);
      expect(fetched.endedAt).not.toBeNull();

      const correctCount = fetched.attempts.filter(
        (a) => a.recallGrade === 'NAILED',
      ).length;
      expect(correctCount).toBe(2); // Paris (normalized) + Brasilia (diacritics stripped)
    });
  });
});
