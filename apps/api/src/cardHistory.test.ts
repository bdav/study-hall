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
import { Prisma, type PrismaClient } from '@prisma/client';
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
    data: { email: 'card-history@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: { email: 'other-history@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = other.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
});

afterEach(() => {
  vi.unstubAllEnvs();
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

/** A deck with "A prime between 10 and 20", answers 11 and 13. */
async function primeCard() {
  const deck = await createDeckWithCards(prisma, {
    userId,
    cards: [
      { front: 'A prime between 10 and 20', canonicalAnswers: ['11', '13'] },
    ],
  });
  return { deckId: deck.id, card: deck.cards[0] };
}

function answer(deckId: string, cardId: string, ...userAnswers: string[]) {
  return recordStudySession(prisma, {
    userId,
    deckId,
    answers: userAnswers.map((userAnswer) => ({ cardId, userAnswer })),
  });
}

function attemptsOf(history: {
  attempts: { userAnswer: string | null; recallGrade: string }[];
}) {
  return history.attempts.map(({ userAnswer, recallGrade }) => ({
    userAnswer,
    recallGrade,
  }));
}

describe('card.history', () => {
  it("lists the card's versions newest first, each with its answers newest first and how many were right", async () => {
    const { deckId, card } = await primeCard();
    await answer(deckId, card.id, '11');
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });
    await answer(deckId, card.id, 'nineteen', '17');

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions).toMatchObject([
      {
        number: 2,
        isCurrent: true,
        front: 'A prime between 10 and 20',
        canonicalAnswers: ['17'],
        answeredCount: 2,
        rightCount: 1,
      },
      {
        number: 1,
        isCurrent: false,
        canonicalAnswers: ['11', '13'],
        answeredCount: 1,
        rightCount: 1,
      },
    ]);
    expect(attemptsOf(history.versions[0])).toEqual([
      { userAnswer: '17', recallGrade: 'NAILED' },
      { userAnswer: 'nineteen', recallGrade: 'MISSED' },
    ]);
    expect(attemptsOf(history.versions[1])).toEqual([
      { userAnswer: '11', recallGrade: 'NAILED' },
    ]);
    expect(history.versions[0].attempts[0].createdAt).toBeInstanceOf(Date);
    expect(history.versions[1].startedAt).toBeInstanceOf(Date);
  });

  it('gives each earlier version when it ended, as the next one started', async () => {
    const { card } = await primeCard();
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });

    const [current, first] = (
      await createCaller().card.history({ cardId: card.id })
    ).versions;

    expect(current.endedAt).toBeNull();
    expect(first.endedAt).toEqual(current.startedAt);
  });

  it("lists the current version's answers primary first, as the card has them", async () => {
    const { card } = await primeCard();
    const [eleven, thirteen] = card.canonicalAnswers;
    // 13 made primary, which starts no version
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [
        { id: thirteen.id, text: '13', acceptedVariants: ['thirteen'] },
        { id: eleven.id, text: '11' },
      ],
    });

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions[0]).toMatchObject({
      canonicalAnswers: ['13', '11'],
      acceptedVariants: [['thirteen'], []],
    });
  });

  it('names the model behind a version a revision of the deck started', async () => {
    const { card } = await primeCard();
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });
    // As `deck.applyRevision` records it
    await prisma.cardVersion.updateMany({
      where: { cardId: card.id, number: 2 },
      data: { sourceModel: 'claude-sonnet-5-5', sourcePromptVersion: 'v1' },
    });

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions).toMatchObject([
      { number: 2, sourceModel: 'claude-sonnet-5-5' },
      { number: 1, sourceModel: null },
    ]);
  });

  it('offers to restore only an earlier version that asks something else', async () => {
    const { card } = await primeCard();
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });
    // Back to 11 and 13, primary changed: what version 1 asked
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '13' }, { text: '11' }],
    });

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions).toMatchObject([
      { number: 3, canRestore: false },
      { number: 2, canRestore: true },
      { number: 1, canRestore: false },
    ]);
  });

  describe("a version's Accepted Variants", () => {
    /** Gives the prime card's answers these variants, which starts no version. */
    function setVariants(
      card: Awaited<ReturnType<typeof primeCard>>['card'],
      eleven: string[],
      thirteen: string[],
    ) {
      const [a, b] = card.canonicalAnswers;
      return createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [
          { id: a.id, text: '11', acceptedVariants: eleven },
          { id: b.id, text: '13', acceptedVariants: thirteen },
        ],
      });
    }

    it('records the variants a version ended with when an edit starts the next', async () => {
      const { card } = await primeCard();
      await setVariants(card, ['eleven'], []);

      await createCaller().card.update({
        cardId: card.id,
        front: 'A prime between 10 and 20, please',
      });

      const history = await createCaller().card.history({ cardId: card.id });
      expect(history.versions[1]).toMatchObject({
        canonicalAnswers: ['11', '13'],
        acceptedVariants: [['eleven'], []],
      });
    });

    it('records nothing for an edit that only changes variants', async () => {
      const { card } = await primeCard();

      await setVariants(card, ['eleven'], ['thirteen']);

      const [version] = await prisma.cardVersion.findMany({
        where: { cardId: card.id },
      });
      expect(version.acceptedVariants).toBeNull();
    });

    it("gives the current version the card's own variants, as they are now", async () => {
      const { card } = await primeCard();
      await createCaller().card.update({
        cardId: card.id,
        front: 'A prime between 10 and 20, please',
      });
      await setVariants(card, [], ['thirteen']);

      const history = await createCaller().card.history({ cardId: card.id });
      expect(history.versions[0]).toMatchObject({
        isCurrent: true,
        acceptedVariants: [[], ['thirteen']],
      });
    });

    it("lists an earlier version's answers as it ended with them, primary first, each with its variants", async () => {
      const { card } = await primeCard();
      const [eleven, thirteen] = card.canonicalAnswers;
      // 13 made primary, which starts no version
      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [
          { id: thirteen.id, text: '13', acceptedVariants: ['thirteen'] },
          { id: eleven.id, text: '11' },
        ],
      });

      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [{ text: '17' }],
      });

      const history = await createCaller().card.history({ cardId: card.id });
      expect(history.versions[1]).toMatchObject({
        canonicalAnswers: ['13', '11'],
        acceptedVariants: [['thirteen'], []],
      });
    });

    it('has none for an earlier version that ended before variants were recorded', async () => {
      const { card } = await primeCard();
      await createCaller().card.update({
        cardId: card.id,
        front: 'A prime between 10 and 20, please',
      });
      // As versions that ended before #51 are
      await prisma.cardVersion.updateMany({
        where: { cardId: card.id, number: 1 },
        data: { acceptedVariants: Prisma.DbNull },
      });

      const history = await createCaller().card.history({ cardId: card.id });
      expect(history.versions[1].acceptedVariants).toBeNull();
    });
  });

  it('includes "I don\'t know", with no answer', async () => {
    const { deckId } = await primeCard();
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId });
    const [item] = session!.items;

    await caller.study.dontKnow({ itemId: item.id });

    const history = await caller.card.history({ cardId: item.card.id });
    expect(attemptsOf(history.versions[0])).toEqual([
      { userAnswer: null, recallGrade: 'MISSED' },
    ]);
  });

  it('shows the final grade of an answer "My answer was correct" regraded', async () => {
    const { deckId } = await primeCard();
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId });
    const [item] = session!.items;
    const attempt = await caller.study.submitAnswer({
      itemId: item.id,
      userAnswer: 'eleven',
    });

    await caller.study.acceptAnswer({ attemptId: attempt.id });

    const history = await caller.card.history({ cardId: item.card.id });
    expect(history.versions[0]).toMatchObject({
      answeredCount: 1,
      rightCount: 1,
      attempts: [{ userAnswer: 'eleven', recallGrade: 'NAILED' }],
    });
  });

  it('shows an answer that matched an Accepted Variant with its grade', async () => {
    const { deckId, card } = await primeCard();
    const caller = createCaller();
    const [eleven, thirteen] = card.canonicalAnswers;
    await caller.card.update({
      cardId: card.id,
      canonicalAnswers: [
        { id: eleven.id, text: '11', acceptedVariants: ['eleven'] },
        { id: thirteen.id, text: '13' },
      ],
    });
    const session = await caller.study.startSession({ deckId });

    await caller.study.submitAnswer({
      itemId: session!.items[0].id,
      userAnswer: 'eleven',
    });

    const history = await caller.card.history({ cardId: card.id });
    expect(history.versions[0]).toMatchObject({
      rightCount: 1,
      attempts: [{ userAnswer: 'eleven', recallGrade: 'NAILED' }],
    });
  });

  it('counts an answer wrong only in its accents as right', async () => {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: [{ front: 'Capital of Brazil', canonicalAnswers: ['Brasília'] }],
    });
    const [card] = deck.cards;
    await answer(deck.id, card.id, 'Brasilia');

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions[0]).toMatchObject({
      rightCount: 1,
      attempts: [{ userAnswer: 'Brasilia', recallGrade: 'GOOD' }],
    });
  });

  it('puts attempts with no recorded version under an earlier version', async () => {
    const { deckId, card } = await primeCard();
    const session = await answer(deckId, card.id, '11');
    // Answered before versions were recorded
    await prisma.cardAttempt.create({
      data: {
        studySessionId: session.id,
        cardId: card.id,
        userAnswer: 'twelve',
        recallGrade: 'MISSED',
        createdAt: new Date('2026-01-01'),
      },
    });

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions[0].answeredCount).toBe(1);
    expect(history.unversioned).toMatchObject({
      answeredCount: 1,
      rightCount: 0,
      attempts: [{ userAnswer: 'twelve', recallGrade: 'MISSED' }],
    });
  });

  it('has no earlier version when every attempt has its version', async () => {
    const { deckId, card } = await primeCard();
    await answer(deckId, card.id, '11');

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.unversioned).toBeNull();
  });

  it("gives the card's lifecycle state and when it's next due, never its mastery score", async () => {
    const { deckId } = await primeCard();
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId });
    const [item] = session!.items;
    await caller.study.submitAnswer({ itemId: item.id, userAnswer: '13' });

    const history = await caller.card.history({ cardId: item.card.id });

    expect(history.progress).toEqual({
      lifecycleState: 'LEARNING',
      dueAt: expect.any(Date),
      isKnown: false,
    });
  });

  it('says when the card is already known', async () => {
    const { card } = await primeCard();
    await createCaller().card.markKnown({ cardIds: [card.id] });

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.progress).toMatchObject({
      lifecycleState: 'STABLE',
      isKnown: true,
    });
  });

  it('works for a learner without AI access', async () => {
    vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');
    const { card } = await primeCard();

    const history = await createCaller().card.history({ cardId: card.id });

    expect(history.versions).toHaveLength(1);
  });

  it.each([
    ["another user's card", () => primeCard().then(({ card }) => card.id)],
    ['a nonexistent card', async () => 'nonexistent-id'],
  ])("won't show %s", async (_, cardIdOf) => {
    const cardId = await cardIdOf();

    await expect(
      createCaller(otherUserId).card.history({ cardId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
