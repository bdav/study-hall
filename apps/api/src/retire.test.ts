import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient, type StudyDirection } from '@prisma/client';
import {
  createDeckWithCards,
  createTestPrisma,
  recordCardHistory,
} from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';
import { replayCardAnswers } from './services/cardStanding.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
let otherUserId: string;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
  const user = await prisma.user.create({
    data: { email: 'retire@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: { email: 'other-retire@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = other.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
});

afterAll(async () => {
  await cleanup();
});

// Retiring needs no AI
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
    ],
  });
}

/**
 * Answers that master a card: Good, then Nailed five times, months apart,
 * leaving it Reinforcing at mastery 10, next due 90 days on. One Nailed
 * fewer leaves it at mastery 9, next due only 30 days on.
 */
function masteredAnswers(nailed = 5) {
  return [
    { at: daysAgo(400), grade: 'GOOD' as const },
    ...[399, 390, 370, 330, 240].slice(0, nailed).map((days) => ({
      at: daysAgo(days),
      grade: 'NAILED' as const,
    })),
  ];
}

function master(
  cardId: string,
  {
    direction = 'FORWARD',
    nailed = 5,
  }: { direction?: StudyDirection; nailed?: number } = {},
) {
  return recordCardHistory(prisma, {
    userId,
    cardId,
    direction,
    answers: masteredAnswers(nailed),
  });
}

function progressOf(cardId: string, direction: StudyDirection = 'FORWARD') {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId_direction: { userId, cardId, direction } },
  });
}

async function listed(deckId: string) {
  const cards = await createCaller().card.listByDeck({ deckId });
  return cards.map(({ front, retired, retirable }) => ({
    front,
    retired,
    retirable,
  }));
}

describe('which cards can retire', () => {
  it('suggests retiring a mastered card, and not one short of it', async () => {
    const deck = await capitalsDeck();
    const [france, japan] = deck.cards;
    await master(france.id);
    await master(japan.id, { nailed: 4 });

    expect(await listed(deck.id)).toEqual([
      { front: 'Capital of France', retired: false, retirable: true },
      { front: 'Capital of Japan', retired: false, retirable: false },
    ]);
  });

  it('suggests it on a Reversible Deck only once both directions are mastered', async () => {
    const deck = await capitalsDeck();
    const [france, japan] = deck.cards;
    await prisma.deck.update({
      where: { id: deck.id },
      data: { reversible: true },
    });
    await master(france.id);
    await master(france.id, { direction: 'REVERSE' });
    await master(japan.id);

    expect(await listed(deck.id)).toEqual([
      { front: 'Capital of France', retired: false, retirable: true },
      { front: 'Capital of Japan', retired: false, retirable: false },
    ]);
  });

  it("says so in the card's history, which the study screen reads", async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);

    const history = await createCaller().card.history({
      cardId: france.id,
      direction: 'FORWARD',
    });

    expect(history.progress).toMatchObject({ canRetire: true });
  });
});

