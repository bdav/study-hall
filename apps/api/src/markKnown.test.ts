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

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
  const user = await prisma.user.create({
    data: { email: 'mark-known@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: { email: 'other-mark-known@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = other.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
});

afterAll(async () => {
  await cleanup();
});

// No AI provider is stubbed to allow anyone: marking known needs no AI
function createCaller(asUserId = userId) {
  return appRouter.createCaller({
    prisma,
    userId: asUserId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

function capitalsDeck(asUserId = userId) {
  return createDeckWithCards(prisma, {
    userId: asUserId,
    cards: [
      { front: 'Capital of France', canonicalAnswers: ['Paris'] },
      { front: 'Capital of Japan', canonicalAnswers: ['Tokyo'] },
      { front: 'Capital of Brazil', canonicalAnswers: ['Brasília'] },
    ],
  });
}

function progressOf(cardId: string) {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId: { userId, cardId } },
  });
}

describe('card.markKnown', () => {
  it('makes a new card STABLE, due 5 days on, recording no attempt', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    const before = Date.now();

    const result = await createCaller().card.markKnown({
      cardIds: [france.id],
    });

    expect(result).toEqual({ markedCount: 1 });
    const progress = await progressOf(france.id);
    expect(progress).toMatchObject({
      lifecycleState: 'STABLE',
      masteryScore: 3,
      lastIntervalDays: 5,
      lastReviewedAt: null,
    });
    expect(progress.dueAt!.getTime()).toBeGreaterThanOrEqual(
      before + 5 * DAY_MS,
    );
    expect(progress.dueAt!.getTime()).toBeLessThanOrEqual(
      Date.now() + 5 * DAY_MS,
    );
    expect(await prisma.cardAttempt.count()).toBe(0);
  });

  it('marks several cards known at once, leaving one already STABLE as it is', async () => {
    const deck = await capitalsDeck();
    const [france, japan, brazil] = deck.cards;
    const longAway = new Date(Date.now() + 60 * DAY_MS);
    await prisma.cardProgress.update({
      where: { userId_cardId: { userId, cardId: brazil.id } },
      data: { lifecycleState: 'STABLE', masteryScore: 9, dueAt: longAway },
    });

    const result = await createCaller().card.markKnown({
      cardIds: [france.id, japan.id, brazil.id],
    });

    expect(result).toEqual({ markedCount: 2 });
    expect((await progressOf(japan.id)).lifecycleState).toBe('STABLE');
    expect(await progressOf(brazil.id)).toMatchObject({
      masteryScore: 9,
      dueAt: longAway,
    });
  });

  it("doesn't change the deck's stats", async () => {
    const deck = await capitalsDeck();
    const [france, japan] = deck.cards;
    await recordStudySession(prisma, {
      userId,
      deckId: deck.id,
      answers: [
        { cardId: france.id, userAnswer: 'Paris' },
        { cardId: japan.id, userAnswer: 'Kyoto' },
      ],
    });
    const caller = createCaller();
    const before = await caller.stats.deckStats({ deckId: deck.id });

    await caller.card.markKnown({ cardIds: deck.cards.map((c) => c.id) });

    expect(await caller.stats.deckStats({ deckId: deck.id })).toEqual(before);
  });

  it('leaves a card marked known out of Study Sessions until it is due', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    const caller = createCaller();

    await caller.card.markKnown({ cardIds: [france.id] });
    const session = await caller.study.startSession({ deckId: deck.id });

    expect(session!.items.map((item) => item.card.front)).toEqual([
      'Capital of Japan',
      'Capital of Brazil',
    ]);
  });

  it('skips the card in a Study Session under way', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId: deck.id });

    await caller.card.markKnown({ cardIds: [deck.cards[0].id] });

    const items = await prisma.studySessionItem.findMany({
      where: { studySessionId: session!.id },
      orderBy: { position: 'asc' },
      select: { status: true },
    });
    expect(items.map((item) => item.status)).toEqual([
      'SKIPPED',
      'PENDING',
      'PENDING',
    ]);
  });

  it('keeps the card known when "My answer was correct" rebuilds its progress', async () => {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: [{ front: 'Capital of France', canonicalAnswers: ['Paris'] }],
    });
    const [france] = deck.cards;
    const caller = createCaller();
    await caller.card.markKnown({ cardIds: [france.id] });
    await prisma.cardProgress.update({
      where: { userId_cardId: { userId, cardId: france.id } },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
    const session = await caller.study.startSession({ deckId: deck.id });
    const missed = await caller.study.submitAnswer({
      itemId: session!.items[0].id,
      userAnswer: 'Paris, France',
    });

    await caller.study.acceptAnswer({ attemptId: missed.id });

    expect(await progressOf(france.id)).toMatchObject({
      lifecycleState: 'STABLE',
      lapseCount: 0,
    });
  });

  it("refuses, changing nothing, when a card isn't the learner's", async () => {
    const deck = await capitalsDeck();
    const otherDeck = await capitalsDeck(otherUserId);

    await expect(
      createCaller().card.markKnown({
        cardIds: [deck.cards[0].id, otherDeck.cards[0].id],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await progressOf(deck.cards[0].id)).lifecycleState).toBe('NEW');
  });

  it('refuses no cards', async () => {
    await expect(
      createCaller().card.markKnown({ cardIds: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('card.deleteMany', () => {
  it('deletes the given cards and leaves the rest', async () => {
    const deck = await capitalsDeck();
    const [france, japan, brazil] = deck.cards;

    const result = await createCaller().card.deleteMany({
      cardIds: [france.id, brazil.id],
    });

    expect(result).toEqual({ deletedCount: 2 });
    expect(
      await prisma.card.findMany({
        where: { deckId: deck.id },
        select: { id: true },
      }),
    ).toEqual([{ id: japan.id }]);
  });

  it("refuses, deleting nothing, when a card isn't the learner's", async () => {
    const deck = await capitalsDeck();
    const otherDeck = await capitalsDeck(otherUserId);

    await expect(
      createCaller().card.deleteMany({
        cardIds: [deck.cards[0].id, otherDeck.cards[0].id],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.card.count()).toBe(6);
  });
});
