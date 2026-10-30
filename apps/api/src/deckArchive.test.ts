import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
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
const ai = createFakeAiProvider();

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'deck-archive@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-deck-archive@example.com', passwordHash: 'x' },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
  await prisma.course.deleteMany({});
  ai.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await cleanup();
});

function createCaller(overrideUserId?: string) {
  return appRouter.createCaller({
    prisma,
    userId: overrideUserId ?? userId,
    sessionToken: null,
    ai,
  });
}

function deckWithCard(name = 'Italian') {
  return createDeckWithCards(prisma, {
    userId,
    name,
    cards: [{ front: 'ciao', canonicalAnswers: ['hello'] }],
  });
}

/** An accepted course and its Course Deck, archived or not. */
async function courseWithDeck({ archived = false } = {}) {
  const course = await prisma.course.create({
    data: {
      userId,
      title: 'Spanish',
      topic: 'Spanish',
      goal: 'A2',
      priorKnowledge: '',
      minutesPerWeek: 120,
      sessionMinutes: 30,
      depth: 'practical',
      notes: '',
      archivedAt: archived ? new Date() : null,
      proposal: {
        create: {
          lessons: [{ title: 'Greetings', objectives: ['Say hello'] }],
          model: 'claude-sonnet-5-5',
          promptVersion: 'syllabus-v5',
          acceptedAt: new Date(),
        },
      },
    },
  });
  const deck = await prisma.deck.create({
    data: { userId, courseId: course.id, name: 'Spanish' },
  });
  return { course, deck };
}

const conflict = expect.objectContaining({ code: 'CONFLICT' });
const notFound = expect.objectContaining({ code: 'NOT_FOUND' });

describe('archiving a deck', () => {
  it('takes it out of Flashcards, keeping its cards, progress and Study Sessions', async () => {
    const deck = await deckWithCard();
    await recordStudySession(prisma, {
      userId,
      deckId: deck.id,
      answers: [{ cardId: deck.cards[0].id, userAnswer: 'hello' }],
    });
    const caller = createCaller();

    await caller.deck.archive({ id: deck.id });

    expect(await caller.deck.list()).toEqual([]);
    expect(await prisma.card.count({ where: { deckId: deck.id } })).toBe(1);
    expect(await prisma.cardProgress.count()).toBe(1);
    expect(await prisma.cardAttempt.count()).toBe(1);
    expect(await prisma.studySession.count()).toBe(1);
    expect((await caller.deck.getById({ id: deck.id })).archivedAt).toEqual(
      expect.any(Date),
    );
  });

  it('lists archived decks, most recently archived first, with their cards and course', async () => {
    const older = await deckWithCard('Older');
    const newer = await deckWithCard('Newer');
    const { deck: courseDeck } = await courseWithDeck({ archived: true });
    const caller = createCaller();
    await caller.deck.archive({ id: older.id });
    await caller.deck.archive({ id: newer.id });
    await caller.deck.archive({ id: courseDeck.id });

    const archived = await caller.deck.listArchived();

    expect(archived.map((deck) => deck.name)).toEqual([
      'Spanish',
      'Newer',
      'Older',
    ]);
    expect(archived[1]).toMatchObject({
      id: newer.id,
      cardCount: 1,
      archivedAt: expect.any(Date),
      course: null,
    });
    expect(archived[0].course).toMatchObject({ title: 'Spanish' });
  });

  it('leaves archived decks out of overall stats', async () => {
    const kept = await deckWithCard('Kept');
    const archived = await deckWithCard('Archived');
    for (const deck of [kept, archived]) {
      await recordStudySession(prisma, {
        userId,
        deckId: deck.id,
        answers: [{ cardId: deck.cards[0].id, userAnswer: 'hello' }],
      });
    }
    const caller = createCaller();

    await caller.deck.archive({ id: archived.id });

    expect(await caller.stats.overallStats()).toMatchObject({
      totalAttempts: 1,
      deckCount: 1,
    });
  });

  it('refuses a deck already archived', async () => {
    const deck = await deckWithCard();
    const caller = createCaller();
    await caller.deck.archive({ id: deck.id });

    await expect(caller.deck.archive({ id: deck.id })).rejects.toThrow(
      conflict,
    );
  });

  it("refuses a Course Deck while its course is active, but not once it's archived", async () => {
    const caller = createCaller();
    const active = await courseWithDeck();

    await expect(caller.deck.archive({ id: active.deck.id })).rejects.toThrow(
      conflict,
    );
    expect(await caller.deck.list()).toHaveLength(1);

    await prisma.course.update({
      where: { id: active.course.id },
      data: { archivedAt: new Date() },
    });
    await caller.deck.archive({ id: active.deck.id });
    expect(await caller.deck.list()).toEqual([]);
  });
});

