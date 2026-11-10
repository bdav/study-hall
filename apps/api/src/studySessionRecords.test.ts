import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient, type StudyDirection } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

/**
 * What a Study Session records of where its cards come from (#136): the
 * decks it was built from, and each item's own Study Direction, read
 * wherever an item is answered or skipped, so a Today's Review can span
 * decks and ask each card its own way (ADR-0013).
 */

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
let otherUserId: string;

beforeAll(() => {
  ({ prisma, cleanup } = createTestPrisma());
});

beforeEach(async () => {
  await prisma.user.deleteMany();
  userId = (
    await prisma.user.create({
      data: { email: 'records@example.com', passwordHash: 'fakehash' },
    })
  ).id;
  otherUserId = (
    await prisma.user.create({
      data: { email: 'other@example.com', passwordHash: 'fakehash' },
    })
  ).id;
});

afterAll(async () => {
  await cleanup();
});

function createCaller() {
  return appRouter.createCaller({
    prisma,
    userId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

/** A Reversible Deck of capitals: fronts the countries, answers the cities. */
async function capitals(name: string, cities: [string, string][]) {
  const deck = await createDeckWithCards(prisma, {
    userId,
    name,
    cards: cities.map(([front, answer]) => ({
      front,
      canonicalAnswers: [answer],
    })),
  });
  await prisma.deck.update({
    where: { id: deck.id },
    data: { reversible: true },
  });
  return deck;
}

/**
 * An unfinished Today's Review, as #137 will start one: across the given
 * cards' decks, each card asked in the direction given.
 */
async function startReview(
  items: { cardId: string; deckId: string; direction: StudyDirection }[],
) {
  const deckIds = [...new Set(items.map((item) => item.deckId))];
  return prisma.studySession.create({
    data: {
      userId,
      kind: 'TODAYS_REVIEW',
      sessionType: 'STANDARD',
      decks: { create: deckIds.map((deckId) => ({ deckId })) },
      items: {
        create: items.map(({ cardId, direction }, position) => ({
          cardId,
          direction,
          position,
        })),
      },
    },
    include: { items: { orderBy: { position: 'asc' } } },
  });
}

/** The learner's progress on a card in one direction. */
function progressOf(cardId: string, direction: StudyDirection) {
  return prisma.cardProgress.findFirstOrThrow({
    where: { userId, cardId, direction },
  });
}

describe("a deck's own session", () => {
  it('records the deck it was built from, and gives each item its direction', async () => {
    const deck = await capitals('Europe', [
      ['France', 'Paris'],
      ['Spain', 'Madrid'],
    ]);

    for (const direction of ['FORWARD', 'REVERSE'] as const) {
      const session = await createCaller().study.startSession({
        deckId: deck.id,
        sessionType: 'QUICK',
        direction,
      });

      const recorded = await prisma.studySession.findUniqueOrThrow({
        where: { id: session!.id },
        include: { decks: true, items: true },
      });
      expect(recorded).toMatchObject({ kind: 'DECK', deckId: deck.id });
      expect(recorded.decks.map((row) => row.deckId)).toEqual([deck.id]);
      expect(recorded.items.map((item) => item.direction)).toEqual(
        recorded.items.map(() => direction),
      );

      await createCaller().study.abandonSession({ id: session!.id });
    }
  });

  it('gives a Retry the direction of the item it brings back', async () => {
    const deck = await capitals('Europe', [['France', 'Paris']]);
    const session = await createCaller().study.startSession({
      deckId: deck.id,
      direction: 'REVERSE',
    });

    const { retryItem } = await createCaller().study.dontKnow({
      itemId: session!.items[0].id,
    });

    const retry = await prisma.studySessionItem.findUniqueOrThrow({
      where: { id: retryItem!.id },
    });
    expect(retry).toMatchObject({ isRetry: true, direction: 'REVERSE' });
  });
});

describe("a session's items, each in its own direction", () => {
  it('answers each item in its own direction, on its own deck', async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const asia = await capitals('Asia', [['Japan', 'Tokyo']]);
    const review = await startReview([
      {
        cardId: europe.cards[0].id,
        deckId: europe.id,
        direction: 'FORWARD',
      },
      { cardId: asia.cards[0].id, deckId: asia.id, direction: 'REVERSE' },
    ]);
    const [forward, reverse] = review.items;

    // Forward asks for the city, Reverse for the country
    const paris = await createCaller().study.submitAnswer({
      itemId: forward.id,
      userAnswer: 'Paris',
    });
    const japan = await createCaller().study.submitAnswer({
      itemId: reverse.id,
      userAnswer: 'Japan',
    });

    expect(paris).toMatchObject({
      direction: 'FORWARD',
      recallGrade: 'NAILED',
    });
    expect(japan).toMatchObject({
      direction: 'REVERSE',
      recallGrade: 'NAILED',
    });
    expect(
      (await progressOf(europe.cards[0].id, 'FORWARD')).lifecycleState,
    ).toBe('LEARNING');
    expect(
      (await progressOf(europe.cards[0].id, 'REVERSE')).lifecycleState,
    ).toBe('NEW');
    expect((await progressOf(asia.cards[0].id, 'REVERSE')).lifecycleState).toBe(
      'LEARNING',
    );
    expect((await progressOf(asia.cards[0].id, 'FORWARD')).lifecycleState).toBe(
      'NEW',
    );
  });

  it("refuses an answer to a card whose deck was archived, and goes on with the others' cards", async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const asia = await capitals('Asia', [['Japan', 'Tokyo']]);
    const review = await startReview([
      {
        cardId: europe.cards[0].id,
        deckId: europe.id,
        direction: 'FORWARD',
      },
      { cardId: asia.cards[0].id, deckId: asia.id, direction: 'FORWARD' },
    ]);
    await prisma.deck.update({
      where: { id: europe.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      createCaller().study.submitAnswer({
        itemId: review.items[0].id,
        userAnswer: 'Paris',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createCaller().study.submitAnswer({
        itemId: review.items[1].id,
        userAnswer: 'Tokyo',
      }),
    ).resolves.toMatchObject({ recallGrade: 'NAILED' });
  });

  it('refuses a Reverse answer to a card whose deck is no longer studied that way', async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const review = await startReview([
      { cardId: europe.cards[0].id, deckId: europe.id, direction: 'REVERSE' },
    ]);
    await prisma.deck.update({
      where: { id: europe.id },
      data: { reversible: false },
    });

    await expect(
      createCaller().study.submitAnswer({
        itemId: review.items[0].id,
        userAnswer: 'France',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("accepts a Reverse answer as one of its card's fronts, and replays it in Reverse", async () => {
    const asia = await capitals('Asia', [['Japan', 'Tokyo']]);
    const [japan] = asia.cards;
    const review = await startReview([
      { cardId: japan.id, deckId: asia.id, direction: 'REVERSE' },
    ]);
    const missed = await createCaller().study.submitAnswer({
      itemId: review.items[0].id,
      userAnswer: 'Nippon',
    });
    expect(missed.recallGrade).toBe('MISSED');

    const accepted = await createCaller().study.acceptAnswer({
      attemptId: missed.id,
    });

    expect(accepted.recallGrade).not.toBe('MISSED');
    expect(
      (
        await prisma.reverseVariant.findMany({ where: { cardId: japan.id } })
      ).map((variant) => variant.text),
    ).toEqual(['Nippon']);
    expect((await progressOf(japan.id, 'REVERSE')).lifecycleState).toBe(
      'LEARNING',
    );
    expect((await progressOf(japan.id, 'FORWARD')).lifecycleState).toBe('NEW');
  });

  it('skips, on Mark known, only the waiting items in the directions marked', async () => {
    const europe = await capitals('Europe', [
      ['France', 'Paris'],
      ['Spain', 'Madrid'],
    ]);
    const [france, spain] = europe.cards;
    const review = await startReview([
      { cardId: france.id, deckId: europe.id, direction: 'FORWARD' },
      { cardId: spain.id, deckId: europe.id, direction: 'REVERSE' },
    ]);

    await createCaller().card.markKnown({
      cardIds: [france.id, spain.id],
      directions: ['REVERSE'],
    });

    const items = await prisma.studySessionItem.findMany({
      where: { studySessionId: review.id },
      orderBy: { position: 'asc' },
    });
    expect(items.map((item) => item.status)).toEqual(['PENDING', 'SKIPPED']);
  });

  /** Its status, now. */
  const statusOf = async (id: string) =>
    (await prisma.studySession.findUniqueOrThrow({ where: { id } })).status;

  it("abandons an unfinished Today's Review still to ask a deck's cards in Reverse once the deck is turned one-way", async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const review = await startReview([
      { cardId: europe.cards[0].id, deckId: europe.id, direction: 'REVERSE' },
    ]);

    await createCaller().deck.update({ id: europe.id, reversible: false });

    expect(await statusOf(review.id)).toBe('ABANDONED');
  });

  it("leaves a Today's Review asking the deck's cards Forward, done asking them in Reverse, or asking other decks' in Reverse", async () => {
    const europe = await capitals('Europe', [
      ['France', 'Paris'],
      ['Spain', 'Madrid'],
    ]);
    const asia = await capitals('Asia', [['Japan', 'Tokyo']]);
    const review = await startReview([
      { cardId: europe.cards[0].id, deckId: europe.id, direction: 'FORWARD' },
      { cardId: europe.cards[1].id, deckId: europe.id, direction: 'REVERSE' },
      { cardId: asia.cards[0].id, deckId: asia.id, direction: 'REVERSE' },
    ]);
    await createCaller().study.submitAnswer({
      itemId: review.items[1].id,
      userAnswer: 'Spain',
    });
    const asiaInReverse = await createCaller().study.startSession({
      deckId: asia.id,
      direction: 'REVERSE',
    });

    await createCaller().deck.update({ id: europe.id, reversible: false });

    expect(await statusOf(review.id)).toBe('ACTIVE');
    expect(await statusOf(asiaInReverse!.id)).toBe('ACTIVE');
  });
});

describe('Today’s Review, as the database holds it', () => {
  it('lets a learner have at most one unfinished Today’s Review', async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const item = {
      cardId: europe.cards[0].id,
      deckId: europe.id,
      direction: 'FORWARD' as const,
    };
    const first = await startReview([item]);

    await expect(startReview([item])).rejects.toMatchObject({ code: 'P2002' });

    // Once it's over, another can start; and another learner's is theirs
    await prisma.studySession.update({
      where: { id: first.id },
      data: { status: 'COMPLETED' },
    });
    await expect(startReview([item])).resolves.toBeTruthy();
    await expect(
      prisma.studySession.create({
        data: {
          userId: otherUserId,
          kind: 'TODAYS_REVIEW',
          sessionType: 'STANDARD',
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("holds a deck's own session to its deck, and a Today's Review to none of its own", async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const session = (data: object) =>
      prisma.studySession.create({
        data: { userId, sessionType: 'STANDARD', status: 'COMPLETED', ...data },
      });

    await expect(session({ kind: 'DECK' })).rejects.toThrow(
      /StudySession_deck_by_kind/,
    );
    await expect(
      session({ kind: 'TODAYS_REVIEW', deckId: europe.id }),
    ).rejects.toThrow(/StudySession_deck_by_kind/);
  });

  it('needs no deck of its own, and keeps its record of decks while it has them', async () => {
    const europe = await capitals('Europe', [['France', 'Paris']]);
    const asia = await capitals('Asia', [['Japan', 'Tokyo']]);
    const review = await startReview([
      {
        cardId: europe.cards[0].id,
        deckId: europe.id,
        direction: 'FORWARD',
      },
      { cardId: asia.cards[0].id, deckId: asia.id, direction: 'FORWARD' },
    ]);

    const decksOf = async () =>
      (
        await prisma.studySessionDeck.findMany({
          where: { studySessionId: review.id },
        })
      )
        .map((row) => row.deckId)
        .sort();
    expect(review.deckId).toBeNull();
    expect(await decksOf()).toEqual([europe.id, asia.id].sort());

    // Deleting a deck drops it from the record, not the session
    await prisma.deck.delete({ where: { id: europe.id } });
    expect(await decksOf()).toEqual([asia.id]);
    await expect(
      prisma.studySession.findUniqueOrThrow({ where: { id: review.id } }),
    ).resolves.toBeTruthy();
  });
});
