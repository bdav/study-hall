import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { type NewCard } from './services/cards.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

// Test data references
let userId: string;
let deckId: string;

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

/** A fresh deck per test, so one test's answers can't change another's queue. */
function deckWith(cards: NewCard[]) {
  return createDeckWithCards(prisma, { userId, cards });
}

const capitals: NewCard[] = [
  { front: 'Capital of France', canonicalAnswer: 'Paris' },
  { front: 'Capital of Japan', canonicalAnswer: 'Tokyo' },
  { front: 'Capital of Brazil', canonicalAnswer: 'Brasília' },
];

describe('studyRouter', () => {
  describe('startSession', () => {
    it("starts an active Standard Study Session over the deck's NEW cards in deck order", async () => {
      const deck = await deckWith(capitals);

      const session = await createCaller().study.startSession({
        deckId: deck.id,
      });

      expect(session).toMatchObject({
        deckId: deck.id,
        status: 'ACTIVE',
        sessionType: 'STANDARD',
        studyMode: 'STUDY',
      });
      expect(session?.items.map((item) => item.card.front)).toEqual([
        'Capital of France',
        'Capital of Japan',
        'Capital of Brazil',
      ]);
    });

    it('puts due cards first, earliest due first, and leaves out cards not yet due', async () => {
      const deck = await deckWith([
        { front: 'Due an hour ago', canonicalAnswer: 'A' },
        { front: 'Due tomorrow', canonicalAnswer: 'B' },
        { front: 'New', canonicalAnswer: 'C' },
        { front: 'Due two hours ago', canonicalAnswer: 'D' },
      ]);
      const hour = 60 * 60 * 1000;
      await scheduleCard(deck.cards[0].id, new Date(Date.now() - hour));
      await scheduleCard(deck.cards[1].id, new Date(Date.now() + 24 * hour));
      await scheduleCard(deck.cards[3].id, new Date(Date.now() - 2 * hour));

      const session = await createCaller().study.startSession({
        deckId: deck.id,
      });

      expect(session?.items.map((item) => item.card.front)).toEqual([
        'Due two hours ago',
        'Due an hour ago',
        'New',
      ]);
    });

    it('fills at most 25 items, the Standard size, due cards before NEW ones', async () => {
      const deck = await deckWith(
        Array.from({ length: 30 }, (_, i) => ({
          front: `Q${i}`,
          canonicalAnswer: `A${i}`,
        })),
      );
      const lastCard = deck.cards[29];
      await scheduleCard(lastCard.id, new Date(Date.now() - 60 * 1000));

      const session = await createCaller().study.startSession({
        deckId: deck.id,
      });

      expect(session?.items).toHaveLength(25);
      expect(session?.items[0].card.front).toBe('Q29');
      expect(session?.items[24].card.front).toBe('Q23');
    });

    it('starts no session when nothing is due and nothing is NEW', async () => {
      const deck = await deckWith([{ front: 'Q', canonicalAnswer: 'A' }]);
      await scheduleCard(deck.cards[0].id, new Date(Date.now() + 60 * 1000));

      const session = await createCaller().study.startSession({
        deckId: deck.id,
      });

      expect(session).toBeNull();
    });
  });

  describe('submitAnswer', () => {
    it('grades the answer and saves it as a deterministically graded attempt', async () => {
      const { items } = await startedSession(capitals);

      const caller = createCaller();
      const correct = await caller.study.submitAnswer({
        itemId: items[0].id,
        userAnswer: 'paris',
      });
      const wrong = await caller.study.submitAnswer({
        itemId: items[1].id,
        userAnswer: 'Kyoto',
      });

      expect(correct).toMatchObject({
        recallGrade: 'NAILED',
        gradingMethod: 'DETERMINISTIC',
        userAnswer: 'paris',
      });
      expect(wrong.recallGrade).toBe('MISSED');
    });

    it("updates the card's progress: NEW to LEARNING, mastery and next due date", async () => {
      const { items } = await startedSession(capitals);
      const before = Date.now();

      await createCaller().study.submitAnswer({
        itemId: items[0].id,
        userAnswer: 'Paris',
      });

      const progress = await progressOf(items[0].cardId);
      expect(progress.lifecycleState).toBe('LEARNING');
      expect(progress.masteryScore).toBe(2);
      // NAILED on a LEARNING card is due again in 2 days
      const twoDays = 2 * 24 * 60 * 60 * 1000;
      expect(progress.dueAt!.getTime()).toBeGreaterThanOrEqual(
        before + twoDays,
      );
      expect(progress.dueAt!.getTime()).toBeLessThanOrEqual(
        Date.now() + twoDays,
      );
    });

    it('completes the item, so it takes only one answer', async () => {
      const { items } = await startedSession(capitals);
      const caller = createCaller();
      await caller.study.submitAnswer({
        itemId: items[0].id,
        userAnswer: 'Lyon',
      });

      await expect(
        caller.study.submitAnswer({ itemId: items[0].id, userAnswer: 'Paris' }),
      ).rejects.toThrow(/already answered/i);
    });
  });

  describe('dontKnow', () => {
    it('saves a MISSED attempt with no answer and schedules the card like one', async () => {
      const { items } = await startedSession(capitals);
      const before = Date.now();

      const attempt = await createCaller().study.dontKnow({
        itemId: items[0].id,
      });

      expect(attempt).toMatchObject({
        recallGrade: 'MISSED',
        userAnswer: null,
      });
      const progress = await progressOf(items[0].cardId);
      expect(progress.lifecycleState).toBe('LEARNING');
      // MISSED on a LEARNING card is due again in 30 minutes
      const thirtyMinutes = 30 * 60 * 1000;
      expect(progress.dueAt!.getTime()).toBeGreaterThanOrEqual(
        before + thirtyMinutes,
      );
      expect(progress.dueAt!.getTime()).toBeLessThanOrEqual(
        Date.now() + thirtyMinutes,
      );
    });
  });

  describe('finishSession', () => {
    it('completes the session with an end time and skips the unanswered items', async () => {
      const { id, items } = await startedSession(capitals);
      const caller = createCaller();
      await caller.study.submitAnswer({
        itemId: items[0].id,
        userAnswer: 'Paris',
      });

      const finished = await caller.study.finishSession({ id });

      expect(finished.status).toBe('COMPLETED');
      expect(finished.endedAt).toBeInstanceOf(Date);
      expect(finished.items.map((item) => item.status)).toEqual([
        'COMPLETED',
        'SKIPPED',
        'SKIPPED',
      ]);
    });

    it('closes the session to further answers', async () => {
      const { id, items } = await startedSession(capitals);
      const caller = createCaller();
      await caller.study.finishSession({ id });

      await expect(
        caller.study.submitAnswer({ itemId: items[0].id, userAnswer: 'Paris' }),
      ).rejects.toThrow(/finished/i);
      await expect(caller.study.finishSession({ id })).rejects.toThrow(
        /finished/i,
      );
    });
  });

  describe("another user's session", () => {
    async function otherUserCaller() {
      const other = await prisma.user.create({
        data: { email: `other-${Date.now()}@example.com`, passwordHash: 'x' },
      });
      return appRouter.createCaller({
        prisma,
        userId: other.id,
        sessionToken: null,
      });
    }

    it('cannot be started on, answered, given up on or finished', async () => {
      const deck = await deckWith(capitals);
      const { id, items } = await startedSession(capitals);
      const other = await otherUserCaller();

      await expect(
        other.study.startSession({ deckId: deck.id }),
      ).rejects.toThrow(/not found/i);
      await expect(
        other.study.submitAnswer({ itemId: items[0].id, userAnswer: 'Paris' }),
      ).rejects.toThrow(/not found/i);
      await expect(
        other.study.dontKnow({ itemId: items[0].id }),
      ).rejects.toThrow(/not found/i);
      await expect(other.study.finishSession({ id })).rejects.toThrow(
        /not found/i,
      );
    });
  });
});

function progressOf(cardId: string) {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId: { userId, cardId } },
  });
}

/** Starts a session on a fresh deck holding the given cards. */
async function startedSession(cards: NewCard[]) {
  const deck = await deckWith(cards);
  const session = await createCaller().study.startSession({ deckId: deck.id });
  if (!session) throw new Error('Expected a session to start');
  return session;
}

/** Makes a card a LEARNING card due at the given time. */
async function scheduleCard(cardId: string, dueAt: Date) {
  await prisma.cardProgress.update({
    where: { userId_cardId: { userId, cardId } },
    data: { lifecycleState: 'LEARNING', dueAt },
  });
}