describe('restoring a deck', () => {
  it('puts it back in Flashcards as it was, its due dates included', async () => {
    const deck = await deckWithCard();
    const caller = createCaller();
    const before = await prisma.cardProgress.findFirstOrThrow();
    await caller.deck.archive({ id: deck.id });

    await caller.deck.restore({ id: deck.id });

    expect((await caller.deck.list()).map((d) => d.id)).toEqual([deck.id]);
    expect(await caller.deck.listArchived()).toEqual([]);
    expect(await prisma.cardProgress.findFirstOrThrow()).toEqual(before);
  });

  it('refuses a deck that is not archived', async () => {
    const deck = await deckWithCard();

    await expect(createCaller().deck.restore({ id: deck.id })).rejects.toThrow(
      conflict,
    );
  });

  it('comes back with its course, and a restored course without a deck gets one', async () => {
    const caller = createCaller();
    const withDeck = await courseWithDeck({ archived: true });
    await caller.deck.archive({ id: withDeck.deck.id });

    await caller.course.restore({ courseId: withDeck.course.id });

    expect((await caller.deck.list()).map((d) => d.id)).toEqual([
      withDeck.deck.id,
    ]);

    // Its deck deleted for good while the course was archived
    const withoutDeck = await courseWithDeck({ archived: true });
    await caller.deck.archive({ id: withoutDeck.deck.id });
    await caller.deck.delete({ id: withoutDeck.deck.id });

    await caller.course.restore({ courseId: withoutDeck.course.id });

    const { deckId, review } = await caller.course.getById({
      id: withoutDeck.course.id,
    });
    expect(deckId).toEqual(expect.any(String));
    expect(review).toMatchObject({ deckId });
  });
});

describe('deleting a deck permanently', () => {
  it('deletes an archived deck and its cards', async () => {
    const deck = await deckWithCard();
    const caller = createCaller();
    await caller.deck.archive({ id: deck.id });

    await caller.deck.delete({ id: deck.id });

    expect(await prisma.deck.count()).toBe(0);
    expect(await prisma.card.count()).toBe(0);
    expect(await caller.deck.listArchived()).toEqual([]);
  });

  it('refuses a deck that is not archived, Course Decks included', async () => {
    const deck = await deckWithCard();
    const { deck: courseDeck } = await courseWithDeck();
    const caller = createCaller();

    for (const id of [deck.id, courseDeck.id]) {
      await expect(caller.deck.delete({ id })).rejects.toThrow(conflict);
    }
    expect(await prisma.deck.count()).toBe(2);
  });
});

