import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createTestPrisma } from './test-helpers.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(() => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
});

afterAll(async () => {
  await cleanup();
});

describe('Database connection', () => {
  it('can create and retrieve a user', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test-db@example.com',
        passwordHash: 'fakehash',
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test-db@example.com');

    const found = await prisma.user.findUnique({
      where: { email: 'test-db@example.com' },
    });
    expect(found).not.toBeNull();
    expect(found!.id).toBe(user.id);
  });

  it('can create a deck with cards for a user', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test-deck@example.com',
        passwordHash: 'fakehash',
      },
    });

    const deck = await prisma.deck.create({
      data: {
        name: 'Test Deck',
        description: 'A test deck',
        userId: user.id,
        cards: {
          create: [
            {
              front: 'Q1',
              canonicalAnswers: { create: { text: 'A1', isPrimary: true } },
            },
            {
              front: 'Q2',
              canonicalAnswers: { create: { text: 'A2', isPrimary: true } },
            },
          ],
        },
      },
      include: { cards: { include: { canonicalAnswers: true } } },
    });

    expect(deck.name).toBe('Test Deck');
    expect(deck.cards).toHaveLength(2);
    expect(deck.cards[0].front).toBe('Q1');
    expect(deck.cards[0].canonicalAnswers).toEqual([
      expect.objectContaining({ text: 'A1', isPrimary: true }),
    ]);
  });

  it('can create a study session with card attempts', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test-study@example.com',
        passwordHash: 'fakehash',
      },
    });

    const deck = await prisma.deck.create({
      data: {
        name: 'Study Deck',
        userId: user.id,
        cards: {
          create: [
            {
              front: 'Q1',
              canonicalAnswers: { create: { text: 'A1', isPrimary: true } },
            },
          ],
        },
      },
      include: { cards: true },
    });

    const session = await prisma.studySession.create({
      data: {
        userId: user.id,
        deckId: deck.id,
        sessionType: 'STANDARD',
      },
    });

    expect(session.id).toBeDefined();
    expect(session.endedAt).toBeNull();

    const attempt = await prisma.cardAttempt.create({
      data: {
        studySessionId: session.id,
        cardId: deck.cards[0].id,
        recallGrade: 'NAILED',
      },
    });

    expect(attempt.recallGrade).toBe('NAILED');

    const sessionWithAttempts = await prisma.studySession.findUnique({
      where: { id: session.id },
      include: { attempts: true },
    });

    expect(sessionWithAttempts!.attempts).toHaveLength(1);
  });

  it('cascade deletes children when a user is deleted', async () => {
    const user = await prisma.user.create({
      data: {
        email: 'test-cascade@example.com',
        passwordHash: 'fakehash',
      },
    });

    const deck = await prisma.deck.create({
      data: {
        name: 'Cascade Deck',
        userId: user.id,
        cards: {
          create: [
            {
              front: 'Q1',
              canonicalAnswers: { create: { text: 'A1', isPrimary: true } },
            },
          ],
        },
      },
      include: { cards: true },
    });

    await prisma.studySession.create({
      data: {
        userId: user.id,
        deckId: deck.id,
        sessionType: 'STANDARD',
        attempts: {
          create: [{ cardId: deck.cards[0].id, recallGrade: 'NAILED' }],
        },
      },
    });

    // Deleting the user should cascade to everything
    await prisma.user.delete({ where: { id: user.id } });

    const decks = await prisma.deck.findMany({
      where: { userId: user.id },
    });
    const cards = await prisma.card.findMany({
      where: { deckId: deck.id },
    });

    expect(decks).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });
});
