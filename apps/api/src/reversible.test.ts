import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient, type StudyDirection } from '@prisma/client';
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
    data: { email: 'reversible@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: { email: 'other-reversible@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = other.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
});

afterAll(async () => {
  await cleanup();
});

// No AI provider is stubbed to allow anyone: none of this needs AI
function createCaller(asUserId = userId) {
  return appRouter.createCaller({
    prisma,
    userId: asUserId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

/** Capitals, made reversible unless told otherwise. */
async function capitalsDeck({
  reversible = true,
  asUserId = userId,
}: { reversible?: boolean; asUserId?: string } = {}) {
  const deck = await createDeckWithCards(prisma, {
    userId: asUserId,
    name: 'Capitals',
    cards: [
      { front: 'France', canonicalAnswers: ['Paris'] },
      { front: 'Japan', canonicalAnswers: ['Tokyo'] },
      { front: 'Brazil', canonicalAnswers: ['Brasília'] },
    ],
  });
  if (reversible) {
    await createCaller(asUserId).deck.update({ id: deck.id, reversible: true });
  }
  return deck;
}

function progressOf(cardId: string, direction: StudyDirection) {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId_direction: { userId, cardId, direction } },
  });
}

/** Schedules every card's Forward progress far off, so none is due. */
async function learnForward(deckId: string) {
  await prisma.cardProgress.updateMany({
    where: { deckId, direction: 'FORWARD' },
    data: {
      lifecycleState: 'REINFORCING',
      masteryScore: 8,
      dueAt: new Date(Date.now() + 30 * DAY_MS),
    },
  });
}

/** Starts a Study Session and answers its items in order. */
async function study(
  deckId: string,
  direction: StudyDirection,
  answers: string[],
) {
  const caller = createCaller();
  const session = await caller.study.startSession({ deckId, direction });
  const attempts = [];
  for (const [i, userAnswer] of answers.entries()) {
    attempts.push(
      await caller.study.submitAnswer({
        itemId: session!.items[i].id,
        userAnswer,
      }),
    );
  }
  return { session: session!, attempts };
}