describe('card.retire', () => {
  it('retires a mastered card, keeping its mastery and answers', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    const attemptsBefore = await prisma.cardAttempt.count();

    const result = await createCaller().card.retire({ cardIds: [france.id] });

    expect(result).toEqual({ retiredCount: 1 });
    expect(await progressOf(france.id)).toMatchObject({
      lifecycleState: 'RETIRED',
      masteryScore: 10,
    });
    expect(await prisma.cardAttempt.count()).toBe(attemptsBefore);
    expect(await listed(deck.id)).toContainEqual({
      front: 'Capital of France',
      retired: true,
      retirable: false,
    });
  });

  it('retires only the cards that can, leaving the rest as they are', async () => {
    const deck = await capitalsDeck();
    const [france, japan] = deck.cards;
    await master(france.id);
    await master(japan.id, { nailed: 4 });

    const result = await createCaller().card.retire({
      cardIds: [france.id, japan.id],
    });

    expect(result).toEqual({ retiredCount: 1 });
    expect((await progressOf(japan.id)).lifecycleState).toBe('REINFORCING');
  });

  it('retires a Reversible Deck card in both directions', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await prisma.deck.update({
      where: { id: deck.id },
      data: { reversible: true },
    });
    await master(france.id);
    await master(france.id, { direction: 'REVERSE' });

    await createCaller().card.retire({ cardIds: [france.id] });

    expect((await progressOf(france.id)).lifecycleState).toBe('RETIRED');
    expect((await progressOf(france.id, 'REVERSE')).lifecycleState).toBe(
      'RETIRED',
    );
  });

  it('leaves a retired card out of Study Sessions, their previews and weakness', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    // Due, as if long unreviewed
    await prisma.cardProgress.update({
      where: {
        userId_cardId_direction: {
          userId,
          cardId: france.id,
          direction: 'FORWARD',
        },
      },
      data: { dueAt: daysAgo(1) },
    });
    await createCaller().card.retire({ cardIds: [france.id] });

    const preview = await createCaller().study.queuePreview({
      deckId: deck.id,
      sessionType: 'QUICK',
      studyMode: 'STUDY',
      direction: 'FORWARD',
    });
    // Only Japan, still NEW
    expect(preview).toMatchObject({ sessionSize: 1, dueCount: 0, newCount: 1 });
    for (const studyMode of ['STUDY', 'DRILL_WEAKEST', 'CRAM'] as const) {
      const session = await createCaller().study.startSession({
        deckId: deck.id,
        sessionType: 'QUICK',
        studyMode,
        direction: 'FORWARD',
      });
      expect(session?.items.map((item) => item.cardId) ?? []).not.toContain(
        france.id,
      );
      if (session) await createCaller().study.finishSession({ id: session.id });
    }
  });

  it('keeps a card retired when its answers are replayed, as "My answer was correct" does', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    await createCaller().card.retire({ cardIds: [france.id] });

    await replayCardAnswers(prisma, {
      userId,
      cardId: france.id,
      direction: 'FORWARD',
    });

    expect((await progressOf(france.id)).lifecycleState).toBe('RETIRED');
  });

  it('leaves a retired card as it is when marked known', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    await createCaller().card.retire({ cardIds: [france.id] });

    const result = await createCaller().card.markKnown({
      cardIds: [france.id],
    });

    expect(result).toEqual({ markedCount: 0 });
    expect((await progressOf(france.id)).lifecycleState).toBe('RETIRED');
  });

  it('starts a retired card afresh as NEW when an edit resets it', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    await createCaller().card.retire({ cardIds: [france.id] });

    await createCaller().card.update({
      cardId: france.id,
      front: 'Capital city of France',
    });

    expect(await progressOf(france.id)).toMatchObject({
      lifecycleState: 'NEW',
      retiredAt: null,
    });
  });

  it("refuses, changing nothing, when a card isn't the learner's", async () => {
    const deck = await capitalsDeck(otherUserId);

    await expect(
      createCaller().card.retire({ cardIds: [deck.cards[0].id] }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses on an archived deck', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    await prisma.deck.update({
      where: { id: deck.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      createCaller().card.retire({ cardIds: [france.id] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('card.unretire', () => {
  it('returns a retired card to Reinforcing, due straight away, without resetting it', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    await createCaller().card.retire({ cardIds: [france.id] });
    const before = Date.now();

    const result = await createCaller().card.unretire({ cardIds: [france.id] });

    expect(result).toEqual({ unretiredCount: 1 });
    const progress = await progressOf(france.id);
    expect(progress).toMatchObject({
      lifecycleState: 'REINFORCING',
      masteryScore: 10,
    });
    expect(progress.dueAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(progress.dueAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(progress.resetAt.getTime()).toBeLessThan(before);
    const preview = await createCaller().study.queuePreview({
      deckId: deck.id,
      sessionType: 'QUICK',
      studyMode: 'STUDY',
      direction: 'FORWARD',
    });
    expect(preview.dueCount).toBe(1);
  });

  it('keeps a card unretired when its answers are replayed', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    await master(france.id);
    await createCaller().card.retire({ cardIds: [france.id] });
    await createCaller().card.unretire({ cardIds: [france.id] });

    await replayCardAnswers(prisma, {
      userId,
      cardId: france.id,
      direction: 'FORWARD',
    });

    expect((await progressOf(france.id)).lifecycleState).toBe('REINFORCING');
  });

  it('leaves a card that is not retired as it is', async () => {
    const deck = await capitalsDeck();

    const result = await createCaller().card.unretire({
      cardIds: [deck.cards[0].id],
    });

    expect(result).toEqual({ unretiredCount: 0 });
    expect((await progressOf(deck.cards[0].id)).lifecycleState).toBe('NEW');
  });

  it("refuses when a card isn't the learner's", async () => {
    const deck = await capitalsDeck(otherUserId);

    await expect(
      createCaller().card.unretire({ cardIds: [deck.cards[0].id] }),
    ).rejects.toThrow(/not found/i);
  });
});
