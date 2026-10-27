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
  CARD_REVISION_MODEL,
  CARD_REVISION_PROMPT_VERSION,
} from './ai/cardRevision.js';

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
    data: { email: 'card-revision@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: {
      email: 'other-card-revision@example.com',
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
    'card-revision@example.com, other-card-revision@example.com',
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

function italianDeck() {
  return createDeckWithCards(prisma, {
    userId,
    name: 'Italian',
    cards: [
      { front: "Italian for 'seven' (double t)", canonicalAnswers: ['sette'] },
      { front: 'Hello (informal)', canonicalAnswers: ['Ciao', 'Salve'] },
      { front: 'Good morning', canonicalAnswers: ['Buon giorno'] },
    ],
  });
}

describe('deck.proposeRevision', () => {
  it("sends the instruction and the deck's numbered cards, and returns the changes by card", async () => {
    const deck = await italianDeck();
    ai.respondWith({
      changes: [
        { action: 'EDIT', card: 1, front: "Italian for 'seven'" },
        { action: 'EDIT', card: 3, canonicalAnswer: 'Buongiorno' },
        { action: 'DELETE', card: 2 },
      ],
    });

    const proposal = await createCaller().deck.proposeRevision({
      deckId: deck.id,
      instruction: 'Remove the hints from the fronts',
    });

    expect(ai.requests).toHaveLength(1);
    expect(ai.requests[0].model).toBe(CARD_REVISION_MODEL);
    expect(ai.requests[0].prompt).toContain('Remove the hints from the fronts');
    expect(ai.requests[0].prompt).toContain(
      "1. Italian for 'seven' (double t) → sette",
    );
    expect(ai.requests[0].prompt).toContain('3. Good morning → Buon giorno');

    expect(proposal).toEqual({
      model: CARD_REVISION_MODEL,
      promptVersion: CARD_REVISION_PROMPT_VERSION,
      changes: [
        {
          action: 'EDIT',
          cardId: deck.cards[0].id,
          before: {
            front: "Italian for 'seven' (double t)",
            canonicalAnswer: 'sette',
            acceptedVariants: [],
          },
          after: { front: "Italian for 'seven'", canonicalAnswer: 'sette' },
        },
        {
          action: 'EDIT',
          cardId: deck.cards[2].id,
          before: {
            front: 'Good morning',
            canonicalAnswer: 'Buon giorno',
            acceptedVariants: [],
          },
          after: { front: 'Good morning', canonicalAnswer: 'Buongiorno' },
        },
        {
          action: 'DELETE',
          cardId: deck.cards[1].id,
          before: {
            front: 'Hello (informal)',
            canonicalAnswer: 'Ciao',
            acceptedVariants: [],
          },
        },
      ],
    });
  });

  it('records the call as a card revision', async () => {
    const deck = await italianDeck();
    ai.respondWith({ changes: [] });

    await createCaller().deck.proposeRevision({
      deckId: deck.id,
      instruction: 'Remove the hints',
    });

    const usage = await prisma.aiUsage.findMany({});
    expect(usage).toEqual([
      expect.objectContaining({ userId, purpose: 'CARD_REVISION' }),
    ]);
  });

  it("shows an edited answer's Accepted Variants, which retyping it would clear", async () => {
    const deck = await italianDeck();
    await prisma.acceptedVariant.create({
      data: {
        canonicalAnswerId: deck.cards[2].canonicalAnswers[0].id,
        text: 'Bongiorno',
      },
    });
    ai.respondWith({
      changes: [{ action: 'EDIT', card: 3, canonicalAnswer: 'Buongiorno' }],
    });

    const { changes } = await createCaller().deck.proposeRevision({
      deckId: deck.id,
      instruction: 'Fix the spelling',
    });

    expect(changes[0].before.acceptedVariants).toEqual(['Bongiorno']);
  });

  it('lists the other answers a card accepts', async () => {
    const deck = await italianDeck();
    ai.respondWith({ changes: [] });

    await createCaller().deck.proposeRevision({
      deckId: deck.id,
      instruction: 'Remove the hints',
    });

    expect(ai.requests[0].prompt).toContain(
      '2. Hello (informal) → Ciao (also accepts: Salve)',
    );
  });

  it("leaves out changes to cards the deck doesn't have, repeated changes to a card, and edits that change nothing", async () => {
    const deck = await italianDeck();
    ai.respondWith({
      changes: [
        { action: 'DELETE', card: 4 },
        { action: 'EDIT', card: 1, front: "Italian for 'seven'" },
        { action: 'DELETE', card: 1 },
        { action: 'EDIT', card: 2, front: 'Hello (informal)' },
      ],
    });

    const { changes } = await createCaller().deck.proposeRevision({
      deckId: deck.id,
      instruction: 'Remove the hints from the fronts',
    });

    expect(changes).toEqual([
      expect.objectContaining({ action: 'EDIT', cardId: deck.cards[0].id }),
    ]);
  });

  it('refuses a deck too large for one call, before any model call', async () => {
    const deck = await createDeckWithCards(prisma, {
      userId,
      cards: Array.from({ length: 201 }, (_, i) => ({
        front: `Question ${i}`,
        canonicalAnswers: [`Answer ${i}`],
      })),
    });

    await expect(
      createCaller().deck.proposeRevision({
        deckId: deck.id,
        instruction: 'Remove the hints',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringMatching(/200 cards/),
    });
    expect(ai.requests).toHaveLength(0);
  });

  it('refuses a deck with no cards, before any model call', async () => {
    const deck = await createDeckWithCards(prisma, { userId });

    await expect(
      createCaller().deck.proposeRevision({
        deckId: deck.id,
        instruction: 'Remove the hints',
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(ai.requests).toHaveLength(0);
  });

  it.each([
    ['a blank instruction', '  '],
    ['an instruction over 1,000 characters', 'x'.repeat(1001)],
  ])('refuses %s', async (_, instruction) => {
    const deck = await italianDeck();

    await expect(
      createCaller().deck.proposeRevision({ deckId: deck.id, instruction }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(ai.requests).toHaveLength(0);
  });

  it("refuses another learner's deck, before any model call", async () => {
    const deck = await italianDeck();

    await expect(
      createCaller(otherUserId).deck.proposeRevision({
        deckId: deck.id,
        instruction: 'Remove the hints',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused to a learner without AI access, before any model call', async () => {
    const deck = await italianDeck();
    vi.stubEnv('AI_ALLOWED_EMAILS', 'other-card-revision@example.com');

    await expect(
      createCaller().deck.proposeRevision({
        deckId: deck.id,
        instruction: 'Remove the hints',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused while AI is paused by the spending cap, before any model call', async () => {
    const deck = await italianDeck();
    vi.stubEnv('AI_MONTHLY_CAP_USD', '');

    await expect(
      createCaller().deck.proposeRevision({
        deckId: deck.id,
        instruction: 'Remove the hints',
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(ai.requests).toHaveLength(0);
  });

  it('fails retryably when the model answers with unusable output', async () => {
    const deck = await italianDeck();
    ai.respondWith({ changes: [{ action: 'EDIT', card: 1 }] });

    await expect(
      createCaller().deck.proposeRevision({
        deckId: deck.id,
        instruction: 'Remove the hints',
      }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});

function progressOf(cardId: string) {
  return prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId: { userId, cardId } },
  });
}

function makeProgressAdvanced(cardId: string) {
  return prisma.cardProgress.update({
    where: { userId_cardId: { userId, cardId } },
    data: { lifecycleState: 'LEARNING', masteryScore: 5, lapseCount: 2 },
  });
}

const revision = {
  model: CARD_REVISION_MODEL,
  promptVersion: CARD_REVISION_PROMPT_VERSION,
};

describe('deck.applyRevision', () => {
  it("edits fronts and primary answers, resetting those cards' progress and keeping their attempts", async () => {
    const deck = await italianDeck();
    const [seven, hello, morning] = deck.cards;
    const caller = createCaller();
    const session = await caller.study.startSession({ deckId: deck.id });
    await caller.study.submitAnswer({
      itemId: session!.items[0].id,
      userAnswer: 'sette',
    });
    for (const card of deck.cards) await makeProgressAdvanced(card.id);

    await caller.deck.applyRevision({
      deckId: deck.id,
      ...revision,
      edits: [
        { cardId: seven.id, front: "Italian for 'seven'" },
        { cardId: hello.id, front: 'Hello', canonicalAnswer: 'Ehi' },
      ],
      deletions: [],
    });

    const cards = await caller.card.listByDeck({ deckId: deck.id });
    expect(
      cards.map((card) => [
        card.front,
        card.canonicalAnswers.map((answer) => answer.text),
      ]),
    ).toEqual([
      ["Italian for 'seven'", ['sette']],
      ['Hello', ['Ehi', 'Salve']],
      ['Good morning', ['Buon giorno']],
    ]);
    expect(await progressOf(seven.id)).toMatchObject({ lifecycleState: 'NEW' });
    expect(await progressOf(hello.id)).toMatchObject({ lifecycleState: 'NEW' });
    expect(await progressOf(morning.id)).toMatchObject({
      lifecycleState: 'LEARNING',
    });
    expect(
      await prisma.cardAttempt.count({ where: { cardId: seven.id } }),
    ).toBe(1);
  });

  it('records the model and prompt version on the Card Version each edit starts', async () => {
    const deck = await italianDeck();
    const [seven] = deck.cards;

    await createCaller().deck.applyRevision({
      deckId: deck.id,
      ...revision,
      edits: [{ cardId: seven.id, front: "Italian for 'seven'" }],
      deletions: [],
    });

    const versions = await prisma.cardVersion.findMany({
      where: { cardId: seven.id },
      orderBy: { number: 'asc' },
    });
    expect(versions).toEqual([
      expect.objectContaining({
        number: 1,
        sourceModel: null,
        sourcePromptVersion: null,
      }),
      expect.objectContaining({
        number: 2,
        front: "Italian for 'seven'",
        sourceModel: CARD_REVISION_MODEL,
        sourcePromptVersion: CARD_REVISION_PROMPT_VERSION,
      }),
    ]);
  });

  it("clears a retyped primary answer's Accepted Variants and keeps the other answers'", async () => {
    const deck = await italianDeck();
    const [, hello] = deck.cards;
    const [ciao, salve] = hello.canonicalAnswers;
    for (const [answer, text] of [
      [ciao, 'Ciaoo'],
      [salve, 'Salvee'],
    ] as const) {
      await prisma.acceptedVariant.create({
        data: { canonicalAnswerId: answer.id, text },
      });
    }

    await createCaller().deck.applyRevision({
      deckId: deck.id,
      ...revision,
      edits: [{ cardId: hello.id, canonicalAnswer: 'Ehi' }],
      deletions: [],
    });

    const [card] = await prisma.card.findMany({
      where: { id: hello.id },
      include: { canonicalAnswers: { include: { acceptedVariants: true } } },
    });
    const variants = Object.fromEntries(
      card.canonicalAnswers.map((answer) => [
        answer.text,
        answer.acceptedVariants.map((variant) => variant.text),
      ]),
    );
    expect(variants).toEqual({ Ehi: [], Salve: ['Salvee'] });
  });

  it('deletes cards', async () => {
    const deck = await italianDeck();
    const [seven, hello, morning] = deck.cards;
    const caller = createCaller();

    await caller.deck.applyRevision({
      deckId: deck.id,
      ...revision,
      edits: [],
      deletions: [seven.id, morning.id],
    });

    const cards = await caller.card.listByDeck({ deckId: deck.id });
    expect(cards.map((card) => card.id)).toEqual([hello.id]);
  });

  it('applies edits and deletions together and says what it did', async () => {
    const deck = await italianDeck();
    const [seven, hello, morning] = deck.cards;

    const result = await createCaller().deck.applyRevision({
      deckId: deck.id,
      ...revision,
      edits: [
        { cardId: seven.id, front: "Italian for 'seven'" },
        { cardId: morning.id, canonicalAnswer: 'Buongiorno' },
      ],
      deletions: [hello.id],
    });

    expect(result).toEqual({ editedCount: 2, deletedCount: 1 });
  });

  it('applies nothing when one change fails', async () => {
    const deck = await italianDeck();
    const [seven, hello] = deck.cards;

    // Salve is already one of the card's answers
    await expect(
      createCaller().deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: [
          { cardId: seven.id, front: "Italian for 'seven'" },
          { cardId: hello.id, canonicalAnswer: 'Salve' },
        ],
        deletions: [],
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '“Hello (informal)” already has the answer “Salve”',
    });

    const cards = await createCaller().card.listByDeck({ deckId: deck.id });
    expect(cards[0].front).toBe("Italian for 'seven' (double t)");
  });

  it("refuses another learner's deck", async () => {
    const deck = await italianDeck();

    await expect(
      createCaller(otherUserId).deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: [],
        deletions: [deck.cards[0].id],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.card.count({ where: { deckId: deck.id } })).toBe(3);
  });

  it("refuses, applying nothing, a change to a card that isn't in the deck", async () => {
    const deck = await italianDeck();
    const otherDeck = await createDeckWithCards(prisma, {
      userId: otherUserId,
      cards: [{ front: 'Q', canonicalAnswers: ['A'] }],
    });

    await expect(
      createCaller().deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: [{ cardId: deck.cards[0].id, front: "Italian for 'seven'" }],
        deletions: [otherDeck.cards[0].id],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.card.count({ where: { deckId: otherDeck.id } })).toBe(
      1,
    );
    const cards = await createCaller().card.listByDeck({ deckId: deck.id });
    expect(cards[0].front).toBe("Italian for 'seven' (double t)");
  });

  it.each([
    ['edited and deleted', { edits: ['seven'], deletions: ['seven'] }],
    ['edited twice', { edits: ['seven', 'seven'], deletions: [] }],
  ])('refuses a card %s', async (_, { edits, deletions }) => {
    const deck = await italianDeck();
    const cardId = deck.cards[0].id;

    await expect(
      createCaller().deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: edits.map(() => ({ cardId, front: 'Seven' })),
        deletions: deletions.map(() => cardId),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a revision with no changes, or an edit that changes nothing', async () => {
    const deck = await italianDeck();
    const caller = createCaller();

    await expect(
      caller.deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: [],
        deletions: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: [{ cardId: deck.cards[0].id }],
        deletions: [],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('needs no AI access, as the proposal already exists', async () => {
    const deck = await italianDeck();
    vi.stubEnv('AI_ALLOWED_EMAILS', '');

    await expect(
      createCaller().deck.applyRevision({
        deckId: deck.id,
        ...revision,
        edits: [],
        deletions: [deck.cards[0].id],
      }),
    ).resolves.toEqual({ editedCount: 0, deletedCount: 1 });
  });
});