describe('an archived deck', () => {
  it('refuses studying, editing, importing and revising', async () => {
    const deck = await deckWithCard();
    const [card] = deck.cards;
    const caller = createCaller();
    await caller.deck.archive({ id: deck.id });
    const version = await prisma.cardVersion.findFirstOrThrow({
      where: { cardId: card.id },
    });
    vi.stubEnv('AI_ALLOWED_EMAILS', 'deck-archive@example.com');
    vi.stubEnv('AI_MONTHLY_CAP_USD', '100');

    const attempts = [
      () => caller.study.startSession({ deckId: deck.id }),
      () => caller.deck.update({ id: deck.id, name: 'Renamed' }),
      () =>
        caller.card.create({
          deckId: deck.id,
          front: 'grazie',
          canonicalAnswers: ['thanks'],
        }),
      () => caller.card.update({ cardId: card.id, front: 'salve' }),
      () => caller.card.delete({ cardId: card.id }),
      () => caller.card.deleteMany({ cardIds: [card.id] }),
      () => caller.card.markKnown({ cardIds: [card.id] }),
      () =>
        caller.card.restoreVersion({ cardId: card.id, versionId: version.id }),
      () =>
        caller.card.importCards({
          deckId: deck.id,
          new: [{ front: 'grazie', canonicalAnswers: ['thanks'] }],
          update: [],
        }),
      () =>
        caller.deck.proposeRevision({
          deckId: deck.id,
          instruction: 'Shorter fronts',
        }),
      () =>
        caller.deck.applyRevision({
          deckId: deck.id,
          model: 'claude-sonnet-5-5',
          promptVersion: 'card-revision-v3',
          edits: [],
          deletions: [card.id],
        }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(conflict);
    }

    expect(ai.requests).toHaveLength(0);
    expect(await prisma.studySession.count()).toBe(0);
    expect(await prisma.card.findMany({ where: { deckId: deck.id } })).toEqual([
      expect.objectContaining({ front: 'ciao' }),
    ]);
    expect(
      await prisma.deck.findUniqueOrThrow({ where: { id: deck.id } }),
    ).toMatchObject({ name: 'Italian' });
  });

  it('refuses answering in a session started before it was archived, and "My answer was correct"', async () => {
    const deck = await deckWithCard();
    const caller = createCaller();
    await recordStudySession(prisma, {
      userId,
      deckId: deck.id,
      answers: [{ cardId: deck.cards[0].id, userAnswer: 'goodbye' }],
    });
    const missed = await prisma.cardAttempt.findFirstOrThrow();
    const session = await caller.study.startSession({ deckId: deck.id });
    const [item] = session!.items;
    const progressBefore = await prisma.cardProgress.findFirstOrThrow();
    await caller.deck.archive({ id: deck.id });

    for (const attempt of [
      () => caller.study.submitAnswer({ itemId: item.id, userAnswer: 'hello' }),
      () => caller.study.dontKnow({ itemId: item.id }),
      () => caller.study.acceptAnswer({ attemptId: missed.id }),
    ]) {
      await expect(attempt()).rejects.toThrow(conflict);
    }
    expect(await prisma.cardAttempt.count()).toBe(1);
    expect(await prisma.acceptedVariant.count()).toBe(0);
    expect(await prisma.cardProgress.findFirstOrThrow()).toEqual(
      progressBefore,
    );
  });

  it('takes no review cards, and leaves its course page without Review', async () => {
    const caller = createCaller();
    const { course, deck } = await courseWithDeck({ archived: true });
    const lesson = await prisma.lesson.create({
      data: {
        courseId: course.id,
        title: 'Greetings',
        objectives: ['Say hello'],
        position: 0,
      },
    });
    await caller.deck.archive({ id: deck.id });

    await expect(
      caller.lesson.createReviewCards({
        id: lesson.id,
        model: 'claude-sonnet-5-5',
        promptVersion: 'card-proposal-v1',
        cards: [{ type: 'TYPED_RECALL', front: 'hola', canonicalAnswer: 'hi' }],
      }),
    ).rejects.toThrow(conflict);
    expect(await prisma.card.count()).toBe(0);
    expect((await caller.course.getById({ id: course.id })).review).toBeNull();
  });

  it('can still be read: its cards, history and stats', async () => {
    const deck = await deckWithCard();
    const caller = createCaller();
    await caller.deck.archive({ id: deck.id });

    expect(await caller.card.listByDeck({ deckId: deck.id })).toHaveLength(1);
    await expect(
      caller.card.history({ cardId: deck.cards[0].id }),
    ).resolves.toBeDefined();
    await expect(
      caller.stats.deckStats({ deckId: deck.id }),
    ).resolves.toBeDefined();
  });
});

describe('ownership', () => {
  it("hides another learner's deck from archiving, restoring and deleting", async () => {
    const deck = await deckWithCard();
    const stranger = createCaller(otherUserId);

    await expect(stranger.deck.archive({ id: deck.id })).rejects.toThrow(
      notFound,
    );
    await createCaller().deck.archive({ id: deck.id });
    await expect(stranger.deck.restore({ id: deck.id })).rejects.toThrow(
      notFound,
    );
    await expect(stranger.deck.delete({ id: deck.id })).rejects.toThrow(
      notFound,
    );
    expect(await stranger.deck.listArchived()).toEqual([]);
    expect(await prisma.deck.count()).toBe(1);
  });
});
