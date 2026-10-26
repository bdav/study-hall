import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import {
  createDeckWithCards,
  createTestPrisma,
  recordStudySession,
} from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

let userId: string;
let otherUserId: string;

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'deck-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-deck@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  // Clean all decks (cascades to cards, sessions, attempts)
  await prisma.deck.deleteMany({});
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

/** Records one finished study session, answering each card in turn. */
async function study(deckId: string, answers: [string, string][]) {
  await recordStudySession(prisma, {
    userId,
    deckId,
    answers: answers.map(([cardId, userAnswer]) => ({ cardId, userAnswer })),
  });
}

describe('deckRouter', () => {
  describe('create', () => {
    it('creates a deck with a name', async () => {
      const caller = createCaller();
      const deck = await caller.deck.create({ name: 'My Deck' });

      expect(deck.name).toBe('My Deck');
      expect(deck.description).toBeNull();
      expect(deck.userId).toBe(userId);
      expect(deck.id).toBeDefined();
    });

    it('creates a deck with a name and description', async () => {
      const caller = createCaller();
      const deck = await caller.deck.create({
        name: 'My Deck',
        description: 'A test deck',
      });

      expect(deck.name).toBe('My Deck');
      expect(deck.description).toBe('A test deck');
    });

    it('rejects empty name', async () => {
      const caller = createCaller();
      await expect(caller.deck.create({ name: '' })).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('returns empty array when user has no decks', async () => {
      const caller = createCaller();
      const result = await caller.deck.list();

      expect(result).toEqual([]);
    });

    it('returns only decks belonging to the current user', async () => {
      await prisma.deck.create({
        data: { name: 'My Deck', userId },
      });
      await prisma.deck.create({
        data: { name: 'Other Deck', userId: otherUserId },
      });

      const caller = createCaller();
      const result = await caller.deck.list();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('My Deck');
    });

    it('returns decks with card count', async () => {
      await createDeckWithCards(prisma, {
        userId,
        name: 'Deck With Cards',
        cards: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });

      const caller = createCaller();
      const result = await caller.deck.list();

      expect(result[0].cardCount).toBe(2);
    });

    it('returns decks with summary stats (accuracy, last studied)', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        name: 'Stats Deck',
        cards: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });
      await study(deck.id, [
        [deck.cards[0].id, 'A1'],
        [deck.cards[1].id, 'wrong'],
      ]);

      const caller = createCaller();
      const result = await caller.deck.list();

      expect(result[0].totalAttempts).toBe(2);
      expect(result[0].accuracy).toBeCloseTo(0.5, 5);
      expect(result[0].lastStudied).toBeDefined();
    });

    it("counts only attempts made since each card's latest progress reset", async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        name: 'Edited Deck',
        cards: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });
      await study(deck.id, [
        [deck.cards[0].id, 'wrong'],
        [deck.cards[1].id, 'A2'],
      ]);

      const caller = createCaller();
      await caller.card.update({ cardId: deck.cards[0].id, front: 'New Q1' });
      await study(deck.id, [[deck.cards[0].id, 'A1']]);

      const result = await caller.deck.list();

      // Q1's pre-edit miss no longer counts
      expect(result[0].totalAttempts).toBe(2);
      expect(result[0].accuracy).toBe(1);
    });

    it('returns null lastStudied when deck has no sessions', async () => {
      await prisma.deck.create({
        data: { name: 'Unstudied Deck', userId },
      });

      const caller = createCaller();
      const result = await caller.deck.list();

      expect(result[0].totalAttempts).toBe(0);
      expect(result[0].accuracy).toBe(0);
      expect(result[0].lastStudied).toBeNull();
    });

    it('orders decks by most recently created first', async () => {
      await prisma.deck.create({
        data: {
          name: 'First Deck',
          userId,
          createdAt: new Date('2025-01-01'),
        },
      });
      await prisma.deck.create({
        data: {
          name: 'Second Deck',
          userId,
          createdAt: new Date('2025-06-01'),
        },
      });

      const caller = createCaller();
      const result = await caller.deck.list();

      expect(result[0].name).toBe('Second Deck');
      expect(result[1].name).toBe('First Deck');
    });
  });

  describe('update', () => {
    it('updates a deck name', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Old Name', userId },
      });

      const caller = createCaller();
      const updated = await caller.deck.update({
        id: deck.id,
        name: 'New Name',
      });

      expect(updated.name).toBe('New Name');
    });

    it('updates a deck description', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'My Deck', userId },
      });

      const caller = createCaller();
      const updated = await caller.deck.update({
        id: deck.id,
        description: 'Updated description',
      });

      expect(updated.description).toBe('Updated description');
    });

    it('clears description when set to null', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'My Deck', userId, description: 'Has a description' },
      });

      const caller = createCaller();
      const updated = await caller.deck.update({
        id: deck.id,
        description: null,
      });

      expect(updated.description).toBeNull();
    });

    it('throws NOT_FOUND for nonexistent deck', async () => {
      const caller = createCaller();
      await expect(
        caller.deck.update({ id: 'nonexistent', name: 'Nope' }),
      ).rejects.toThrow(/not found/i);
    });

    it('throws NOT_FOUND for deck owned by another user', async () => {
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Deck', userId: otherUserId },
      });

      const caller = createCaller();
      await expect(
        caller.deck.update({ id: otherDeck.id, name: 'Hijacked' }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects empty name', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'My Deck', userId },
      });

      const caller = createCaller();
      await expect(
        caller.deck.update({ id: deck.id, name: '' }),
      ).rejects.toThrow();
    });
  });

  describe('delete', () => {
    it('deletes a deck', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'To Delete', userId },
      });

      const caller = createCaller();
      await caller.deck.delete({ id: deck.id });

      const found = await prisma.deck.findUnique({ where: { id: deck.id } });
      expect(found).toBeNull();
    });

    it('cascades delete to cards', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        name: 'To Delete',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });
      const cardId = deck.cards[0].id;

      const caller = createCaller();
      await caller.deck.delete({ id: deck.id });

      const card = await prisma.card.findUnique({ where: { id: cardId } });
      expect(card).toBeNull();
    });

    it('throws NOT_FOUND for nonexistent deck', async () => {
      const caller = createCaller();
      await expect(caller.deck.delete({ id: 'nonexistent' })).rejects.toThrow(
        /not found/i,
      );
    });

    it('throws NOT_FOUND for deck owned by another user', async () => {
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Deck', userId: otherUserId },
      });

      const caller = createCaller();
      await expect(caller.deck.delete({ id: otherDeck.id })).rejects.toThrow(
        /not found/i,
      );
    });
  });
});
