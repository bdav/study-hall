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
import { DIRECTION_LABELS_MODEL } from './ai/directionLabels.js';

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
    data: { email: 'direction-labels@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: {
      email: 'other-direction-labels@example.com',
      passwordHash: 'fakehash',
    },
  });
  otherUserId = other.id;
});

beforeEach(async () => {
  await prisma.deck.deleteMany({});
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.stubEnv(
    'AI_ALLOWED_EMAILS',
    'direction-labels@example.com, other-direction-labels@example.com',
  );
  vi.stubEnv('AI_MONTHLY_CAP_USD', '100');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

function createCaller(asUserId = userId) {
  return appRouter.createCaller({
    prisma,
    userId: asUserId,
    sessionToken: null,
    ai,
  });
}

const SUGGESTED = {
  forwardLabel: 'Capitals from states',
  reverseLabel: 'States from capitals',
};

/** A reversible deck of state capitals, with a description. */
async function capitalsDeck({
  cards = [
    { front: 'Ohio', canonicalAnswers: ['Columbus'] },
    { front: 'Texas', canonicalAnswers: ['Austin', 'Austin, TX'] },
  ],
  asUserId = userId,
}: {
  cards?: { front: string; canonicalAnswers: string[] }[];
  asUserId?: string;
} = {}) {
  const deck = await createDeckWithCards(prisma, {
    userId: asUserId,
    name: 'US capitals',
    cards,
  });
  return prisma.deck.update({
    where: { id: deck.id },
    data: { reversible: true, description: 'One per state' },
  });
}

function labelsOf(deckId: string) {
  return prisma.deck.findUniqueOrThrow({
    where: { id: deckId },
    select: {
      forwardLabel: true,
      reverseLabel: true,
      forwardLabelSuggested: true,
      reverseLabelSuggested: true,
    },
  });
}

describe('deck.suggestDirectionLabels', () => {
  it('asks a Haiku-class model from the deck and its cards, front and primary answer, saving the labels', async () => {
    const deck = await capitalsDeck();
    ai.respondWith(SUGGESTED);

    const labels = await createCaller().deck.suggestDirectionLabels({
      deckId: deck.id,
    });

    expect(ai.requests).toHaveLength(1);
    const [request] = ai.requests;
    expect(request.model).toBe(DIRECTION_LABELS_MODEL);
    expect(request.prompt).toContain('Deck: US capitals');
    expect(request.prompt).toContain('Deck description: One per state');
    expect(request.prompt).toContain('- Ohio → Columbus');
    expect(request.prompt).toContain('- Texas → Austin');
    expect(request.prompt).not.toContain('Austin, TX');
    expect(labels).toEqual({ ...SUGGESTED, suggested: true });
    expect(await labelsOf(deck.id)).toEqual({
      ...SUGGESTED,
      forwardLabelSuggested: true,
      reverseLabelSuggested: true,
    });
  });

  it('records the call as direction labels', async () => {
    const deck = await capitalsDeck();
    ai.respondWith(SUGGESTED);

    await createCaller().deck.suggestDirectionLabels({ deckId: deck.id });

    expect(await prisma.aiUsage.findMany()).toMatchObject([
      { userId, purpose: 'DIRECTION_LABELS', model: DIRECTION_LABELS_MODEL },
    ]);
  });

  it('gives the model 20 cards at most, in deck order', async () => {
    const cards = Array.from({ length: 25 }, (_, i) => ({
      front: `State ${i + 1}`,
      canonicalAnswers: [`Capital ${i + 1}`],
    }));
    const deck = await capitalsDeck({ cards });
    ai.respondWith(SUGGESTED);

    await createCaller().deck.suggestDirectionLabels({ deckId: deck.id });

    const [{ prompt }] = ai.requests;
    expect(prompt).toContain('- State 20 → Capital 20');
    expect(prompt).not.toContain('State 21');
  });

  it("asks from an empty deck's name and description alone", async () => {
    const deck = await capitalsDeck({ cards: [] });
    ai.respondWith(SUGGESTED);

    await createCaller().deck.suggestDirectionLabels({ deckId: deck.id });

    expect(ai.requests[0].prompt).toContain('No cards yet');
  });

  it('never replaces a label the learner typed, and replaces an earlier suggestion', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    ai.respondWith(SUGGESTED);
    await caller.deck.suggestDirectionLabels({ deckId: deck.id });
    await caller.deck.update({ id: deck.id, forwardLabel: 'Capitals' });

    ai.respondWith({
      forwardLabel: 'State capitals',
      reverseLabel: 'States by capital',
    });
    const labels = await caller.deck.suggestDirectionLabels({
      deckId: deck.id,
    });

    expect(labels).toEqual({
      forwardLabel: 'Capitals',
      reverseLabel: 'States by capital',
      suggested: true,
    });
    expect(await labelsOf(deck.id)).toEqual({
      forwardLabel: 'Capitals',
      reverseLabel: 'States by capital',
      forwardLabelSuggested: false,
      reverseLabelSuggested: true,
    });
  });

  it('fills a label the learner cleared', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    await caller.deck.update({ id: deck.id, forwardLabel: 'Capitals' });
    await caller.deck.update({ id: deck.id, forwardLabel: '' });
    ai.respondWith(SUGGESTED);

    const labels = await caller.deck.suggestDirectionLabels({
      deckId: deck.id,
    });

    expect(labels).toEqual({ ...SUGGESTED, suggested: true });
  });

  it('asks nothing when both labels are the learner’s, keeping them', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    await caller.deck.update({
      id: deck.id,
      forwardLabel: 'Capitals',
      reverseLabel: 'States',
    });

    const labels = await caller.deck.suggestDirectionLabels({
      deckId: deck.id,
    });

    expect(labels).toEqual({
      forwardLabel: 'Capitals',
      reverseLabel: 'States',
      suggested: false,
    });
    expect(ai.requests).toHaveLength(0);
  });

  it('refuses a label over 40 characters retryably, saving nothing', async () => {
    const deck = await capitalsDeck();
    ai.respondWith({ ...SUGGESTED, reverseLabel: 'x'.repeat(41) });

    await expect(
      createCaller().deck.suggestDirectionLabels({ deckId: deck.id }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
    expect(await labelsOf(deck.id)).toMatchObject({
      forwardLabel: null,
      reverseLabel: null,
    });
  });

  it("refuses a deck that isn't studied both ways, before any model call", async () => {
    const deck = await capitalsDeck();
    await prisma.deck.update({
      where: { id: deck.id },
      data: { reversible: false },
    });

    await expect(
      createCaller().deck.suggestDirectionLabels({ deckId: deck.id }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(ai.requests).toHaveLength(0);
  });

  it('refuses an archived deck, before any model call', async () => {
    const deck = await capitalsDeck();
    await prisma.deck.update({
      where: { id: deck.id },
      data: { archivedAt: new Date() },
    });

    await expect(
      createCaller().deck.suggestDirectionLabels({ deckId: deck.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(ai.requests).toHaveLength(0);
  });

  it("refuses another learner's deck, before any model call", async () => {
    const deck = await capitalsDeck({ asUserId: otherUserId });

    await expect(
      createCaller().deck.suggestDirectionLabels({ deckId: deck.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused to a learner without AI access, before any model call', async () => {
    const deck = await capitalsDeck();
    vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');

    await expect(
      createCaller().deck.suggestDirectionLabels({ deckId: deck.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ai.requests).toHaveLength(0);
  });

  it('is refused while AI is paused by the spending cap, before any model call', async () => {
    const deck = await capitalsDeck();
    vi.stubEnv('AI_MONTHLY_CAP_USD', '');

    await expect(
      createCaller().deck.suggestDirectionLabels({ deckId: deck.id }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(ai.requests).toHaveLength(0);
  });
});

describe('deck.update after a suggestion', () => {
  it('makes a typed label the learner’s, and leaves the other suggested', async () => {
    const deck = await capitalsDeck();
    const caller = createCaller();
    ai.respondWith(SUGGESTED);
    await caller.deck.suggestDirectionLabels({ deckId: deck.id });

    await caller.deck.update({ id: deck.id, reverseLabel: 'States' });

    expect(await labelsOf(deck.id)).toMatchObject({
      forwardLabelSuggested: true,
      reverseLabelSuggested: false,
    });
  });
});
