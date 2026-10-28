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
    data: { email: 'card-restore@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: { email: 'other-restore@example.com', passwordHash: 'fakehash' },
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

/** The card's versions, newest first, as its history lists them. */
async function versionsOf(cardId: string) {
  const history = await createCaller().card.history({ cardId });
  return history.versions;
}

/** The card's front and its answers, primary first, with their variants. */
async function cardAsItIs(cardId: string) {
  const card = await prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    select: {
      front: true,
      canonicalAnswers: {
        orderBy: { position: 'asc' },
        select: {
          text: true,
          isPrimary: true,
          acceptedVariants: {
            orderBy: { createdAt: 'asc' },
            select: { text: true },
          },
        },
      },
    },
  });
  return {
    front: card.front,
    answers: card.canonicalAnswers.map((answer) => ({
      text: answer.text,
      isPrimary: answer.isPrimary,
      acceptedVariants: answer.acceptedVariants.map((v) => v.text),
    })),
  };
}

describe('card.restoreVersion', () => {
  it('puts the card back to asking what the version asked, in a new version that names it', async () => {
    const { card } = await primeCard();
    await createCaller().card.update({
      cardId: card.id,
      front: 'A prime in the teens',
      canonicalAnswers: [{ text: '17' }],
    });
    const [, first] = await versionsOf(card.id);

    await createCaller().card.restoreVersion({
      cardId: card.id,
      versionId: first.id,
    });

    expect(await cardAsItIs(card.id)).toMatchObject({
      front: 'A prime between 10 and 20',
      answers: [
        { text: '11', isPrimary: true },
        { text: '13', isPrimary: false },
      ],
    });
    expect(await versionsOf(card.id)).toMatchObject([
      {
        number: 3,
        isCurrent: true,
        front: 'A prime between 10 and 20',
        canonicalAnswers: ['11', '13'],
        restoredFromNumber: 1,
      },
      { number: 2, front: 'A prime in the teens', restoredFromNumber: null },
      { number: 1, restoredFromNumber: null },
    ]);
  });

  it("resets the card's progress and keeps its attempts", async () => {
    const { deckId, card } = await primeCard();
    await recordStudySession(prisma, {
      userId,
      deckId,
      answers: [{ cardId: card.id, userAnswer: '11' }],
    });
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });
    await recordStudySession(prisma, {
      userId,
      deckId,
      answers: [{ cardId: card.id, userAnswer: '17' }],
    });
    const [, first] = await versionsOf(card.id);

    await createCaller().card.restoreVersion({
      cardId: card.id,
      versionId: first.id,
    });

    const progress = await prisma.cardProgress.findFirstOrThrow({
      where: { cardId: card.id },
    });
    expect(progress.lifecycleState).toBe('NEW');
    expect(await versionsOf(card.id)).toMatchObject([
      { number: 3, answeredCount: 0 },
      { number: 2, answeredCount: 1 },
      { number: 1, answeredCount: 1 },
    ]);
  });

  it('works for a learner without AI access', async () => {
    vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');
    const { card } = await primeCard();
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });
    const [, first] = await versionsOf(card.id);

    await createCaller().card.restoreVersion({
      cardId: card.id,
      versionId: first.id,
    });

    expect(await versionsOf(card.id)).toHaveLength(3);
  });

  describe('refuses', () => {
    it('the current version', async () => {
      const { card } = await primeCard();
      const [current] = await versionsOf(card.id);

      await expect(
        createCaller().card.restoreVersion({
          cardId: card.id,
          versionId: current.id,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('a version that asks what the current one asks', async () => {
      const { card } = await primeCard();
      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [{ text: '17' }],
      });
      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [{ text: '11' }, { text: '13' }],
      });
      const [, , first] = await versionsOf(card.id);

      await expect(
        createCaller().card.restoreVersion({
          cardId: card.id,
          versionId: first.id,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(await versionsOf(card.id)).toHaveLength(3);
    });

    it('a version of another card', async () => {
      const deck = await createDeckWithCards(prisma, {
        userId,
        cards: [
          { front: 'Two plus two', canonicalAnswers: ['4'] },
          { front: 'Three plus three', canonicalAnswers: ['6'] },
        ],
      });
      const [four, six] = deck.cards;
      await createCaller().card.update({
        cardId: six.id,
        canonicalAnswers: [{ text: 'six' }],
      });
      const [, sixFirst] = await versionsOf(six.id);

      await expect(
        createCaller().card.restoreVersion({
          cardId: four.id,
          versionId: sixFirst.id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await cardAsItIs(four.id)).toMatchObject({
        front: 'Two plus two',
      });
    });

    it("another learner's card", async () => {
      const { card } = await primeCard();
      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [{ text: '17' }],
      });
      const [, first] = await versionsOf(card.id);

      await expect(
        createCaller(otherUserId).card.restoreVersion({
          cardId: card.id,
          versionId: first.id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await versionsOf(card.id)).toHaveLength(2);
    });
  });

  it('restores the primary the version ended with', async () => {
    const { card } = await primeCard();
    const [eleven, thirteen] = card.canonicalAnswers;
    // 13 made primary, which starts no version
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [
        { id: thirteen.id, text: '13' },
        { id: eleven.id, text: '11' },
      ],
    });
    await createCaller().card.update({
      cardId: card.id,
      canonicalAnswers: [{ text: '17' }],
    });
    const [, first] = await versionsOf(card.id);

    await createCaller().card.restoreVersion({
      cardId: card.id,
      versionId: first.id,
    });

    expect((await cardAsItIs(card.id)).answers).toMatchObject([
      { text: '13', isPrimary: true },
      { text: '11', isPrimary: false },
    ]);
  });

  describe('Accepted Variants', () => {
    /** Gives the prime card's answers these variants, which starts no version. */
    async function setVariants(
      cardId: string,
      eleven: string[],
      thirteen: string[],
    ) {
      const { canonicalAnswers } = await prisma.card.findUniqueOrThrow({
        where: { id: cardId },
        select: { canonicalAnswers: { orderBy: { position: 'asc' } } },
      });
      const [a, b] = canonicalAnswers;
      await createCaller().card.update({
        cardId,
        canonicalAnswers: [
          { id: a.id, text: '11', acceptedVariants: eleven },
          { id: b.id, text: '13', acceptedVariants: thirteen },
        ],
      });
    }

    it('restores the variants the version ended with', async () => {
      const { card } = await primeCard();
      await setVariants(card.id, ['eleven'], ['thirteen']);
      // Keeps 11, with none of its variants, and drops 13
      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [{ text: '11', acceptedVariants: [] }],
      });
      const [, first] = await versionsOf(card.id);

      await createCaller().card.restoreVersion({
        cardId: card.id,
        versionId: first.id,
      });

      expect((await cardAsItIs(card.id)).answers).toEqual([
        { text: '11', isPrimary: true, acceptedVariants: ['eleven'] },
        { text: '13', isPrimary: false, acceptedVariants: ['thirteen'] },
      ]);
    });

    it("keeps an unchanged answer's variants when the version's weren't recorded, and gives the others none", async () => {
      const { card } = await primeCard();
      await createCaller().card.update({
        cardId: card.id,
        canonicalAnswers: [
          { text: '11', acceptedVariants: ['eleven'] },
          { text: '17', acceptedVariants: ['seventeen'] },
        ],
      });
      // As versions that ended before #51 are
      await prisma.cardVersion.updateMany({
        where: { cardId: card.id, number: 1 },
        data: { acceptedVariants: Prisma.DbNull },
      });
      const [, first] = await versionsOf(card.id);

      await createCaller().card.restoreVersion({
        cardId: card.id,
        versionId: first.id,
      });

      expect((await cardAsItIs(card.id)).answers).toEqual([
        { text: '11', isPrimary: true, acceptedVariants: ['eleven'] },
        { text: '13', isPrimary: false, acceptedVariants: [] },
      ]);
    });
  });
});
