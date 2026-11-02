import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createDeckWithCards, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';
import {
  CARD_GENERATION_MODEL,
  CARD_GENERATION_PROMPT_VERSION,
} from './ai/cardGeneration.js';

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
    data: { email: 'card-generation@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: {
      email: 'other-card-generation@example.com',
      passwordHash: 'fakehash',
    },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.stubEnv(
    'AI_ALLOWED_EMAILS',
    'card-generation@example.com, other-card-generation@example.com',
  );
  vi.stubEnv('AI_MONTHLY_CAP_USD', '100');
});

afterAll(async () => {
  vi.unstubAllEnvs();
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

async function spanishDeck() {
  const deck = await createDeckWithCards(prisma, {
    userId,
    name: 'Spanish verbs',
    cards: [
      { front: 'Preterite of ir: yo ___', canonicalAnswers: ['fui'] },
      {
        front: 'Preterite of tener: yo ___',
        canonicalAnswers: ['tuve', 'tuve yo'],
      },
    ],
  });
  await prisma.deck.update({
    where: { id: deck.id },
    data: { description: 'Past tenses' },
  });
  return deck;
}

function typedRecall(front: string, canonicalAnswer: string) {
  return { type: 'TYPED_RECALL' as const, front, canonicalAnswer };
}

function proposedCards(count: number) {
  return Array.from({ length: count }, (_, i) =>
    typedRecall(`Question ${i + 1}`, `Answer ${i + 1}`),
  );
}

const DESCRIPTION =
  'The most common Spanish irregular preterites, first person';

describe('deck.proposeCards', () => {
  it('sends the description, the number asked for, the deck and its cards, and returns the proposed cards', async () => {
    const deck = await spanishDeck();
    ai.respondWith({
      cards: [
        typedRecall('Preterite of hacer: yo ___', 'hice'),
        typedRecall('Preterite of poder: yo ___', 'pude'),
      ],
    });

    const proposal = await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 20,
    });

    expect(ai.requests).toHaveLength(1);
    const [request] = ai.requests;
    expect(request.model).toBe(CARD_GENERATION_MODEL);
    expect(request.prompt).toContain(DESCRIPTION);
    expect(request.prompt).toContain('20 cards');
    expect(request.prompt).toContain('Deck: Spanish verbs');
    expect(request.prompt).toContain('Deck description: Past tenses');
    expect(request.prompt).toContain('- Preterite of ir: yo ___ → fui');
    // The primary answer only
    expect(request.prompt).toContain('- Preterite of tener: yo ___ → tuve');
    expect(request.prompt).not.toContain('tuve yo');
    expect(request.prompt).not.toContain('Your last proposal');

    expect(proposal).toEqual({
      model: CARD_GENERATION_MODEL,
      promptVersion: CARD_GENERATION_PROMPT_VERSION,
      cards: [
        typedRecall('Preterite of hacer: yo ___', 'hice'),
        typedRecall('Preterite of poder: yo ___', 'pude'),
      ],
      note: null,
      existingCards: [
        {
          id: deck.cards[0].id,
          front: 'Preterite of ir: yo ___',
          canonicalAnswer: 'fui',
        },
        {
          id: deck.cards[1].id,
          front: 'Preterite of tener: yo ___',
          canonicalAnswer: 'tuve',
        },
      ],
    });
  });

  it('never returns more cards than were asked for', async () => {
    const deck = await spanishDeck();
    ai.respondWith({ cards: proposedCards(12) });

    const { cards } = await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 10,
    });

    expect(cards).toEqual(proposedCards(10));
  });

  it("gives the learner the model's note on why there are fewer cards", async () => {
    const deck = await spanishDeck();
    ai.respondWith({
      cards: proposedCards(3),
      note: 'Only three verbs fit the description.',
    });

    const proposal = await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 10,
    });

    expect(proposal.note).toBe('Only three verbs fit the description.');
  });

  it('gives no note for a blank one', async () => {
    const deck = await spanishDeck();
    ai.respondWith({ cards: proposedCards(1), note: ' ' });

    const proposal = await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 10,
    });

    expect(proposal.note).toBeNull();
  });

  it('works on an empty deck', async () => {
    const deck = await createDeckWithCards(prisma, { userId, name: 'New' });
    ai.respondWith({ cards: proposedCards(1) });

    const proposal = await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 10,
    });

    expect(ai.requests[0].prompt).toContain('- None yet.');
    expect(proposal.existingCards).toEqual([]);
  });

  it('records the call as card generation', async () => {
    const deck = await spanishDeck();
    ai.respondWith({ cards: proposedCards(1) });

    await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 10,
    });

    expect(await prisma.aiUsage.findMany({})).toEqual([
      expect.objectContaining({ userId, purpose: 'CARD_GENERATION' }),
    ]);
  });

  it.each([
    ['more than 250 cards', { count: 251 }],
    ['no cards', { count: 0 }],
    ['a fraction of a card', { count: 2.5 }],
    ['a description over 1,000 characters', { description: 'a'.repeat(1001) }],
    ['a blank description', { description: '  ' }],
  ])('refuses %s, before any model call', async (_, change) => {
    const deck = await spanishDeck();

    await expect(
      createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
        ...change,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(ai.requests).toHaveLength(0);
  });

  it('takes 250 cards', async () => {
    const deck = await spanishDeck();
    ai.respondWith({ cards: proposedCards(250) });

    const { cards } = await createCaller().deck.proposeCards({
      deckId: deck.id,
      description: DESCRIPTION,
      count: 250,
    });

    expect(cards).toHaveLength(250);
  });

  describe('refining', () => {
    it('proposes again from the description, every instruction and the proposal as the learner left it', async () => {
      const deck = await spanishDeck();
      ai.respondWith({ cards: proposedCards(2) });

      await createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
        refining: {
          instructions: ['Use full sentences', 'Add the vosotros forms'],
          cards: [
            {
              front: 'Ayer yo ___ al cine (ir)',
              canonicalAnswer: 'fui',
              included: true,
            },
            {
              front: 'Preterite of ser: yo ___',
              canonicalAnswer: 'fui',
              included: false,
            },
          ],
        },
      });

      const { prompt } = ai.requests[0];
      expect(prompt.indexOf(DESCRIPTION)).toBeLessThan(
        prompt.indexOf('Use full sentences'),
      );
      expect(prompt).toContain(
        '1. Use full sentences\n2. Add the vosotros forms',
      );
      expect(prompt).toContain('1. Ayer yo ___ al cine (ir) → fui\n');
      expect(prompt).toContain(
        '2. Preterite of ser: yo ___ → fui (unticked by the learner)',
      );
    });

    it('may hold more cards than first asked for, up to 250', async () => {
      const deck = await spanishDeck();
      ai.respondWith({ cards: proposedCards(260) });

      const { cards } = await createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
        refining: {
          instructions: ['Add every other irregular verb too'],
          cards: proposedCards(10).map((card) => ({ ...card, included: true })),
        },
      });

      expect(cards).toHaveLength(250);
    });

    it('refuses a proposal of more than 250 cards, before any model call', async () => {
      const deck = await spanishDeck();

      await expect(
        createCaller().deck.proposeCards({
          deckId: deck.id,
          description: DESCRIPTION,
          count: 10,
          refining: {
            instructions: ['Fewer'],
            cards: proposedCards(251).map((card) => ({
              ...card,
              included: true,
            })),
          },
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(ai.requests).toHaveLength(0);
    });
  });

  it('refuses an archived deck, before any model call', async () => {
    const deck = await spanishDeck();
    await prisma.deck.update({
      where: { id: deck.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ai.requests).toHaveLength(0);
  });

  it("refuses another learner's deck, before any model call", async () => {
    const deck = await spanishDeck();

    await expect(
      createCaller(otherUserId).deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused to a learner without AI access, before any model call', async () => {
    const deck = await spanishDeck();
    vi.stubEnv('AI_ALLOWED_EMAILS', 'other-card-generation@example.com');

    await expect(
      createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused while AI is paused by the spending cap, before any model call', async () => {
    const deck = await spanishDeck();
    vi.stubEnv('AI_MONTHLY_CAP_USD', '');

    await expect(
      createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(ai.requests).toHaveLength(0);
  });

  it('fails retryably when the model answers with unusable output', async () => {
    const deck = await spanishDeck();
    ai.respondWith({ cards: [{ type: 'MULTIPLE_CHOICE', front: 'Hi' }] });

    await expect(
      createCaller().deck.proposeCards({
        deckId: deck.id,
        description: DESCRIPTION,
        count: 10,
      }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});

describe('deck.addGeneratedCards', () => {
  it('adds the cards at the end of the deck as NEW cards, recording the proposing model and prompt version', async () => {
    const deck = await spanishDeck();

    const result = await createCaller().deck.addGeneratedCards({
      deckId: deck.id,
      model: CARD_GENERATION_MODEL,
      promptVersion: CARD_GENERATION_PROMPT_VERSION,
      cards: [
        typedRecall('Preterite of hacer: yo ___', 'hice'),
        typedRecall('Preterite of poder: yo ___', 'pude'),
      ],
    });

    expect(result).toEqual({ createdCount: 2 });
    const { cards } = await createCaller().deck.getById({ id: deck.id });
    expect(cards.map((card) => card.front)).toEqual([
      'Preterite of ir: yo ___',
      'Preterite of tener: yo ___',
      'Preterite of hacer: yo ___',
      'Preterite of poder: yo ___',
    ]);
    expect(cards[2]).toMatchObject({
      sourceLessonId: null,
      sourceModel: CARD_GENERATION_MODEL,
      sourcePromptVersion: CARD_GENERATION_PROMPT_VERSION,
      canonicalAnswers: [expect.objectContaining({ text: 'hice' })],
    });
    const progress = await prisma.cardProgress.findUniqueOrThrow({
      where: {
        userId_cardId_direction: {
          userId,
          cardId: cards[2].id,
          direction: 'FORWARD',
        },
      },
    });
    expect(progress.lifecycleState).toBe('NEW');
  });

  it('needs no AI access', async () => {
    const deck = await spanishDeck();
    vi.stubEnv('AI_ALLOWED_EMAILS', '');
    vi.stubEnv('AI_MONTHLY_CAP_USD', '');

    await expect(
      createCaller().deck.addGeneratedCards({
        deckId: deck.id,
        model: CARD_GENERATION_MODEL,
        promptVersion: CARD_GENERATION_PROMPT_VERSION,
        cards: [typedRecall('Preterite of hacer: yo ___', 'hice')],
      }),
    ).resolves.toEqual({ createdCount: 1 });
  });

  it('refuses more than 250 cards', async () => {
    const deck = await spanishDeck();

    await expect(
      createCaller().deck.addGeneratedCards({
        deckId: deck.id,
        model: CARD_GENERATION_MODEL,
        promptVersion: CARD_GENERATION_PROMPT_VERSION,
        cards: proposedCards(251),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses an archived deck', async () => {
    const deck = await spanishDeck();
    await prisma.deck.update({
      where: { id: deck.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      createCaller().deck.addGeneratedCards({
        deckId: deck.id,
        model: CARD_GENERATION_MODEL,
        promptVersion: CARD_GENERATION_PROMPT_VERSION,
        cards: [typedRecall('Preterite of hacer: yo ___', 'hice')],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("refuses another learner's deck, adding nothing", async () => {
    const deck = await spanishDeck();

    await expect(
      createCaller(otherUserId).deck.addGeneratedCards({
        deckId: deck.id,
        model: CARD_GENERATION_MODEL,
        promptVersion: CARD_GENERATION_PROMPT_VERSION,
        cards: [typedRecall('Preterite of hacer: yo ___', 'hice')],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.card.count({ where: { deckId: deck.id } })).toBe(2);
  });
});
