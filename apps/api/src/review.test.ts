import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import {
  createDeckWithCards,
  createTestPrisma,
  recordCardHistory,
} from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

/**
 * Today's Review (#137, ADR-0013): one Study Session across the decks
 * ticked for it, its queue pooled from them all by urgency.
 */

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
let otherUserId: string;

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

beforeAll(() => {
  ({ prisma, cleanup } = createTestPrisma());
});

beforeEach(async () => {
  await prisma.user.deleteMany();
  userId = (
    await prisma.user.create({
      data: { email: 'review@example.com', passwordHash: 'fakehash' },
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

function createCaller(asUserId = userId) {
  return appRouter.createCaller({
    prisma,
    userId: asUserId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

/** A deck of cards "<name> 1" to "<name> n", answered "A1" to "An". */
async function deckOf(
  n: number,
  name: string,
  { owner = userId, reversible = false } = {},
) {
  const deck = await createDeckWithCards(prisma, {
    userId: owner,
    name,
    cards: Array.from({ length: n }, (_, i) => ({
      front: `${name} ${i + 1}`,
      canonicalAnswers: [`A${i + 1}`],
    })),
  });
  if (reversible) {
    await prisma.deck.update({
      where: { id: deck.id },
      data: { reversible: true },
    });
  }
  return deck;
}

/** Makes a card due in Forward: missed long enough ago. */
function makeDue(cardId: string, overdueDays = 10) {
  return recordCardHistory(prisma, {
    userId,
    cardId,
    answers: [{ grade: 'MISSED', at: daysAgo(overdueDays) }],
  });
}

/** Answers a card well, just now, so it's neither due nor new. */
function catchUp(cardId: string) {
  return recordCardHistory(prisma, {
    userId,
    cardId,
    answers: [{ grade: 'GOOD', at: new Date() }],
  });
}

const preview = (choice = {}) => createCaller().study.reviewPreview(choice);
const start = (choice = {}) => createCaller().study.startReview(choice);

/** A started review's items, by the front each asks for, in queue order. */
async function startedFronts(choice = {}) {
  const review = await start(choice);
  return review!.items.map((item) => item.card.front);
}

function setLastActive(id: string, ago: number) {
  return prisma.studySession.update({
    where: { id },
    data: { updatedAt: new Date(Date.now() - ago) },
  });
}

const statusOf = async (id: string) =>
  (await prisma.studySession.findUniqueOrThrow({ where: { id } })).status;

describe("Today's Review's preview", () => {
  it('counts the ticked decks, each card once, however many ways its deck is studied', async () => {
    const capitals = await deckOf(3, 'Capitals', { reversible: true });
    await makeDue(capitals.cards[0].id);
    await deckOf(2, 'Italian');

    const { dueCount, newCount, deckCount, sessionSize } = await preview({
      sessionType: 'QUICK',
    });

    // Capitals 1 due, the rest of both decks new, Reverse as well as
    // Forward counted once
    expect({ dueCount, newCount, deckCount }).toEqual({
      dueCount: 1,
      newCount: 4,
      deckCount: 2,
    });
    expect(sessionSize).toBe(5);
  });

  it('leaves out unticked, archived and other learners’ decks', async () => {
    await deckOf(1, 'Ticked');
    const unticked = await deckOf(1, 'Unticked');
    const archived = await deckOf(1, 'Archived');
    await deckOf(1, 'Theirs', { owner: otherUserId });
    await createCaller().today.setDecksTicked({
      deckIds: [unticked.id],
      ticked: false,
    });
    await createCaller().deck.archive({ id: archived.id });

    expect(await preview()).toMatchObject({ newCount: 1, deckCount: 1 });
    expect(await startedFronts()).toEqual(['Ticked 1']);
  });

  it('says when the next card on a ticked deck comes due, once none is due or new', async () => {
    const ticked = await deckOf(1, 'Ticked');
    const unticked = await deckOf(1, 'Unticked');
    await catchUp(ticked.cards[0].id);
    await recordCardHistory(prisma, {
      userId,
      cardId: unticked.cards[0].id,
      answers: [{ grade: 'MISSED', at: new Date() }],
    });
    await createCaller().today.setDecksTicked({
      deckIds: [unticked.id],
      ticked: false,
    });
    const { dueAt } = await prisma.cardProgress.findFirstOrThrow({
      where: { cardId: ticked.cards[0].id, direction: 'FORWARD' },
    });

    expect(await preview()).toMatchObject({
      sessionSize: 0,
      dueCount: 0,
      newCount: 0,
      nextDueAt: dueAt,
    });
    expect(await start()).toBeNull();
  });

  it('paces each deck by its own Cram Date, under Cram', async () => {
    // Each card mastered, last answered two days ago, next due weeks off
    const dated = await deckOf(1, 'Dated');
    const later = await deckOf(1, 'Later');
    const undated = await deckOf(1, 'Undated');
    for (const deck of [dated, later, undated]) {
      await recordCardHistory(prisma, {
        userId,
        cardId: deck.cards[0].id,
        answers: [
          { grade: 'NAILED', at: daysAgo(40) },
          { grade: 'NAILED', at: daysAgo(30) },
          { grade: 'NAILED', at: daysAgo(2) },
        ],
      });
    }
    // Two days left, so a review two days old counts as due by the date;
    // with sixty left, it doesn't
    const inDays = (n: number) =>
      new Date(Date.now() + n * day).toISOString().slice(0, 10);
    await createCaller().deck.update({ id: dated.id, cramUntil: inDays(2) });
    await createCaller().deck.update({ id: later.id, cramUntil: inDays(60) });

    expect(await preview({ studyMode: 'STUDY' })).toMatchObject({
      dueCount: 0,
    });
    expect(await preview({ studyMode: 'CRAM' })).toMatchObject({
      dueCount: 1,
    });
    expect(await startedFronts({ studyMode: 'CRAM' })).toEqual(['Dated 1']);
  });
});

describe('starting Today’s Review', () => {
  it('records the ticked decks, and asks each card once, in the direction it chose', async () => {
    const capitals = await deckOf(2, 'Capitals', { reversible: true });
    const italian = await deckOf(1, 'Italian');
    // Reverse due, Forward new: Reverse is the more urgent
    await recordCardHistory(prisma, {
      userId,
      cardId: capitals.cards[0].id,
      direction: 'REVERSE',
      answers: [{ grade: 'MISSED', at: daysAgo(10) }],
    });

    const review = await start({ sessionType: 'QUICK' });

    const recorded = await prisma.studySession.findUniqueOrThrow({
      where: { id: review!.id },
      include: { decks: true },
    });
    expect(recorded).toMatchObject({ kind: 'TODAYS_REVIEW', deckId: null });
    expect(recorded.decks.map((row) => row.deckId).sort()).toEqual(
      [capitals.id, italian.id].sort(),
    );
    const asked = review!.items.map((item) => [
      item.card.front,
      item.direction,
    ]);
    expect(asked).toEqual(
      expect.arrayContaining([
        ['Capitals 1', 'REVERSE'],
        ['Capitals 2', 'FORWARD'],
        ['Italian 1', 'FORWARD'],
      ]),
    );
    expect(asked).toHaveLength(3);
  });

  it('takes new cards from each deck in turn', async () => {
    await deckOf(6, 'Big');
    await deckOf(2, 'Small');

    expect(await startedFronts({ sessionType: 'QUICK' })).toEqual([
      'Big 1',
      'Small 1',
      'Big 2',
      'Small 2',
      'Big 3',
    ]);
  });

  it("gives each item its card's deck, with its Direction Labels", async () => {
    const capitals = await deckOf(1, 'Capitals', { reversible: true });
    await prisma.deck.update({
      where: { id: capitals.id },
      data: { forwardLabel: 'Country → city', reverseLabel: 'City → country' },
    });

    const [item] = (await start())!.items;

    expect(item.card.deck).toEqual({
      id: capitals.id,
      name: 'Capitals',
      reversible: true,
      forwardLabel: 'Country → city',
      reverseLabel: 'City → country',
    });
  });

  it('answers, and brings a missed card back, as a deck’s session does', async () => {
    const capitals = await deckOf(2, 'Capitals', { reversible: true });
    await recordCardHistory(prisma, {
      userId,
      cardId: capitals.cards[0].id,
      direction: 'REVERSE',
      answers: [{ grade: 'MISSED', at: daysAgo(10) }],
    });
    const { items } = (await start())!;
    const byFront = (front: string) =>
      items.find((item) => item.card.front === front)!;
    expect(byFront('Capitals 1').direction).toBe('REVERSE');

    // Reverse asks for the front
    const answered = await createCaller().study.submitAnswer({
      itemId: byFront('Capitals 1').id,
      userAnswer: 'Capitals 1',
    });
    const missed = await createCaller().study.dontKnow({
      itemId: byFront('Capitals 2').id,
    });

    expect(answered).toMatchObject({
      direction: 'REVERSE',
      recallGrade: 'NAILED',
    });
    expect(missed.retryItem).not.toBeNull();
  });

  it('skips a card whose deck is archived mid-review, and goes on with the rest', async () => {
    const leaving = await deckOf(1, 'Leaving');
    await deckOf(1, 'Staying');
    const review = await start();
    const byFront = (front: string) =>
      review!.items.find((item) => item.card.front === front)!;
    await createCaller().deck.archive({ id: leaving.id });

    // Skipped at once, so resuming doesn't offer it
    const resumed = await createCaller().study.activeReview();
    expect(
      resumed!.items
        .filter((item) => item.status === 'PENDING')
        .map((item) => item.card.front),
    ).toEqual(['Staying 1']);
    await expect(
      createCaller().study.submitAnswer({
        itemId: byFront('Leaving 1').id,
        userAnswer: 'A1',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      (
        await prisma.studySessionItem.findUniqueOrThrow({
          where: { id: byFront('Leaving 1').id },
        })
      ).status,
    ).toBe('SKIPPED');
    await expect(
      createCaller().study.submitAnswer({
        itemId: byFront('Staying 1').id,
        userAnswer: 'A1',
      }),
    ).resolves.toMatchObject({ recallGrade: 'NAILED' });
  });

  it("refuses another learner's review", async () => {
    await deckOf(1, 'Mine');
    const review = await start();

    await expect(
      createCaller(otherUserId).study.submitAnswer({
        itemId: review!.items[0].id,
        userAnswer: 'A1',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createCaller(otherUserId).study.finishSession({ id: review!.id }),
    ).rejects.toThrow();
    expect(await createCaller(otherUserId).study.activeReview()).toBeNull();
  });

  it('refuses Review retired, which is a deck’s alone', async () => {
    await deckOf(1, 'Capitals');

    await expect(
      createCaller().study.startReview({
        // @ts-expect-error Review retired isn't a Today's Review mode
        studyMode: 'REVIEW_RETIRED',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('an unfinished Today’s Review', () => {
  it('is resumed, with its answers so far, for 24 hours after its last activity', async () => {
    await deckOf(3, 'Capitals');
    const review = await start();
    await createCaller().study.submitAnswer({
      itemId: review!.items[0].id,
      userAnswer: 'A1',
    });
    await setLastActive(review!.id, 24 * hour - 60_000);

    const active = await createCaller().study.activeReview();
    expect(active?.id).toBe(review!.id);
    expect(active?.items[0].attempts).toHaveLength(1);
    expect((await start())?.id).toBe(review!.id);
  });

  it('is abandoned, at its last activity, once older than that, and a new one starts', async () => {
    await deckOf(3, 'Capitals');
    const review = await start();
    await setLastActive(review!.id, 25 * hour);
    const { updatedAt } = await prisma.studySession.findUniqueOrThrow({
      where: { id: review!.id },
    });

    expect(await createCaller().study.activeReview()).toBeNull();
    const next = await start();

    expect(next?.id).not.toBe(review!.id);
    expect(
      await prisma.studySession.findUniqueOrThrow({
        where: { id: review!.id },
      }),
    ).toMatchObject({ status: 'ABANDONED', endedAt: updatedAt });
  });

  it('is one at most, however many starts come at once', async () => {
    await deckOf(3, 'Capitals');

    const [a, b] = await Promise.all([start(), start()]);

    expect(a?.id).toBe(b?.id);
  });
});

describe('sessions sharing a deck', () => {
  it('names, then ends, the unfinished deck sessions a review takes a deck from, keeping their answers', async () => {
    const capitals = await deckOf(2, 'Capitals');
    const italian = await deckOf(1, 'Italian');
    const unticked = await deckOf(1, 'Unticked');
    await createCaller().today.setDecksTicked({
      deckIds: [unticked.id],
      ticked: false,
    });
    const onCapitals = await createCaller().study.startSession({
      deckId: capitals.id,
    });
    await createCaller().study.submitAnswer({
      itemId: onCapitals!.items[0].id,
      userAnswer: 'A1',
    });
    const onUnticked = await createCaller().study.startSession({
      deckId: unticked.id,
    });

    expect((await preview()).wouldEnd).toEqual([
      { id: onCapitals!.id, kind: 'DECK', deckName: 'Capitals' },
    ]);

    await start();

    expect(await statusOf(onCapitals!.id)).toBe('ABANDONED');
    expect(
      await prisma.cardAttempt.count({
        where: { studySessionId: onCapitals!.id },
      }),
    ).toBe(1);
    expect(await statusOf(onUnticked!.id)).toBe('ACTIVE');
    expect(italian).toBeTruthy();
  });

  it("names, then ends, an unfinished review a deck's own session shares a deck with", async () => {
    const capitals = await deckOf(1, 'Capitals');
    const elsewhere = await deckOf(1, 'Elsewhere');
    await createCaller().today.setDecksTicked({
      deckIds: [elsewhere.id],
      ticked: false,
    });
    const review = await start();

    expect(
      (await createCaller().study.queuePreview({ deckId: elsewhere.id }))
        .wouldEnd,
    ).toEqual([]);
    await createCaller().study.startSession({ deckId: elsewhere.id });
    expect(await statusOf(review!.id)).toBe('ACTIVE');

    expect(
      (await createCaller().study.queuePreview({ deckId: capitals.id }))
        .wouldEnd,
    ).toEqual([{ id: review!.id, kind: 'TODAYS_REVIEW', deckName: null }]);
    await createCaller().study.startSession({ deckId: capitals.id });
    expect(await statusOf(review!.id)).toBe('ABANDONED');
  });

  it("lets two decks' own sessions wait together", async () => {
    const a = await deckOf(1, 'A');
    const b = await deckOf(1, 'B');

    const onA = await createCaller().study.startSession({ deckId: a.id });
    const onB = await createCaller().study.startSession({ deckId: b.id });

    expect(await statusOf(onA!.id)).toBe('ACTIVE');
    expect(await statusOf(onB!.id)).toBe('ACTIVE');
  });
});

describe('Today’s tile', () => {
  it("gives Today's Review's counts across the ticked decks, each card once, and an unfinished one", async () => {
    const capitals = await deckOf(2, 'Capitals', { reversible: true });
    await makeDue(capitals.cards[0].id);
    const unticked = await deckOf(1, 'Unticked');
    await createCaller().today.setDecksTicked({
      deckIds: [unticked.id],
      ticked: false,
    });

    const { review } = await createCaller().today.get();
    expect(review.todaysReview).toEqual({
      dueCount: 1,
      newCount: 1,
      deckCount: 1,
      unfinished: null,
    });

    const started = await start();
    await createCaller().study.submitAnswer({
      itemId: started!.items[0].id,
      userAnswer: 'A1',
    });
    expect(
      (await createCaller().today.get()).review.todaysReview.unfinished,
    ).toEqual({ answered: 1, size: started!.items.length });
  });
});
