import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';
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
      { front: 'Capital of France', canonicalAnswers: ['Paris'] },
      { front: 'Capital of Japan', canonicalAnswers: ['Tokyo'] },
      { front: 'Capital of Brazil', canonicalAnswers: ['Brasília'] },
    ],
  });
  deckId = deck.id;
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
  { front: 'Capital of France', canonicalAnswers: ['Paris'] },
  { front: 'Capital of Japan', canonicalAnswers: ['Tokyo'] },
  { front: 'Capital of Brazil', canonicalAnswers: ['Brasília'] },
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
        { front: 'Due an hour ago', canonicalAnswers: ['A'] },
        { front: 'Due tomorrow', canonicalAnswers: ['B'] },
        { front: 'New', canonicalAnswers: ['C'] },
        { front: 'Due two hours ago', canonicalAnswers: ['D'] },
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
          canonicalAnswers: [`A${i}`],
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
      const deck = await deckWith([{ front: 'Q', canonicalAnswers: ['A'] }]);
      await scheduleCard(deck.cards[0].id, new Date(Date.now() + 60 * 1000));

      const session = await createCaller().study.startSession({
        deckId: deck.id,
      });

      expect(session).toBeNull();
    });
  });

  describe('queuePreview', () => {
    it('counts the cards a session would hold: due ones, then NEW ones', async () => {
      const deck = await deckWith([
        { front: 'Due', canonicalAnswers: ['A'] },
        { front: 'Later', canonicalAnswers: ['B'] },
        { front: 'New', canonicalAnswers: ['C'] },
      ]);
      const later = new Date(Date.now() + 60 * 60 * 1000);
      await scheduleCard(deck.cards[0].id, new Date(Date.now() - 60 * 1000));
      await scheduleCard(deck.cards[1].id, later);

      const preview = await createCaller().study.queuePreview({
        deckId: deck.id,
      });

      expect(preview).toEqual({
        sessionSize: 2,
        dueCount: 1,
        newCount: 1,
        nextDueAt: later,
      });
    });

    it('holds at most 25, the Standard size', async () => {
      const deck = await deckWith(
        Array.from({ length: 30 }, (_, i) => ({
          front: `Q${i}`,
          canonicalAnswers: [`A${i}`],
        })),
      );

      const preview = await createCaller().study.queuePreview({
        deckId: deck.id,
      });

      expect(preview).toMatchObject({ sessionSize: 25, newCount: 30 });
    });

    it('says when the next card is due when nothing is due now', async () => {
      const deck = await deckWith([
        { front: 'Q1', canonicalAnswers: ['A1'] },
        { front: 'Q2', canonicalAnswers: ['A2'] },
      ]);
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      await scheduleCard(deck.cards[0].id, soon);
      await scheduleCard(deck.cards[1].id, new Date(soon.getTime() + 1000));

      const preview = await createCaller().study.queuePreview({
        deckId: deck.id,
      });

      expect(preview).toEqual({
        sessionSize: 0,
        dueCount: 0,
        newCount: 0,
        nextDueAt: soon,
      });
    });

    it("refuses another user's deck", async () => {
      const deck = await deckWith(capitals);
      const other = await prisma.user.create({
        data: { email: `preview-${Date.now()}@example.com`, passwordHash: 'x' },
      });
      const otherCaller = appRouter.createCaller({
        prisma,
        userId: other.id,
        sessionToken: null,
        ai: createFakeAiProvider(),
      });

      await expect(
        otherCaller.study.queuePreview({ deckId: deck.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

    it('grades an Accent Mismatch GOOD, reports it and schedules the card as GOOD', async () => {
      const { items } = await startedSession(capitals);
      const brazil = items[2];
      const before = Date.now();

      const attempt = await createCaller().study.submitAnswer({
        itemId: brazil.id,
        userAnswer: 'Brasilia',
      });

      expect(attempt).toMatchObject({
        recallGrade: 'GOOD',
        accentMismatch: true,
      });
      // GOOD on a LEARNING card is due again in 1 day
      const oneDay = 24 * 60 * 60 * 1000;
      const progress = await progressOf(brazil.cardId);
      expect(progress.dueAt!.getTime()).toBeGreaterThanOrEqual(before + oneDay);
      expect(progress.dueAt!.getTime()).toBeLessThanOrEqual(
        Date.now() + oneDay,
      );
    });

    it('accepts an answer matching an Accepted Variant as it would the Canonical Answer, and says the variant matched', async () => {
      const { items } = await startedSession([
        { front: 'Largest US city', canonicalAnswers: ['New York City'] },
      ]);
      const [item] = items;
      const caller = createCaller();
      // Added after the session started, as an edit while studying is
      const [answer] = item.card.canonicalAnswers;
      await caller.card.update({
        cardId: item.card.id,
        canonicalAnswers: [
          { id: answer.id, text: answer.text, acceptedVariants: ['NYC'] },
        ],
      });

      const attempt = await caller.study.submitAnswer({
        itemId: item.id,
        userAnswer: 'nyc',
      });

      expect(attempt).toMatchObject({
        recallGrade: 'NAILED',
        accentMismatch: false,
        matchedVariant: 'NYC',
      });
      // Scheduled as NAILED: mastery 2
      expect((await progressOf(item.cardId)).masteryScore).toBe(2);
    });

    it("accepts any of the card's Canonical Answers and says which matched", async () => {
      const { items } = await startedSession([
        { front: 'A prime between 10 and 20', canonicalAnswers: ['11'] },
      ]);
      const [item] = items;
      await prisma.canonicalAnswer.create({
        data: { cardId: item.cardId, text: '13' },
      });

      const attempt = await createCaller().study.submitAnswer({
        itemId: item.id,
        userAnswer: '13',
      });

      expect(attempt).toMatchObject({
        recallGrade: 'NAILED',
        matchedAnswer: '13',
        matchedVariant: null,
      });
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
      // A first NAILED is due again in 1 day, as GOOD would be
      const oneDay = 24 * 60 * 60 * 1000;
      expect(progress.dueAt!.getTime()).toBeGreaterThanOrEqual(before + oneDay);
      expect(progress.dueAt!.getTime()).toBeLessThanOrEqual(
        Date.now() + oneDay,
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

  describe('acceptAnswer ("My answer was correct")', () => {
    /** A session on one card whose answer was just graded MISSED. */
    async function missedAnswer(userAnswer = 'NYC') {
      const { items } = await startedSession([
        { front: 'Largest US city', canonicalAnswers: ['New York City'] },
      ]);
      const [item] = items;
      const attempt = await createCaller().study.submitAnswer({
        itemId: item.id,
        userAnswer,
      });
      expect(attempt.recallGrade).toBe('MISSED');
      return { item, attempt };
    }

    it('adds the answer as an Accepted Variant and grades it again', async () => {
      const { attempt } = await missedAnswer();

      const accepted = await createCaller().study.acceptAnswer({
        attemptId: attempt.id,
      });

      expect(accepted).toMatchObject({
        recallGrade: 'NAILED',
        accentMismatch: false,
        matchedVariant: 'NYC',
      });
      expect(
        accepted.card.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['NYC']);
    });

    const DAY_MS = 24 * 60 * 60 * 1000;

    it("corrects the card's progress as if the answer had been graded NAILED", async () => {
      const { item, attempt } = await missedAnswer();

      await createCaller().study.acceptAnswer({ attemptId: attempt.id });

      // A first NAILED: LEARNING, mastery 2, due in 1 day as GOOD would be
      const progress = await progressOf(item.cardId);
      expect(progress).toMatchObject({
        lifecycleState: 'LEARNING',
        masteryScore: 2,
        lastIntervalDays: 1,
        lastReviewedAt: attempt.createdAt,
      });
      expect(progress.dueAt).toEqual(
        new Date(attempt.createdAt.getTime() + DAY_MS),
      );
    });

    /** Answers the card of a one-card deck in a new session, due or not. */
    async function answerAgain(
      cardId: string,
      deckId: string,
      userAnswer: string,
    ) {
      await scheduleCard(cardId, new Date(Date.now() - 60 * 1000));
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });
      return caller.study.submitAnswer({
        itemId: session!.items[0].id,
        userAnswer,
      });
    }

    it("replays the card's earlier answers with the corrected one", async () => {
      const deck = await deckWith([
        { front: 'Largest US city', canonicalAnswers: ['New York City'] },
      ]);
      const cardId = deck.cards[0].id;
      await answerAgain(cardId, deck.id, 'New York City');
      const missed = await answerAgain(cardId, deck.id, 'NYC');

      await createCaller().study.acceptAnswer({ attemptId: missed.id });

      // NAILED in two sessions: mastery 0 → 2 → 4, and STABLE, due 4 days
      // after the second (NAILED on a fragile card)
      const progress = await progressOf(cardId);
      expect(progress.masteryScore).toBe(4);
      expect(progress.lifecycleState).toBe('STABLE');
      expect(progress.dueAt).toEqual(
        new Date(missed.createdAt.getTime() + 4 * DAY_MS),
      );
    });

    it('leaves out answers given before the card was last edited', async () => {
      const deck = await deckWith([
        { front: 'Largest US city', canonicalAnswers: ['New York'] },
      ]);
      const cardId = deck.cards[0].id;
      await answerAgain(cardId, deck.id, 'New York');
      await createCaller().card.update({
        cardId,
        canonicalAnswers: [{ text: 'New York City' }],
      });
      const missed = await answerAgain(cardId, deck.id, 'NYC');

      await createCaller().study.acceptAnswer({ attemptId: missed.id });

      // Only the accepted answer counts since the edit: mastery 0 → 2
      expect((await progressOf(cardId)).masteryScore).toBe(2);
    });

    it('grades again without a duplicate when the answer was accepted since', async () => {
      const { item, attempt } = await missedAnswer();
      const caller = createCaller();
      const [answer] = item.card.canonicalAnswers;
      await caller.card.update({
        cardId: item.card.id,
        canonicalAnswers: [
          { id: answer.id, text: answer.text, acceptedVariants: ['nyc'] },
        ],
      });

      const accepted = await caller.study.acceptAnswer({
        attemptId: attempt.id,
      });

      expect(accepted).toMatchObject({
        recallGrade: 'NAILED',
        matchedVariant: 'nyc',
      });
      expect(
        accepted.card.canonicalAnswers[0].acceptedVariants.map((v) => v.text),
      ).toEqual(['nyc']);
    });

    it('adds the answer to the Canonical Answer the learner picks', async () => {
      const { item, attempt } = await missedAnswer();
      // Cards get more than one Canonical Answer with #3
      const second = await prisma.canonicalAnswer.create({
        data: { cardId: item.cardId, text: 'New York' },
      });

      const accepted = await createCaller().study.acceptAnswer({
        attemptId: attempt.id,
        canonicalAnswerId: second.id,
      });

      expect(accepted).toMatchObject({
        recallGrade: 'NAILED',
        matchedVariant: 'NYC',
      });
      const variants = await prisma.acceptedVariant.findMany({
        where: { canonicalAnswer: { cardId: item.cardId } },
        select: { text: true, canonicalAnswerId: true },
      });
      expect(variants).toEqual([{ text: 'NYC', canonicalAnswerId: second.id }]);
    });

    it('refuses a Canonical Answer of another card', async () => {
      const { attempt } = await missedAnswer();
      const other = await deckWith([{ front: 'Q', canonicalAnswers: ['A'] }]);

      await expect(
        createCaller().study.acceptAnswer({
          attemptId: attempt.id,
          canonicalAnswerId: other.cards[0].canonicalAnswers[0].id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it.each([
      ['an answer graded right', 'New York City'],
      ['"I don\'t know"', null],
    ])('refuses %s', async (_, userAnswer) => {
      const { items } = await startedSession([
        { front: 'Largest US city', canonicalAnswers: ['New York City'] },
      ]);
      const caller = createCaller();
      const attempt =
        userAnswer === null
          ? await caller.study.dontKnow({ itemId: items[0].id })
          : await caller.study.submitAnswer({
              itemId: items[0].id,
              userAnswer,
            });

      await expect(
        caller.study.acceptAnswer({ attemptId: attempt.id }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses an answer already accepted', async () => {
      const { attempt } = await missedAnswer();
      const caller = createCaller();
      await caller.study.acceptAnswer({ attemptId: attempt.id });

      await expect(
        caller.study.acceptAnswer({ attemptId: attempt.id }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('refuses an answer to the card before it was last edited, changing nothing', async () => {
      const { item, attempt } = await missedAnswer();
      const caller = createCaller();
      await caller.card.update({
        cardId: item.cardId,
        front: 'Biggest US city',
      });

      await expect(
        caller.study.acceptAnswer({ attemptId: attempt.id }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const [card] = await caller.card.listByDeck({ deckId: item.card.deckId });
      expect(card.canonicalAnswers[0].acceptedVariants).toEqual([]);
    });

    it('refuses an answer grading could never accept, changing nothing', async () => {
      const { item, attempt } = await missedAnswer('?');

      await expect(
        createCaller().study.acceptAnswer({ attemptId: attempt.id }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const [card] = await createCaller().card.listByDeck({
        deckId: item.card.deckId,
      });
      expect(card.canonicalAnswers[0].acceptedVariants).toEqual([]);
    });

    it("refuses another user's answer, changing nothing", async () => {
      const { item, attempt } = await missedAnswer();
      const other = await prisma.user.create({
        data: { email: `accept-${Date.now()}@example.com`, passwordHash: 'x' },
      });
      const otherCaller = appRouter.createCaller({
        prisma,
        userId: other.id,
        sessionToken: null,
        ai: createFakeAiProvider(),
      });

      await expect(
        otherCaller.study.acceptAnswer({ attemptId: attempt.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await progressOf(item.cardId)).masteryScore).toBe(0);
    });

    it('keeps one attempt, now final, recording the grade it first had', async () => {
      const { attempt } = await missedAnswer();

      await createCaller().study.acceptAnswer({ attemptId: attempt.id });

      const attempts = await prisma.cardAttempt.findMany({
        where: { studySessionId: attempt.studySessionId },
      });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        id: attempt.id,
        userAnswer: 'NYC',
        recallGrade: 'NAILED',
        initialSuggestedGrade: 'MISSED',
        refinementApplied: true,
        gradingMethod: 'REFINED_VARIANT',
      });
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
        ai: createFakeAiProvider(),
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

describe('the card lifecycle across Study Sessions', () => {
  const france: NewCard[] = [
    { front: 'Capital of France', canonicalAnswers: ['Paris'] },
  ];

  /** Answers the deck's one card in a session of its own, then finishes it. */
  async function answerInNewSession(deckId: string, userAnswer: string) {
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId });
    if (!session) throw new Error('Expected a session to start');
    const attempt = await caller.study.submitAnswer({
      itemId: session.items[0].id,
      userAnswer,
    });
    await caller.study.finishSession({ id: session.id });
    return attempt;
  }

  /** Makes the card due now, as if its interval had passed. */
  async function dueNow(cardId: string) {
    await prisma.cardProgress.update({
      where: { userId_cardId: { userId, cardId } },
      data: { dueAt: new Date(Date.now() - 1000) },
    });
  }

  it('graduates a card recalled in two Study Sessions to STABLE, on the STABLE table', async () => {
    const deck = await deckWith(france);
    const [card] = deck.cards;

    await answerInNewSession(deck.id, 'Paris');
    expect(await progressOf(card.id)).toMatchObject({
      lifecycleState: 'LEARNING',
      masteryScore: 2,
      // A first NAILED is scheduled as GOOD
      lastIntervalDays: 1,
    });

    await dueNow(card.id);
    await answerInNewSession(deck.id, 'Paris');

    // NAILED on a fragile (mastery 2) STABLE card is 4 days
    expect(await progressOf(card.id)).toMatchObject({
      lifecycleState: 'STABLE',
      masteryScore: 4,
      lastIntervalDays: 4,
    });
  });

  it('graduates a card when "My answer was correct" turns its second session\'s miss into a success', async () => {
    const deck = await deckWith(france);
    const [card] = deck.cards;

    await answerInNewSession(deck.id, 'Paris');
    await dueNow(card.id);
    const missed = await answerInNewSession(deck.id, 'Paris, France');
    expect((await progressOf(card.id)).lifecycleState).toBe('LEARNING');

    await createCaller().study.acceptAnswer({ attemptId: missed.id });

    expect((await progressOf(card.id)).lifecycleState).toBe('STABLE');
  });
});

function progressOf(cardId: string) {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId: { userId, cardId } },
  });
}

describe('cards changed during a Study Session', () => {
  it('drops a deleted card from the session, which goes on and finishes without it', async () => {
    const { id, items } = await startedSession(capitals);
    const caller = createCaller();

    await caller.card.delete({ cardId: items[0].card.id });

    // The rest of the session is unaffected
    const answered = await caller.study.submitAnswer({
      itemId: items[1].id,
      userAnswer: 'Tokyo',
    });
    expect(answered.recallGrade).toBe('NAILED');
    const finished = await caller.study.finishSession({ id });
    expect(finished.items.map((item) => item.card.front)).toEqual([
      'Capital of Japan',
      'Capital of Brazil',
    ]);
    expect(finished.items.map((item) => item.status)).toEqual([
      'COMPLETED',
      'SKIPPED',
    ]);
  });

  it("can't answer a deleted card's item", async () => {
    const { items } = await startedSession(capitals);
    const caller = createCaller();

    await caller.card.delete({ cardId: items[0].card.id });

    await expect(
      caller.study.submitAnswer({ itemId: items[0].id, userAnswer: 'Paris' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('finishes a session whose only card was deleted', async () => {
    const { id, items } = await startedSession([capitals[0]]);
    const caller = createCaller();

    await caller.card.delete({ cardId: items[0].card.id });

    const finished = await caller.study.finishSession({ id });
    expect(finished).toMatchObject({ status: 'COMPLETED', items: [] });
  });

  it('grades an edited card against its new answer, starting from NEW', async () => {
    const { items } = await startedSession(capitals);
    const caller = createCaller();

    await caller.card.update({
      cardId: items[0].card.id,
      front: 'Capital of Italy',
      canonicalAnswers: [{ text: 'Rome' }],
    });

    const answered = await caller.study.submitAnswer({
      itemId: items[0].id,
      userAnswer: 'Rome',
    });
    expect(answered.recallGrade).toBe('NAILED');
    expect((await progressOf(items[0].card.id)).lifecycleState).toBe(
      'LEARNING',
    );
  });
});

describe('missed cards coming back in the same Study Session', () => {
  /** Cards "Card 1" to "Card n", answered "A1" to "An". */
  function numberedCards(n: number): NewCard[] {
    return Array.from({ length: n }, (_, i) => ({
      front: `Card ${i + 1}`,
      canonicalAnswers: [`A${i + 1}`],
    }));
  }

  /** The session's items as they end up, in queue order. */
  async function finishedQueue(id: string) {
    const finished = await createCaller().study.finishSession({ id });
    return finished.items.map(
      (item) => `${item.card.front}${item.isRetry ? ' (retry)' : ''}`,
    );
  }

  it('brings missed cards back at the end of the session, in the order missed', async () => {
    const { id, items } = await startedSession(numberedCards(8));
    const caller = createCaller();

    await caller.study.dontKnow({ itemId: items[0].id });
    await caller.study.submitAnswer({ itemId: items[1].id, userAnswer: 'A2' });
    await caller.study.submitAnswer({ itemId: items[2].id, userAnswer: 'x' });

    expect(await finishedQueue(id)).toEqual([
      'Card 1',
      'Card 2',
      'Card 3',
      'Card 4',
      'Card 5',
      'Card 6',
      'Card 7',
      'Card 8',
      'Card 1 (retry)',
      'Card 3 (retry)',
    ]);
  });

  it('brings a retry missed again back at the end again', async () => {
    const { id, items } = await startedSession(numberedCards(2));
    const caller = createCaller();
    const first = await caller.study.dontKnow({ itemId: items[0].id });
    await caller.study.dontKnow({ itemId: items[1].id });

    await caller.study.dontKnow({ itemId: first.retryItem!.id });

    expect(await finishedQueue(id)).toEqual([
      'Card 1',
      'Card 2',
      'Card 1 (retry)',
      'Card 2 (retry)',
      'Card 1 (retry)',
    ]);
  });

  it('brings a card back at most twice', async () => {
    const { id, items } = await startedSession(numberedCards(1));
    const caller = createCaller();

    const first = await caller.study.dontKnow({ itemId: items[0].id });
    const second = await caller.study.dontKnow({ itemId: first.retryItem!.id });
    const third = await caller.study.dontKnow({
      itemId: second.retryItem!.id,
    });

    expect(third.retryItem).toBeNull();
    expect(await finishedQueue(id)).toEqual([
      'Card 1',
      'Card 1 (retry)',
      'Card 1 (retry)',
    ]);
  });

  it("doesn't bring back a card answered right", async () => {
    const { items } = await startedSession(numberedCards(2));

    const answered = await createCaller().study.submitAnswer({
      itemId: items[0].id,
      userAnswer: 'A1',
    });

    expect(answered.retryItem).toBeNull();
  });

  it("saves a retry's answer as a retry attempt, leaving the card's progress as the first answer left it", async () => {
    const { items } = await startedSession(numberedCards(1));
    const caller = createCaller();
    const missed = await caller.study.dontKnow({ itemId: items[0].id });
    const afterMiss = await progressOf(items[0].cardId);

    const retried = await caller.study.submitAnswer({
      itemId: missed.retryItem!.id,
      userAnswer: 'A1',
    });

    expect(missed).toMatchObject({ isRetry: false, attemptNumber: 1 });
    expect(retried).toMatchObject({
      recallGrade: 'NAILED',
      isRetry: true,
      attemptNumber: 2,
    });
    expect(await progressOf(items[0].cardId)).toEqual(afterMiss);
  });

  it('skips the retry once "My answer was correct" accepts the missed answer', async () => {
    const { items } = await startedSession(numberedCards(3));
    const caller = createCaller();
    const missed = await caller.study.submitAnswer({
      itemId: items[0].id,
      userAnswer: 'A one',
    });

    await caller.study.acceptAnswer({ attemptId: missed.id });

    const retry = await prisma.studySessionItem.findUniqueOrThrow({
      where: { id: missed.retryItem!.id },
    });
    expect(retry.status).toBe('SKIPPED');
  });

  it("doesn't count a retry answered right toward graduating the card", async () => {
    const deck = await deckWith(numberedCards(1));
    const [card] = deck.cards;
    const caller = createCaller();
    // Session one: missed, then right when it comes back
    const one = (await caller.study.startSession({ deckId: deck.id }))!;
    const missed = await caller.study.dontKnow({ itemId: one.items[0].id });
    await caller.study.submitAnswer({
      itemId: missed.retryItem!.id,
      userAnswer: 'A1',
    });
    await caller.study.finishSession({ id: one.id });
    await prisma.cardProgress.update({
      where: { userId_cardId: { userId, cardId: card.id } },
      data: { dueAt: new Date(Date.now() - 1000) },
    });

    // Session two: right. Counting the retry would make it two successes
    // across two sessions, enough to graduate.
    const two = (await caller.study.startSession({ deckId: deck.id }))!;
    await caller.study.submitAnswer({
      itemId: two.items[0].id,
      userAnswer: 'A1',
    });

    expect((await progressOf(card.id)).lifecycleState).toBe('LEARNING');
  });
});

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