describe('deck.update: Study both ways', () => {
  it('turns reversibility on with Direction Labels and a description', async () => {
    const deck = await capitalsDeck({ reversible: false });
    const caller = createCaller();

    await caller.deck.update({
      id: deck.id,
      reversible: true,
      forwardLabel: '  Capitals from countries ',
      reverseLabel: 'Countries from capitals',
      description: 'World capitals',
    });

    expect(await caller.deck.getById({ id: deck.id })).toMatchObject({
      reversible: true,
      forwardLabel: 'Capitals from countries',
      reverseLabel: 'Countries from capitals',
      description: 'World capitals',
    });
  });

  it('stores a blank label as none, for Forward or Reverse to stand in', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    await caller.deck.update({ id: deck.id, forwardLabel: 'Capitals' });

    await caller.deck.update({ id: deck.id, forwardLabel: '   ' });

    expect(await caller.deck.getById({ id: deck.id })).toMatchObject({
      forwardLabel: null,
    });
  });

  it('refuses a label over 40 characters', async () => {
    const deck = await capitalsDeck();

    await expect(
      createCaller().deck.update({ id: deck.id, reverseLabel: 'x'.repeat(41) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("refuses an archived deck's, and anyone else's", async () => {
    const deck = await capitalsDeck({ reversible: false });
    const archived = await capitalsDeck({ reversible: false });
    await prisma.deck.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      createCaller().deck.update({ id: archived.id, reversible: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      createCaller(otherUserId).deck.update({ id: deck.id, reversible: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('studying in Reverse', () => {
  it("previews the chosen direction's queue, Reverse NEW until studied", async () => {
    const deck = await capitalsDeck();
    await learnForward(deck.id);
    const caller = createCaller();

    const forward = await caller.study.queuePreview({ deckId: deck.id });
    const reverse = await caller.study.queuePreview({
      deckId: deck.id,
      direction: 'REVERSE',
    });

    expect(forward).toMatchObject({ sessionSize: 0, newCount: 0 });
    expect(reverse).toMatchObject({ sessionSize: 3, dueCount: 0, newCount: 3 });
  });

  it('records the direction on the session and its attempts', async () => {
    const deck = await capitalsDeck();

    const { session, attempts } = await study(deck.id, 'REVERSE', ['France']);

    expect(session.direction).toBe('REVERSE');
    expect(attempts[0].direction).toBe('REVERSE');
  });

  it('shows the primary answer and grades the typed front', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;

    const { attempts } = await study(deck.id, 'REVERSE', ['france']);

    expect(attempts[0]).toMatchObject({
      cardId: france.id,
      recallGrade: 'NAILED',
    });
  });

  it('grades a front wrong only in its accents GOOD, an Accent Mismatch', async () => {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: [{ front: 'Perú', canonicalAnswers: ['Lima'] }],
    });
    await createCaller().deck.update({ id: deck.id, reversible: true });

    const { attempts } = await study(deck.id, 'REVERSE', ['Peru']);

    expect(attempts[0]).toMatchObject({
      recallGrade: 'GOOD',
      accentMismatch: true,
    });
  });

  it("updates only the Reverse direction's progress", async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;

    await study(deck.id, 'REVERSE', ['France']);

    expect((await progressOf(france.id, 'REVERSE')).lifecycleState).toBe(
      'LEARNING',
    );
    expect((await progressOf(france.id, 'FORWARD')).lifecycleState).toBe('NEW');
  });

  it('resumes an unfinished session in its own direction', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    const started = await caller.study.startSession({
      deckId: deck.id,
      direction: 'REVERSE',
    });

    const resumed = await caller.study.startSession({ deckId: deck.id });

    expect(resumed).toMatchObject({ id: started!.id, direction: 'REVERSE' });
  });

  it("refuses Reverse on a deck that isn't reversible", async () => {
    const deck = await capitalsDeck({ reversible: false });
    const caller = createCaller();

    await expect(
      caller.study.startSession({ deckId: deck.id, direction: 'REVERSE' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.study.queuePreview({ deckId: deck.id, direction: 'REVERSE' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('cards that share an answer, in Reverse (#96)', () => {
  /**
   * Aruba and Sint Eustatius share their capital, as Saint Kitts and Nevis
   * and Guadeloupe do in answers that grade the same; Cuba shares none.
   */
  async function sharedCapitalsDeck() {
    const deck = await createDeckWithCards(prisma, {
      userId,
      name: 'Caribbean capitals',
      cards: [
        { front: 'Aruba', canonicalAnswers: ['Oranjestad'] },
        { front: 'Sint Eustatius', canonicalAnswers: ['Oranjestad'] },
        { front: 'Saint Kitts and Nevis', canonicalAnswers: ['Basseterre'] },
        { front: 'Guadeloupe', canonicalAnswers: ['Basse-Terre'] },
        { front: 'Cuba', canonicalAnswers: ['Havana'] },
      ],
    });
    await createCaller().deck.update({ id: deck.id, reversible: true });
    const [aruba, sintEustatius, saintKitts, guadeloupe, cuba] = deck.cards;
    return { deck, aruba, sintEustatius, saintKitts, guadeloupe, cuba };
  }

  /**
   * A Study Session in a direction, whose cards are answered by card, at
   * the item each has waiting, Retries included.
   */
  async function sessionOn(deckId: string, direction: StudyDirection) {
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId, direction });
    return {
      session: session!,
      async answer(card: { id: string }, userAnswer: string) {
        const item = await prisma.studySessionItem.findFirstOrThrow({
          where: {
            studySessionId: session!.id,
            cardId: card.id,
            status: 'PENDING',
          },
          orderBy: { position: 'asc' },
        });
        return caller.study.submitAnswer({ itemId: item.id, userAnswer });
      },
    };
  }

  it("accepts another card's front, naming it, and grades the card shown", async () => {
    const { deck, aruba } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'REVERSE');

    const attempt = await answer(aruba, 'sint eustatius');

    expect(attempt).toMatchObject({
      cardId: aruba.id,
      recallGrade: 'NAILED',
      otherFront: 'Sint Eustatius',
    });
    expect((await progressOf(aruba.id, 'REVERSE')).lifecycleState).toBe(
      'LEARNING',
    );
  });

  it('names no other front for the card’s own', async () => {
    const { deck, aruba } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'REVERSE');

    expect(await answer(aruba, 'Aruba')).toMatchObject({
      recallGrade: 'NAILED',
      otherFront: null,
    });
  });

  it('shares answers that grade the same, as Basseterre and Basse-Terre', async () => {
    const { deck, saintKitts } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'REVERSE');

    expect(await answer(saintKitts, 'Guadeloupe')).toMatchObject({
      recallGrade: 'NAILED',
      otherFront: 'Guadeloupe',
    });
  });

  it("doesn't accept the front of a card that shares no answer", async () => {
    const { deck, cuba } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'REVERSE');

    expect(await answer(cuba, 'Aruba')).toMatchObject({
      recallGrade: 'MISSED',
      otherFront: null,
    });
  });

  it('refuses, ungraded, a front already given correctly in the session, then takes another', async () => {
    const { deck, aruba, sintEustatius } = await sharedCapitalsDeck();
    const { session, answer } = await sessionOn(deck.id, 'REVERSE');
    await answer(aruba, 'Aruba');

    await expect(answer(sintEustatius, 'aruba')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'Aruba already correctly guessed. Give a different answer.',
    });
    expect(
      await prisma.cardAttempt.count({
        where: { studySessionId: session.id, cardId: sintEustatius.id },
      }),
    ).toBe(0);
    expect((await progressOf(sintEustatius.id, 'REVERSE')).lifecycleState).toBe(
      'NEW',
    );

    expect(await answer(sintEustatius, 'Sint Eustatius')).toMatchObject({
      recallGrade: 'NAILED',
    });
  });

  it("refuses a card's own front once given for the other card", async () => {
    const { deck, aruba, sintEustatius } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'REVERSE');
    await answer(aruba, 'Sint Eustatius');

    await expect(answer(sintEustatius, 'Sint Eustatius')).rejects.toMatchObject(
      {
        code: 'PRECONDITION_FAILED',
        message:
          'Sint Eustatius already correctly guessed. Give a different answer.',
      },
    );
    expect(await answer(sintEustatius, 'Aruba')).toMatchObject({
      recallGrade: 'NAILED',
      otherFront: 'Aruba',
    });
  });

  it("refuses on a Retry a front given since, and doesn't count a missed answer as given", async () => {
    const { deck, aruba, sintEustatius } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'REVERSE');
    expect(await answer(aruba, 'Cuba')).toMatchObject({
      recallGrade: 'MISSED',
    });

    expect(await answer(sintEustatius, 'Aruba')).toMatchObject({
      recallGrade: 'NAILED',
    });
    // Aruba's Retry
    await expect(answer(aruba, 'Aruba')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(await answer(aruba, 'Sint Eustatius')).toMatchObject({
      recallGrade: 'NAILED',
      isRetry: true,
    });
  });

  it("prefers another front matched exactly to the card's own matched only but for its accents", async () => {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: [
        { front: 'Perú', canonicalAnswers: ['Lima'] },
        { front: 'Peru', canonicalAnswers: ['Lima'] },
      ],
    });
    await createCaller().deck.update({ id: deck.id, reversible: true });
    const { answer } = await sessionOn(deck.id, 'REVERSE');

    expect(await answer(deck.cards[0], 'Peru')).toMatchObject({
      recallGrade: 'NAILED',
      accentMismatch: false,
      otherFront: 'Peru',
    });
  });

  it('accepts a front again in the next session', async () => {
    const { deck, aruba, sintEustatius } = await sharedCapitalsDeck();
    const first = await sessionOn(deck.id, 'REVERSE');
    await first.answer(aruba, 'Aruba');
    await createCaller().study.finishSession({ id: first.session.id });
    await prisma.cardProgress.updateMany({
      where: { deckId: deck.id },
      data: { dueAt: new Date(Date.now() - DAY_MS) },
    });

    const { answer } = await sessionOn(deck.id, 'REVERSE');

    expect(await answer(sintEustatius, 'Aruba')).toMatchObject({
      recallGrade: 'NAILED',
      otherFront: 'Aruba',
    });
  });

  it('leaves Forward as it was', async () => {
    const { deck, aruba, sintEustatius } = await sharedCapitalsDeck();
    const { answer } = await sessionOn(deck.id, 'FORWARD');

    expect(await answer(aruba, 'Oranjestad')).toMatchObject({
      recallGrade: 'NAILED',
      otherFront: null,
    });
    expect(await answer(sintEustatius, 'Oranjestad')).toMatchObject({
      recallGrade: 'NAILED',
      otherFront: null,
    });
  });
});

describe('turning Study both ways off and on', () => {
  it('hides Reverse, keeping its history, and picks up where it left off', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    const caller = createCaller();
    await study(deck.id, 'REVERSE', ['France']);
    const learned = await progressOf(france.id, 'REVERSE');

    await caller.deck.update({ id: deck.id, reversible: false });
    await caller.deck.update({ id: deck.id, reversible: true });

    expect(await progressOf(france.id, 'REVERSE')).toEqual(learned);
    const history = await caller.card.history({
      cardId: france.id,
      direction: 'REVERSE',
    });
    expect(history.versions[0].answeredCount).toBe(1);
  });

  it('abandons a Reverse session under way, so it is not resumed', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    const started = await caller.study.startSession({
      deckId: deck.id,
      direction: 'REVERSE',
    });

    await caller.deck.update({ id: deck.id, reversible: false });

    expect(await caller.study.activeSession({ deckId: deck.id })).toBeNull();
    await expect(
      caller.study.submitAnswer({
        itemId: started!.items[0].id,
        userAnswer: 'France',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('Mark known in a Study Direction', () => {
  it('marks Forward unless told which direction', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;

    await createCaller().card.markKnown({ cardIds: [france.id] });

    expect((await progressOf(france.id, 'FORWARD')).lifecycleState).toBe(
      'REINFORCING',
    );
    expect((await progressOf(france.id, 'REVERSE')).lifecycleState).toBe('NEW');
  });

  it('marks the directions asked for', async () => {
    const deck = await capitalsDeck();
    const [france, japan] = deck.cards;
    const caller = createCaller();

    await caller.card.markKnown({
      cardIds: [france.id],
      directions: ['REVERSE'],
    });
    const both = await caller.card.markKnown({
      cardIds: [japan.id],
      directions: ['FORWARD', 'REVERSE'],
    });

    expect((await progressOf(france.id, 'REVERSE')).lifecycleState).toBe(
      'REINFORCING',
    );
    expect((await progressOf(france.id, 'FORWARD')).lifecycleState).toBe('NEW');
    expect(both).toEqual({ markedCount: 2 });
  });

  it('skips the card only in a Study Session in the direction marked', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    const session = await caller.study.startSession({
      deckId: deck.id,
      direction: 'REVERSE',
    });
    const [first] = session!.items;

    await caller.card.markKnown({ cardIds: [first.cardId] });
    expect(
      (
        await prisma.studySessionItem.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe('PENDING');

    await caller.card.markKnown({
      cardIds: [first.cardId],
      directions: ['REVERSE'],
    });
    expect(
      (
        await prisma.studySessionItem.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe('SKIPPED');
  });

  it('lists the directions each card is known in', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    const caller = createCaller();
    await caller.card.markKnown({
      cardIds: [france.id],
      directions: ['REVERSE'],
    });

    const cards = await caller.card.listByDeck({ deckId: deck.id });

    expect(cards.map((card) => card.knownDirections)).toEqual([
      ['REVERSE'],
      [],
      [],
    ]);
  });

  it('lists Reverse as known only while its deck is reversible', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    const caller = createCaller();
    await caller.card.markKnown({
      cardIds: [france.id],
      directions: ['FORWARD', 'REVERSE'],
    });

    await caller.deck.update({ id: deck.id, reversible: false });
    const cards = await caller.card.listByDeck({ deckId: deck.id });

    expect(cards[0].knownDirections).toEqual(['FORWARD']);
  });

  it("refuses marking Reverse on a deck that isn't reversible", async () => {
    const deck = await capitalsDeck({ reversible: false });

    await expect(
      createCaller().card.markKnown({
        cardIds: [deck.cards[0].id],
        directions: ['REVERSE'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('Reverse Variants', () => {
  it('sets and lists a card’s Reverse Variants of its front, starting no version', async () => {
    const deck = await capitalsDeck();
    const [france] = deck.cards;
    const caller = createCaller();

    await caller.card.update({
      cardId: france.id,
      reverseVariants: ['French Republic'],
    });

    const [listed] = await caller.card.listByDeck({ deckId: deck.id });
    expect(listed.reverseVariants.map((v) => v.text)).toEqual([
      'French Republic',
    ]);
    // A variant changes nothing the card asks
    expect(
      (await caller.card.history({ cardId: france.id })).versions,
    ).toHaveLength(1);
  });

  it('grades a Reverse Variant in Reverse', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    for (const card of deck.cards) {
      await caller.card.update({
        cardId: card.id,
        reverseVariants: [`The ${card.front}`],
      });
    }

    const reverse = await study(deck.id, 'REVERSE', [
      'The France',
      'The Japan',
      'The Brazil',
    ]);

    expect(reverse.attempts.map((a) => a.recallGrade)).toEqual([
      'NAILED',
      'NAILED',
      'NAILED',
    ]);
    expect(reverse.attempts[0].matchedVariant).toMatch(/^The /);
  });

  it('refuses a Reverse Variant the front already accepts', async () => {
    const deck = await capitalsDeck();

    await expect(
      createCaller().card.update({
        cardId: deck.cards[0].id,
        reverseVariants: ['france!'],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("refuses Reverse Variants on a deck that isn't reversible", async () => {
    const deck = await capitalsDeck({ reversible: false });

    await expect(
      createCaller().card.update({
        cardId: deck.cards[0].id,
        reverseVariants: ['French Republic'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('"My answer was correct" in Reverse adds a Reverse Variant', async () => {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: [{ front: 'France', canonicalAnswers: ['Paris'] }],
    });
    const [france] = deck.cards;
    const caller = createCaller();
    await caller.deck.update({ id: deck.id, reversible: true });
    const { attempts } = await study(deck.id, 'REVERSE', ['French Republic']);

    const accepted = await caller.study.acceptAnswer({
      attemptId: attempts[0].id,
    });

    expect(accepted.recallGrade).toBe('NAILED');
    expect(accepted.card.reverseVariants.map((v) => v.text)).toEqual([
      'French Republic',
    ]);
    expect(accepted.card.canonicalAnswers[0].acceptedVariants).toEqual([]);
    expect(await progressOf(france.id, 'REVERSE')).toMatchObject({
      lifecycleState: 'LEARNING',
      masteryScore: expect.any(Number),
    });
    expect((await progressOf(france.id, 'FORWARD')).lifecycleState).toBe('NEW');
  });
});

describe('editing a reversible card', () => {
  /** A card studied both ways, with a Reverse Variant. */
  async function studiedBothWays() {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: [{ front: 'France', canonicalAnswers: ['Paris', 'Paname'] }],
    });
    const [france] = deck.cards;
    const caller = createCaller();
    await caller.deck.update({ id: deck.id, reversible: true });
    await caller.card.update({
      cardId: france.id,
      reverseVariants: ['French Republic'],
    });
    await study(deck.id, 'FORWARD', ['Paris']);
    await caller.study.finishSession({
      id: (await prisma.studySession.findFirstOrThrow()).id,
    });
    await study(deck.id, 'REVERSE', ['France']);
    return { deck, card: france, caller };
  }

  it('resets both directions on a new front, clearing its Reverse Variants into the version it ends', async () => {
    const { card, caller } = await studiedBothWays();

    const edited = await caller.card.update({
      cardId: card.id,
      front: 'The French Republic',
    });

    expect(edited.reverseVariants).toEqual([]);
    expect((await progressOf(card.id, 'FORWARD')).lifecycleState).toBe('NEW');
    expect((await progressOf(card.id, 'REVERSE')).lifecycleState).toBe('NEW');
    const history = await caller.card.history({
      cardId: card.id,
      direction: 'REVERSE',
    });
    expect(history.versions).toMatchObject([
      { number: 2, reverseVariants: [], answeredCount: 0 },
      { number: 1, reverseVariants: ['French Republic'], answeredCount: 1 },
    ]);
  });

  it("resets both directions on new answers' texts, keeping the front's Reverse Variants", async () => {
    const { card, caller } = await studiedBothWays();

    const edited = await caller.card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: 'Paris, France' }],
    });

    expect(edited.reverseVariants.map((v) => v.text)).toEqual([
      'French Republic',
    ]);
    expect((await progressOf(card.id, 'FORWARD')).lifecycleState).toBe('NEW');
    expect((await progressOf(card.id, 'REVERSE')).lifecycleState).toBe('NEW');
  });

  it('resets neither direction on choosing another primary answer', async () => {
    const { card, caller } = await studiedBothWays();
    const [paris, paname] = card.canonicalAnswers;

    await caller.card.update({
      cardId: card.id,
      canonicalAnswers: [
        { id: paname.id, text: paname.text },
        { id: paris.id, text: paris.text },
      ],
    });

    expect((await progressOf(card.id, 'FORWARD')).lifecycleState).toBe(
      'LEARNING',
    );
    expect((await progressOf(card.id, 'REVERSE')).lifecycleState).toBe(
      'LEARNING',
    );
  });

  it('brings back the Reverse Variants a restored version ended with', async () => {
    const { card, caller } = await studiedBothWays();
    await caller.card.update({ cardId: card.id, front: 'The French Republic' });
    const history = await caller.card.history({ cardId: card.id });

    const restored = await caller.card.restoreVersion({
      cardId: card.id,
      versionId: history.versions[1].id,
    });

    expect(restored.front).toBe('France');
    expect(restored.reverseVariants.map((v) => v.text)).toEqual([
      'French Republic',
    ]);
  });

  it('shows each direction its own answers in the card’s history', async () => {
    const { card, caller } = await studiedBothWays();

    const forward = await caller.card.history({ cardId: card.id });
    const reverse = await caller.card.history({
      cardId: card.id,
      direction: 'REVERSE',
    });

    expect(forward.versions[0].attempts.map((a) => a.userAnswer)).toEqual([
      'Paris',
    ]);
    expect(reverse.versions[0].attempts.map((a) => a.userAnswer)).toEqual([
      'France',
    ]);
  });
});

describe('stats by Study Direction', () => {
  /**
   * France and Japan answered Forward; France in Reverse right in two
   * sessions, so Reinforcing, then missed, so Weak there.
   */
  async function studiedDeck() {
    const deck = await capitalsDeck();
    const [france, japan] = deck.cards;
    await recordStudySession(prisma, {
      userId,
      deckId: deck.id,
      answers: [
        { cardId: france.id, userAnswer: 'Paris' },
        { cardId: japan.id, userAnswer: 'Tokyo' },
      ],
    });
    for (const userAnswer of ['France', 'France', 'Spain']) {
      await recordStudySession(prisma, {
        userId,
        deckId: deck.id,
        direction: 'REVERSE',
        answers: [{ cardId: france.id, userAnswer }],
      });
    }
    return deck;
  }

  it("counts each direction on its own on the deck's stats", async () => {
    const deck = await studiedDeck();
    const caller = createCaller();

    const forward = await caller.stats.deckStats({ deckId: deck.id });
    const reverse = await caller.stats.deckStats({
      deckId: deck.id,
      direction: 'REVERSE',
    });

    expect(forward).toMatchObject({
      answerCount: 2,
      accuracy: 1,
      weakCards: [],
    });
    expect(forward.sessions).toHaveLength(1);
    expect(reverse).toMatchObject({
      answerCount: 3,
      answers: { MISSED: 1, NAILED: 2 },
      weakCards: [{ question: 'Paris', direction: 'REVERSE' }],
    });
    expect(reverse.sessions).toHaveLength(3);
  });

  it('counts every direction in overall stats, each card direction its own', async () => {
    await studiedDeck();

    const stats = await createCaller().stats.overallStats();

    expect(stats).toMatchObject({
      answerCount: 5,
      answers: { MISSED: 1, NAILED: 4 },
    });
    expect(stats.weakCards).toMatchObject([
      { question: 'Paris', direction: 'REVERSE' },
    ]);
  });

  it('leaves Reverse out once the deck is studied one way', async () => {
    const deck = await studiedDeck();
    const caller = createCaller();

    await caller.deck.update({ id: deck.id, reversible: false });

    const overall = await caller.stats.overallStats();
    expect(overall).toMatchObject({ answerCount: 2, weakCards: [] });
    expect(overall.sessions.map((session) => session.direction)).toEqual([
      'FORWARD',
    ]);
    expect((await caller.deck.list())[0].totalAttempts).toBe(2);
    await expect(
      caller.stats.deckStats({ deckId: deck.id, direction: 'REVERSE' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("refuses anyone else's deck", async () => {
    const deck = await capitalsDeck({ asUserId: otherUserId });

    await expect(
      createCaller().stats.deckStats({ deckId: deck.id, direction: 'REVERSE' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe("another learner's deck", () => {
  it('can’t be studied, previewed or read in Reverse', async () => {
    const deck = await capitalsDeck({ asUserId: otherUserId });
    const caller = createCaller();

    for (const call of [
      // Each made in turn, so none is left unawaited
      () =>
        caller.study.startSession({ deckId: deck.id, direction: 'REVERSE' }),
      () =>
        caller.study.queuePreview({ deckId: deck.id, direction: 'REVERSE' }),
      () =>
        caller.card.history({ cardId: deck.cards[0].id, direction: 'REVERSE' }),
      () =>
        caller.card.markKnown({
          cardIds: [deck.cards[0].id],
          directions: ['REVERSE'],
        }),
      () =>
        caller.card.update({
          cardId: deck.cards[0].id,
          reverseVariants: ['French Republic'],
        }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
