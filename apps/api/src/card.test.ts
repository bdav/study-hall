import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
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
    data: { email: 'card-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-card@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
});

afterAll(async () => {
  await cleanup();
});

const NEW_PROGRESS = {
  lifecycleState: 'NEW',
  masteryScore: 0,
  dueAt: null,
  lapseCount: 0,
};

// Card progress has no read procedure yet, so these read it directly.
function progressOf(cardId: string) {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId: { userId, cardId } },
  });
}

function attemptsIn(studySessionId: string) {
  return prisma.cardAttempt.findMany({ where: { studySessionId } });
}

function makeProgressAdvanced(cardId: string) {
  return prisma.cardProgress.update({
    where: { userId_cardId: { userId, cardId } },
    data: {
      lifecycleState: 'LEARNING',
      masteryScore: 5,
      dueAt: new Date('2030-01-01'),
      lapseCount: 2,
    },
  });
}

function primaryAnswer(card: {
  canonicalAnswers: { text: string; isPrimary: boolean }[];
}) {
  const primaries = card.canonicalAnswers.filter((a) => a.isPrimary);
  expect(primaries).toHaveLength(1);
  return primaries[0].text;
}

function createCaller(overrideUserId?: string) {
  return appRouter.createCaller({
    prisma,
    userId: overrideUserId ?? userId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

describe('cardRouter', () => {
  describe('listByDeck', () => {
    it('returns cards for a deck', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });

      const caller = createCaller();
      const cards = await caller.card.listByDeck({ deckId: deck.id });

      expect(cards).toHaveLength(2);
      expect(cards[0].front).toBe('Q1');
      expect(cards[1].front).toBe('Q2');
    });

    it('returns empty array for deck with no cards', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Empty Deck', userId },
      });

      const caller = createCaller();
      const cards = await caller.card.listByDeck({ deckId: deck.id });

      expect(cards).toEqual([]);
    });

    it('throws NOT_FOUND for deck owned by another user', async () => {
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Deck', userId: otherUserId },
      });

      const caller = createCaller();
      await expect(
        caller.card.listByDeck({ deckId: otherDeck.id }),
      ).rejects.toThrow(/not found/i);
    });

    it('throws NOT_FOUND for nonexistent deck', async () => {
      const caller = createCaller();
      await expect(
        caller.card.listByDeck({ deckId: 'nonexistent' }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('create', () => {
    it('creates a card with front and a primary canonical answer on a deck', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Test Deck', userId },
      });

      const caller = createCaller();
      const card = await caller.card.create({
        deckId: deck.id,
        front: 'What is 2+2?',
        canonicalAnswers: ['4'],
      });

      expect(card.front).toBe('What is 2+2?');
      expect(primaryAnswer(card)).toBe('4');
      expect(card.deckId).toBe(deck.id);
      expect(card.id).toBeDefined();
    });

    it('creates a card with several Canonical Answers, the first primary', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Primes', userId },
      });

      await createCaller().card.create({
        deckId: deck.id,
        front: 'A prime between 10 and 20',
        canonicalAnswers: ['11', '13', '17'],
      });

      const [card] = await createCaller().card.listByDeck({ deckId: deck.id });
      expect(
        card.canonicalAnswers.map(({ text, isPrimary }) => ({
          text,
          isPrimary,
        })),
      ).toEqual([
        { text: '11', isPrimary: true },
        { text: '13', isPrimary: false },
        { text: '17', isPrimary: false },
      ]);
    });

    it.each([
      ['no Canonical Answer', []],
      ['two answers grading would accept alike', ['11', '11.']],
    ])('rejects a card with %s', async (_, canonicalAnswers) => {
      const deck = await prisma.deck.create({
        data: { name: 'Primes', userId },
      });

      await expect(
        createCaller().card.create({
          deckId: deck.id,
          front: 'A prime between 10 and 20',
          canonicalAnswers,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('creates card progress in NEW state with mastery 0', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Test Deck', userId },
      });

      const caller = createCaller();
      const card = await caller.card.create({
        deckId: deck.id,
        front: 'Q1',
        canonicalAnswers: ['A1'],
      });

      expect(await progressOf(card.id)).toMatchObject({
        userId,
        deckId: deck.id,
        ...NEW_PROGRESS,
      });
    });

    it('persists the card so it appears in listByDeck', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Test Deck', userId },
      });

      const caller = createCaller();
      await caller.card.create({
        deckId: deck.id,
        front: 'Q1',
        canonicalAnswers: ['A1'],
      });

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(1);
      expect(cards[0].front).toBe('Q1');
    });

    it('throws NOT_FOUND for deck owned by another user', async () => {
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Deck', userId: otherUserId },
      });

      const caller = createCaller();
      await expect(
        caller.card.create({
          deckId: otherDeck.id,
          front: 'Q',
          canonicalAnswers: ['A'],
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('throws NOT_FOUND for nonexistent deck', async () => {
      const caller = createCaller();
      await expect(
        caller.card.create({
          deckId: 'nonexistent',
          front: 'Q',
          canonicalAnswers: ['A'],
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects empty front', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Test Deck', userId },
      });

      const caller = createCaller();
      await expect(
        caller.card.create({
          deckId: deck.id,
          front: '',
          canonicalAnswers: ['A'],
        }),
      ).rejects.toThrow();
    });

    it('rejects empty canonical answer', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Test Deck', userId },
      });

      const caller = createCaller();
      await expect(
        caller.card.create({
          deckId: deck.id,
          front: 'Q',
          canonicalAnswers: [''],
        }),
      ).rejects.toThrow();
    });

    it('trims whitespace from front and canonical answer', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Test Deck', userId },
      });

      const caller = createCaller();
      const card = await caller.card.create({
        deckId: deck.id,
        front: '  What is 2+2?  ',
        canonicalAnswers: ['  4  '],
      });

      expect(card.front).toBe('What is 2+2?');
      expect(primaryAnswer(card)).toBe('4');
    });

    it('returns existing card when front and canonical answer both match', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'What is 2+2?', canonicalAnswers: ['4'] }],
      });

      const caller = createCaller();
      const card = await caller.card.create({
        deckId: deck.id,
        front: 'What is 2+2?',
        canonicalAnswers: ['4'],
      });

      expect(card.id).toBe(deck.cards[0].id);
      expect(primaryAnswer(card)).toBe('4');

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(1);
    });

    it('updates existing card canonical answer when front matches with different answer', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'What is 2+2?', canonicalAnswers: ['5'] }],
      });

      const caller = createCaller();
      const card = await caller.card.create({
        deckId: deck.id,
        front: 'What is 2+2?',
        canonicalAnswers: ['4'],
      });

      expect(card.id).toBe(deck.cards[0].id);
      expect(primaryAnswer(card)).toBe('4');

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(1);
      expect(primaryAnswer(cards[0])).toBe('4');
    });

    it('dedupes case-insensitively on front', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Hello', canonicalAnswers: ['World'] }],
      });

      const caller = createCaller();
      const card = await caller.card.create({
        deckId: deck.id,
        front: 'hello',
        canonicalAnswers: ['world'],
      });

      expect(card.id).toBe(deck.cards[0].id);

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('updates a card front and canonical answer', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Old Q', canonicalAnswers: ['Old A'] }],
      });

      const caller = createCaller();
      const updated = await caller.card.update({
        cardId: deck.cards[0].id,
        front: 'New Q',
        canonicalAnswers: [{ text: 'New A' }],
      });

      expect(updated.front).toBe('New Q');
      expect(primaryAnswer(updated)).toBe('New A');
    });

    it('supports partial update (only front)', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Old Q', canonicalAnswers: ['Old A'] }],
      });

      const caller = createCaller();
      const updated = await caller.card.update({
        cardId: deck.cards[0].id,
        front: 'New Q',
      });

      expect(updated.front).toBe('New Q');
      expect(primaryAnswer(updated)).toBe('Old A');
    });

    it('supports partial update (only canonical answer)', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Old Q', canonicalAnswers: ['Old A'] }],
      });

      const caller = createCaller();
      const updated = await caller.card.update({
        cardId: deck.cards[0].id,
        canonicalAnswers: [{ text: 'New A' }],
      });

      expect(updated.front).toBe('Old Q');
      expect(primaryAnswer(updated)).toBe('New A');
    });

    it('rejects update on a card belonging to another user', async () => {
      const otherDeck = await createDeckWithCards(prisma, {
        userId: otherUserId,
        name: 'Other Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.update({
          cardId: otherDeck.cards[0].id,
          front: 'Hacked',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects update on a nonexistent card', async () => {
      const caller = createCaller();
      await expect(
        caller.card.update({
          cardId: 'nonexistent',
          front: 'Q',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects empty front when provided', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.update({
          cardId: deck.cards[0].id,
          front: '',
        }),
      ).rejects.toThrow();
    });

    it('rejects empty canonical answer when provided', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.update({
          cardId: deck.cards[0].id,
          canonicalAnswers: [{ text: '' }],
        }),
      ).rejects.toThrow();
    });

    it('trims whitespace from front and canonical answer', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      const updated = await caller.card.update({
        cardId: deck.cards[0].id,
        front: '  New Q  ',
        canonicalAnswers: [{ text: '  New A  ' }],
      });

      expect(updated.front).toBe('New Q');
      expect(primaryAnswer(updated)).toBe('New A');
    });

    it('rejects update with neither front nor canonical answer', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.update({ cardId: deck.cards[0].id }),
      ).rejects.toThrow(/at least one/i);
    });

    it('resets card progress to NEW when the front changes', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });
      await makeProgressAdvanced(deck.cards[0].id);

      const caller = createCaller();
      await caller.card.update({ cardId: deck.cards[0].id, front: 'New Q' });

      expect(await progressOf(deck.cards[0].id)).toMatchObject(NEW_PROGRESS);
    });

    it('resets card progress to NEW when the canonical answer changes', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });
      await makeProgressAdvanced(deck.cards[0].id);

      const caller = createCaller();
      await caller.card.update({
        cardId: deck.cards[0].id,
        canonicalAnswers: [{ text: 'New A' }],
      });

      expect(await progressOf(deck.cards[0].id)).toMatchObject(NEW_PROGRESS);
    });

    it('does not reset progress when nothing actually changes', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });
      await makeProgressAdvanced(deck.cards[0].id);

      const caller = createCaller();
      await caller.card.update({
        cardId: deck.cards[0].id,
        front: 'Q',
        canonicalAnswers: [{ text: 'A' }],
      });

      expect(await progressOf(deck.cards[0].id)).toMatchObject({
        lifecycleState: 'LEARNING',
        masteryScore: 5,
      });
    });

    it('does not reset progress of other cards', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });
      await makeProgressAdvanced(deck.cards[1].id);

      const caller = createCaller();
      await caller.card.update({
        cardId: deck.cards[0].id,
        canonicalAnswers: [{ text: 'New A1' }],
      });

      expect(await progressOf(deck.cards[1].id)).toMatchObject({
        lifecycleState: 'LEARNING',
      });
    });

    it('keeps the card attempts when the card is edited', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [{ front: 'Q', canonicalAnswers: ['Wrong A'] }],
      });
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId: deck.id });
      await caller.study.submitAnswer({
        itemId: session!.items[0].id,
        userAnswer: 'Wrong A',
      });

      await caller.card.update({
        cardId: deck.cards[0].id,
        canonicalAnswers: [{ text: 'Correct A' }],
      });

      const attempts = await attemptsIn(session!.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].recallGrade).toBe('NAILED');
    });
  });

  describe('delete', () => {
    it('deletes a card', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await caller.card.delete({ cardId: deck.cards[0].id });

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(0);
    });

    it('rejects deletion of a card belonging to another user', async () => {
      const otherDeck = await createDeckWithCards(prisma, {
        userId: otherUserId,
        name: 'Other Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.delete({ cardId: otherDeck.cards[0].id }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects deletion of a nonexistent card', async () => {
      const caller = createCaller();
      await expect(
        caller.card.delete({ cardId: 'nonexistent' }),
      ).rejects.toThrow(/not found/i);
    });

    it('deleted card is no longer returned by listByDeck', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Test Deck',
        cards: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });

      const caller = createCaller();
      await caller.card.delete({ cardId: deck.cards[0].id });

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(1);
      expect(cards[0].front).toBe('Q2');
    });
  });

  describe('importCards', () => {
    it('creates new cards on the deck', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Import Deck', userId },
      });

      const caller = createCaller();
      const result = await caller.card.importCards({
        deckId: deck.id,
        new: [
          { front: 'Capital of France', canonicalAnswers: ['Paris'] },
          { front: '2 + 2', canonicalAnswers: ['4'] },
        ],
        update: [],
      });

      expect(result.createdCount).toBe(2);
      expect(result.updatedCount).toBe(0);

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(2);
      expect(cards[0].front).toBe('Capital of France');
      expect(primaryAnswer(cards[0])).toBe('Paris');
      expect(cards[1].front).toBe('2 + 2');
      expect(primaryAnswer(cards[1])).toBe('4');
    });

    it('updates existing cards canonical answer', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Import Deck',
        cards: [{ front: 'Capital of France', canonicalAnswers: ['Lyon'] }],
      });

      const caller = createCaller();
      const result = await caller.card.importCards({
        deckId: deck.id,
        new: [],
        update: [{ cardId: deck.cards[0].id, canonicalAnswers: ['Paris'] }],
      });

      expect(result.createdCount).toBe(0);
      expect(result.updatedCount).toBe(1);

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(1);
      expect(primaryAnswer(cards[0])).toBe('Paris');
    });

    it('handles mixed new and update in one call', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Import Deck',
        cards: [{ front: 'Existing Q', canonicalAnswers: ['Old A'] }],
      });

      const caller = createCaller();
      const result = await caller.card.importCards({
        deckId: deck.id,
        new: [{ front: 'New Q', canonicalAnswers: ['New A'] }],
        update: [{ cardId: deck.cards[0].id, canonicalAnswers: ['Updated A'] }],
      });

      expect(result.createdCount).toBe(1);
      expect(result.updatedCount).toBe(1);

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards).toHaveLength(2);
      expect(primaryAnswer(cards[0])).toBe('Updated A');
      expect(cards[1].front).toBe('New Q');
    });

    it('rejects when deck not found', async () => {
      const caller = createCaller();
      await expect(
        caller.card.importCards({
          deckId: 'nonexistent',
          new: [{ front: 'Q', canonicalAnswers: ['A'] }],
          update: [],
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects when deck not owned by user', async () => {
      const otherDeck = await prisma.deck.create({
        data: { name: 'Other Deck', userId: otherUserId },
      });

      const caller = createCaller();
      await expect(
        caller.card.importCards({
          deckId: otherDeck.id,
          new: [{ front: 'Q', canonicalAnswers: ['A'] }],
          update: [],
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('rejects update for a card not belonging to the deck', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'My Deck', userId },
      });
      const otherDeck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Other Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.importCards({
          deckId: deck.id,
          new: [],
          update: [
            { cardId: otherDeck.cards[0].id, canonicalAnswers: ['Hacked'] },
          ],
        }),
      ).rejects.toThrow(/card.*does not belong|not found/i);
    });

    it('rejects empty front in new cards', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Import Deck', userId },
      });

      const caller = createCaller();
      await expect(
        caller.card.importCards({
          deckId: deck.id,
          new: [{ front: '', canonicalAnswers: ['A'] }],
          update: [],
        }),
      ).rejects.toThrow();
    });

    it('rejects empty canonical answer in new cards', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Import Deck', userId },
      });

      const caller = createCaller();
      await expect(
        caller.card.importCards({
          deckId: deck.id,
          new: [{ front: 'Q', canonicalAnswers: [''] }],
          update: [],
        }),
      ).rejects.toThrow();
    });

    it('rejects empty canonical answer in update cards', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Import Deck',
        cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
      });

      const caller = createCaller();
      await expect(
        caller.card.importCards({
          deckId: deck.id,
          new: [],
          update: [{ cardId: deck.cards[0].id, canonicalAnswers: [''] }],
        }),
      ).rejects.toThrow();
    });

    it('returns correct createdCount and updatedCount', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId: userId,
        name: 'Import Deck',
        cards: [
          { front: 'Q1', canonicalAnswers: ['Old A1'] },
          { front: 'Q2', canonicalAnswers: ['Old A2'] },
        ],
      });

      const caller = createCaller();
      const result = await caller.card.importCards({
        deckId: deck.id,
        new: [
          { front: 'Q3', canonicalAnswers: ['A3'] },
          { front: 'Q4', canonicalAnswers: ['A4'] },
          { front: 'Q5', canonicalAnswers: ['A5'] },
        ],
        update: [
          { cardId: deck.cards[0].id, canonicalAnswers: ['New A1'] },
          { cardId: deck.cards[1].id, canonicalAnswers: ['New A2'] },
        ],
      });

      expect(result.createdCount).toBe(3);
      expect(result.updatedCount).toBe(2);
    });

    it('creates card progress in NEW state for each new card', async () => {
      const deck = await prisma.deck.create({
        data: { name: 'Import Deck', userId },
      });

      const caller = createCaller();
      await caller.card.importCards({
        deckId: deck.id,
        new: [
          { front: 'Q1', canonicalAnswers: ['A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
        update: [],
      });

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      for (const card of cards) {
        expect(await progressOf(card.id)).toMatchObject(NEW_PROGRESS);
      }
    });

    it('resets progress of updated cards and keeps their attempts', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        name: 'Import Deck',
        cards: [
          { front: 'Q1', canonicalAnswers: ['Old A1'] },
          { front: 'Q2', canonicalAnswers: ['A2'] },
        ],
      });
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId: deck.id });
      await caller.study.submitAnswer({
        itemId: session!.items[0].id,
        userAnswer: 'Old A1',
      });
      await makeProgressAdvanced(deck.cards[0].id);
      await makeProgressAdvanced(deck.cards[1].id);

      await caller.card.importCards({
        deckId: deck.id,
        new: [],
        update: [{ cardId: deck.cards[0].id, canonicalAnswers: ['New A1'] }],
      });

      expect(await progressOf(deck.cards[0].id)).toMatchObject(NEW_PROGRESS);
      expect(await progressOf(deck.cards[1].id)).toMatchObject({
        lifecycleState: 'LEARNING',
      });
      expect(await attemptsIn(session!.id)).toHaveLength(1);
    });
  });

  describe('accepted variants', () => {
    async function cardWithAnswer(canonicalAnswer = 'colour') {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [
          {
            front: 'Colour in American English',
            canonicalAnswers: [canonicalAnswer],
          },
        ],
      });
      const card = deck.cards[0];
      return { deck, card, answerId: card.canonicalAnswers[0].id };
    }

    it("lists a variant added to a card's Canonical Answer with the deck's cards", async () => {
      const { deck, answerId } = await cardWithAnswer();
      const caller = createCaller();

      await caller.card.addVariant({
        canonicalAnswerId: answerId,
        text: ' color ',
      });

      const [card] = await caller.card.listByDeck({ deckId: deck.id });
      expect(
        card.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['color']);
    });

    it('removes a variant', async () => {
      const { deck, answerId } = await cardWithAnswer();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: answerId,
        text: 'color',
      });
      const withVariants = await caller.card.addVariant({
        canonicalAnswerId: answerId,
        text: 'colr',
      });
      const misspelling = withVariants.canonicalAnswers[0].acceptedVariants[1];

      const updated = await caller.card.removeVariant({
        variantId: misspelling.id,
      });

      expect(
        updated.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['color']);
      const [listed] = await caller.card.listByDeck({ deckId: deck.id });
      expect(
        listed.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['color']);
    });

    it("refuses to add a variant to another user's card", async () => {
      const { deck, answerId } = await cardWithAnswer();

      await expect(
        createCaller(otherUserId).card.addVariant({
          canonicalAnswerId: answerId,
          text: 'color',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const [card] = await createCaller().card.listByDeck({ deckId: deck.id });
      expect(card.canonicalAnswers[0].acceptedVariants).toEqual([]);
    });

    it('refuses to add a variant to a nonexistent Canonical Answer', async () => {
      await expect(
        createCaller().card.addVariant({
          canonicalAnswerId: 'nonexistent-id',
          text: 'color',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it("refuses to remove a variant from another user's card", async () => {
      const { deck, answerId } = await cardWithAnswer();
      const card = await createCaller().card.addVariant({
        canonicalAnswerId: answerId,
        text: 'color',
      });

      await expect(
        createCaller(otherUserId).card.removeVariant({
          variantId: card.canonicalAnswers[0].acceptedVariants[0].id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const [listed] = await createCaller().card.listByDeck({
        deckId: deck.id,
      });
      expect(listed.canonicalAnswers[0].acceptedVariants).toHaveLength(1);
    });

    it('refuses to remove a nonexistent variant', async () => {
      await expect(
        createCaller().card.removeVariant({ variantId: 'nonexistent-id' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects a variant that matches one already on the Canonical Answer', async () => {
      const { deck, answerId } = await cardWithAnswer();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: answerId,
        text: 'color',
      });

      await expect(
        caller.card.addVariant({ canonicalAnswerId: answerId, text: 'Color!' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const [card] = await caller.card.listByDeck({ deckId: deck.id });
      expect(
        card.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['color']);
    });

    it('rejects a variant that matches the Canonical Answer itself', async () => {
      const { answerId } = await cardWithAnswer('colour');

      await expect(
        createCaller().card.addVariant({
          canonicalAnswerId: answerId,
          text: 'Colour.',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('accepts a variant that differs from the Canonical Answer only in accents', async () => {
      const { answerId } = await cardWithAnswer('Brasília');

      const card = await createCaller().card.addVariant({
        canonicalAnswerId: answerId,
        text: 'Brasilia',
      });

      expect(
        card.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['Brasilia']);
    });

    it("accepts a variant another card's answer already has", async () => {
      const first = await cardWithAnswer();
      const second = await cardWithAnswer();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: first.answerId,
        text: 'color',
      });

      const card = await caller.card.addVariant({
        canonicalAnswerId: second.answerId,
        text: 'color',
      });

      expect(card.canonicalAnswers[0].acceptedVariants).toHaveLength(1);
    });

    it("never changes the card's progress or attempts", async () => {
      const { deck, card, answerId } = await cardWithAnswer();
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId: deck.id });
      await caller.study.submitAnswer({
        itemId: session!.items[0].id,
        userAnswer: 'colour',
      });
      await makeProgressAdvanced(card.id);
      const before = await progressOf(card.id);

      const added = await caller.card.addVariant({
        canonicalAnswerId: answerId,
        text: 'color',
      });
      await caller.card.removeVariant({
        variantId: added.canonicalAnswers[0].acceptedVariants[0].id,
      });

      expect(await progressOf(card.id)).toEqual(before);
      expect(await attemptsIn(session!.id)).toHaveLength(1);
    });

    describe('when an edit changes the answer', () => {
      async function cardWithVariants() {
        const { deck, card, answerId } = await cardWithAnswer();
        const caller = createCaller();
        await caller.card.addVariant({
          canonicalAnswerId: answerId,
          text: 'color',
        });
        const withVariants = await caller.card.addVariant({
          canonicalAnswerId: answerId,
          text: 'colour (UK)',
        });
        const [color, uk] = withVariants.canonicalAnswers[0].acceptedVariants;
        return { deck, card, answerId, color, uk };
      }

      function variantTexts(card: {
        canonicalAnswers: { acceptedVariants: { text: string }[] }[];
      }) {
        return card.canonicalAnswers[0].acceptedVariants.map((v) => v.text);
      }

      it('keeps only the variants the edit says to keep', async () => {
        const { card, answerId, uk } = await cardWithVariants();

        const updated = await createCaller().card.update({
          cardId: card.id,
          canonicalAnswers: [{ id: answerId, text: 'colour, UK spelling' }],
          keepVariantIds: [uk.id],
        });

        expect(variantTexts(updated)).toEqual(['colour (UK)']);
      });

      it('drops a variant the new answer has become, even one marked to keep', async () => {
        const { card, answerId, color, uk } = await cardWithVariants();

        const updated = await createCaller().card.update({
          cardId: card.id,
          canonicalAnswers: [{ id: answerId, text: 'Color' }],
          keepVariantIds: [color.id, uk.id],
        });

        expect(variantTexts(updated)).toEqual(['colour (UK)']);
      });

      it('clears the variants when the edit names none to keep', async () => {
        const { card } = await cardWithVariants();

        const updated = await createCaller().card.update({
          cardId: card.id,
          canonicalAnswers: [{ text: 'red' }],
        });

        expect(variantTexts(updated)).toEqual([]);
      });

      it('keeps every variant when only the front changes', async () => {
        const { card } = await cardWithVariants();

        const updated = await createCaller().card.update({
          cardId: card.id,
          front: 'Colour, in American English',
          keepVariantIds: [],
        });

        expect(variantTexts(updated)).toEqual(['color', 'colour (UK)']);
      });

      it('clears the variants of a card a CSV import gives a new answer', async () => {
        const { deck, card } = await cardWithVariants();
        const caller = createCaller();

        await caller.card.importCards({
          deckId: deck.id,
          new: [],
          update: [{ cardId: card.id, canonicalAnswers: ['red'] }],
        });

        const [listed] = await caller.card.listByDeck({ deckId: deck.id });
        expect(variantTexts(listed)).toEqual([]);
      });

      it('clears the variants of a card whose answer a new card with the same front replaces', async () => {
        const { deck } = await cardWithVariants();

        const replaced = await createCaller().card.create({
          deckId: deck.id,
          front: 'Colour in American English',
          canonicalAnswers: ['red'],
        });

        expect(variantTexts(replaced)).toEqual([]);
      });
    });
  });

  describe('several Canonical Answers', () => {
    async function primeCard() {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [
          {
            front: 'A prime between 10 and 20',
            canonicalAnswers: ['11', '13'],
          },
        ],
      });
      const card = deck.cards[0];
      const [eleven, thirteen] = card.canonicalAnswers;
      return { deck, card, eleven, thirteen };
    }

    function answersOf(card: {
      canonicalAnswers: {
        text: string;
        isPrimary: boolean;
        acceptedVariants: { text: string }[];
      }[];
    }) {
      return card.canonicalAnswers.map((a) => ({
        text: a.text,
        isPrimary: a.isPrimary,
        variants: a.acceptedVariants.map((v) => v.text),
      }));
    }

    it('switches the primary answer without resetting progress', async () => {
      const { card, eleven, thirteen } = await primeCard();
      await makeProgressAdvanced(card.id);

      const updated = await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [thirteen, eleven],
      });

      expect(answersOf(updated)).toEqual([
        { text: '13', isPrimary: true, variants: [] },
        { text: '11', isPrimary: false, variants: [] },
      ]);
      expect(await progressOf(card.id)).toMatchObject({
        lifecycleState: 'LEARNING',
        masteryScore: 5,
      });
    });

    it("adds an answer, resetting progress and keeping the others' variants", async () => {
      const { card, eleven, thirteen } = await primeCard();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: eleven.id,
        text: 'eleven',
      });
      await makeProgressAdvanced(card.id);

      const updated = await caller.card.update({
        cardId: card.id,
        canonicalAnswers: [eleven, thirteen, { text: '17' }],
      });

      expect(answersOf(updated)).toEqual([
        { text: '11', isPrimary: true, variants: ['eleven'] },
        { text: '13', isPrimary: false, variants: [] },
        { text: '17', isPrimary: false, variants: [] },
      ]);
      expect(await progressOf(card.id)).toMatchObject(NEW_PROGRESS);
    });

    it('removes an answer with its variants, resetting progress', async () => {
      const { card, eleven, thirteen } = await primeCard();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: thirteen.id,
        text: 'thirteen',
      });
      await makeProgressAdvanced(card.id);

      const updated = await caller.card.update({
        cardId: card.id,
        canonicalAnswers: [eleven],
      });

      expect(answersOf(updated)).toEqual([
        { text: '11', isPrimary: true, variants: [] },
      ]);
      expect(await progressOf(card.id)).toMatchObject(NEW_PROGRESS);
    });

    it("drops a variant that becomes one of the card's answers", async () => {
      const { card, eleven, thirteen } = await primeCard();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: eleven.id,
        text: 'XI',
      });

      const updated = await caller.card.update({
        cardId: card.id,
        canonicalAnswers: [eleven, thirteen, { text: 'xi' }],
      });

      expect(answersOf(updated)[0].variants).toEqual([]);
    });

    it.each([
      [
        'two answers grading would accept alike',
        [{ text: '11' }, { text: '11!' }],
      ],
      ["another card's answer", [{ id: 'not-this-cards-answer', text: '11' }]],
    ])('refuses an edit with %s', async (_, canonicalAnswers) => {
      const { card } = await primeCard();

      await expect(
        createCaller().card.update({ cardId: card.id, canonicalAnswers }),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/BAD_REQUEST|NOT_FOUND/),
      });
    });

    it('moves texts between answers', async () => {
      const { card, eleven, thirteen } = await primeCard();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: eleven.id,
        text: 'XI',
      });

      // 11 → 13 and 13 → 17, so 11's row takes the text 13's row had
      const updated = await caller.card.update({
        cardId: card.id,
        canonicalAnswers: [
          { id: eleven.id, text: '13' },
          { id: thirteen.id, text: '17' },
        ],
        keepVariantIds: [],
      });

      expect(answersOf(updated)).toEqual([
        { text: '13', isPrimary: true, variants: [] },
        { text: '17', isPrimary: false, variants: [] },
      ]);
    });

    it('swaps the texts of two answers', async () => {
      const { card, eleven, thirteen } = await primeCard();

      const updated = await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [
          { id: eleven.id, text: '13' },
          { id: thirteen.id, text: '11' },
        ],
      });

      expect(answersOf(updated).map((a) => a.text)).toEqual(['13', '11']);
    });

    it("gives a retyped answer's old text, added anew, its own row", async () => {
      const { card, eleven, thirteen } = await primeCard();

      // 11 retyped to 19, and a new answer "11" made primary
      const updated = await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [
          { text: '11' },
          { id: eleven.id, text: '19' },
          thirteen,
        ],
      });

      expect(answersOf(updated)).toEqual([
        { text: '11', isPrimary: true, variants: [] },
        { text: '19', isPrimary: false, variants: [] },
        { text: '13', isPrimary: false, variants: [] },
      ]);
    });

    it('refuses an edit naming one answer twice', async () => {
      const { card, eleven } = await primeCard();

      await expect(
        createCaller().card.update({
          cardId: card.id,
          canonicalAnswers: [eleven, { id: eleven.id, text: '17' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('imports cards with several answers, the first primary, in import order', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [{ front: 'Existing', canonicalAnswers: ['A'] }],
      });
      const caller = createCaller();

      await caller.card.importCards({
        deckId: deck.id,
        new: [
          {
            front: 'A prime between 10 and 20',
            canonicalAnswers: ['11', '13'],
          },
          { front: 'An even prime', canonicalAnswers: ['2'] },
        ],
        update: [],
      });

      const cards = await caller.card.listByDeck({ deckId: deck.id });
      expect(cards.map((c) => [c.front, c.position])).toEqual([
        ['Existing', 0],
        ['A prime between 10 and 20', 1],
        ['An even prime', 2],
      ]);
      expect(answersOf(cards[1])).toEqual([
        { text: '11', isPrimary: true, variants: [] },
        { text: '13', isPrimary: false, variants: [] },
      ]);
    });

    it("keeps an imported update's unchanged answer and its variants", async () => {
      const { deck, card, eleven } = await primeCard();
      const caller = createCaller();
      await caller.card.addVariant({
        canonicalAnswerId: eleven.id,
        text: 'eleven',
      });

      await caller.card.importCards({
        deckId: deck.id,
        new: [],
        update: [{ cardId: card.id, canonicalAnswers: ['11', '17'] }],
      });

      const [listed] = await caller.card.listByDeck({ deckId: deck.id });
      expect(answersOf(listed)).toEqual([
        { text: '11', isPrimary: true, variants: ['eleven'] },
        { text: '17', isPrimary: false, variants: [] },
      ]);
    });
  });
});
