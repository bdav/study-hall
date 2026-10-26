import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
let deckId: string;

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
  const user = await prisma.user.create({
    data: { email: 'card-versions@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
  const deck = await prisma.deck.create({
    data: { name: 'Primes', userId },
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

// Card Versions have no read procedure yet, so these read them directly.
function versionsOf(cardId: string) {
  return prisma.cardVersion.findMany({
    where: { cardId },
    orderBy: { number: 'asc' },
  });
}

function contentOf(versions: { front: string; canonicalAnswers: string[] }[]) {
  return versions.map(({ front, canonicalAnswers }) => ({
    front,
    canonicalAnswers,
  }));
}

async function createPrimeCard() {
  return createCaller().card.create({
    deckId,
    front: 'A prime between 10 and 20',
    canonicalAnswers: ['11', '13'],
  });
}

describe('Card Versions', () => {
  describe('a new card', () => {
    it('gets its first version, its front and answers primary first, when created', async () => {
      const card = await createPrimeCard();

      const versions = await versionsOf(card.id);
      expect(versions).toMatchObject([
        {
          number: 1,
          front: 'A prime between 10 and 20',
          canonicalAnswers: ['11', '13'],
        },
      ]);
    });

    it('starts its first version when its progress starts', async () => {
      const card = await createPrimeCard();

      const [version] = await versionsOf(card.id);
      const progress = await prisma.cardProgress.findUniqueOrThrow({
        where: { userId_cardId: { userId, cardId: card.id } },
      });
      expect(version.startedAt).toEqual(progress.resetAt);
    });

    it('gets its first version when a CSV import creates it', async () => {
      const caller = createCaller();

      await caller.card.importCards({
        deckId,
        new: [{ front: 'An even prime', canonicalAnswers: ['2'] }],
        update: [],
      });

      const [card] = await caller.card.listByDeck({ deckId });
      expect(contentOf(await versionsOf(card.id))).toEqual([
        { front: 'An even prime', canonicalAnswers: ['2'] },
      ]);
    });
  });

  describe('an edit', () => {
    it.each([
      ['the front', { front: 'A prime between 10 and 20, please' }],
      ['an answer', { canonicalAnswers: [{ text: '11' }, { text: '17' }] }],
    ])(
      'that changes %s starts a new version with the card as edited, when its progress resets',
      async (_, edit) => {
        const card = await createPrimeCard();
        const caller = createCaller();

        const edited = await caller.card.update({ cardId: card.id, ...edit });

        const versions = await versionsOf(card.id);
        expect(versions.map((v) => v.number)).toEqual([1, 2]);
        expect(contentOf(versions)[1]).toEqual({
          front: edited.front,
          canonicalAnswers: edited.canonicalAnswers.map((a) => a.text),
        });
        const progress = await prisma.cardProgress.findUniqueOrThrow({
          where: { userId_cardId: { userId, cardId: card.id } },
        });
        expect(versions[1].startedAt).toEqual(progress.resetAt);
        // The first version is kept as it was
        expect(contentOf(versions)[0]).toEqual({
          front: 'A prime between 10 and 20',
          canonicalAnswers: ['11', '13'],
        });
      },
    );

    it('starts a new version when a new card with the same front gives it new answers', async () => {
      const card = await createPrimeCard();

      await createCaller().card.create({
        deckId,
        front: 'A prime between 10 and 20',
        canonicalAnswers: ['17'],
      });

      expect(contentOf(await versionsOf(card.id))).toEqual([
        { front: 'A prime between 10 and 20', canonicalAnswers: ['11', '13'] },
        { front: 'A prime between 10 and 20', canonicalAnswers: ['17'] },
      ]);
    });

    it('starts a new version when a CSV import gives a card new answers', async () => {
      const card = await createPrimeCard();

      await createCaller().card.importCards({
        deckId,
        new: [],
        update: [{ cardId: card.id, canonicalAnswers: ['17', '19'] }],
      });

      expect(contentOf(await versionsOf(card.id))[1]).toEqual({
        front: 'A prime between 10 and 20',
        canonicalAnswers: ['17', '19'],
      });
    });

    it.each([
      [
        'changes nothing',
        (eleven: string, thirteen: string) => ({
          front: 'A prime between 10 and 20',
          canonicalAnswers: [
            { id: eleven, text: '11' },
            { id: thirteen, text: '13' },
          ],
        }),
      ],
      [
        'only chooses another primary',
        (eleven: string, thirteen: string) => ({
          canonicalAnswers: [
            { id: thirteen, text: '13' },
            { id: eleven, text: '11' },
          ],
        }),
      ],
      [
        'only changes Accepted Variants',
        (eleven: string, thirteen: string) => ({
          canonicalAnswers: [
            { id: eleven, text: '11', acceptedVariants: ['eleven'] },
            { id: thirteen, text: '13' },
          ],
        }),
      ],
    ])('that %s starts no version', async (_, edit) => {
      const card = await createPrimeCard();
      const [eleven, thirteen] = card.canonicalAnswers.map((a) => a.id);

      await createCaller().card.update({
        cardId: card.id,
        ...edit(eleven, thirteen),
      });

      expect(await versionsOf(card.id)).toHaveLength(1);
    });
  });

  describe('an attempt', () => {
    async function startSession() {
      const card = await createPrimeCard();
      const caller = createCaller();
      const session = await caller.study.startSession({ deckId });
      return { card, caller, item: session!.items[0] };
    }

    it('records the version it answered', async () => {
      const { card, caller, item } = await startSession();

      const attempt = await caller.study.submitAnswer({
        itemId: item.id,
        userAnswer: '11',
      });

      const [version] = await versionsOf(card.id);
      expect(
        await prisma.cardAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        }),
      ).toMatchObject({ cardVersionId: version.id });
    });

    it('records the version for "I don\'t know"', async () => {
      const { card, caller, item } = await startSession();

      const attempt = await caller.study.dontKnow({ itemId: item.id });

      const [version] = await versionsOf(card.id);
      expect(
        await prisma.cardAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        }),
      ).toMatchObject({ cardVersionId: version.id });
    });

    it('starts no version when "My answer was correct" accepts it', async () => {
      const { card, caller, item } = await startSession();
      const attempt = await caller.study.submitAnswer({
        itemId: item.id,
        userAnswer: 'eleven',
      });

      await caller.study.acceptAnswer({ attemptId: attempt.id });

      expect(await versionsOf(card.id)).toHaveLength(1);
    });

    it('records the version the card had when answered, edited since or not', async () => {
      const { card, caller, item } = await startSession();
      await caller.card.update({
        cardId: card.id,
        front: 'A prime between 10 and 20, please',
      });

      const attempt = await caller.study.submitAnswer({
        itemId: item.id,
        userAnswer: '11',
      });

      const versions = await versionsOf(card.id);
      expect(
        await prisma.cardAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        }),
      ).toMatchObject({ cardVersionId: versions[1].id });
    });
  });
});
