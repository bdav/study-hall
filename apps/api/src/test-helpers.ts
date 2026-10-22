import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { gradeAnswer } from './services/answerGrader.js';
import {
  createCards,
  primaryAnswerText,
  withCanonicalAnswers,
  type NewCard,
} from './services/cards.js';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
config({ path: `${projectRoot}.env` });

/**
 * Creates an isolated test database using a unique Postgres schema.
 * Each test suite gets its own schema that is dropped on teardown.
 */
export function createTestPrisma() {
  const schemaName = `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const testUrl = `${baseUrl}?schema=${schemaName}`;

  // Create the schema and apply migrations
  execSync(`pnpm prisma migrate deploy`, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  const adapter = new PrismaPg(
    { connectionString: baseUrl },
    { schema: schemaName },
  );
  const prisma = new PrismaClient({ adapter });

  return {
    prisma,
    async cleanup() {
      await prisma.$executeRawUnsafe(
        `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
      );
      await prisma.$disconnect();
    },
  };
}

/**
 * Creates a deck with cards the way the app does: each card gets a primary
 * canonical answer and NEW card progress for the deck owner.
 */
export async function createDeckWithCards(
  prisma: PrismaClient,
  {
    userId,
    name = 'Test Deck',
    cards = [],
  }: { userId: string; name?: string; cards?: NewCard[] },
) {
  const deck = await prisma.deck.create({ data: { name, userId } });
  const created = await createCards(prisma, {
    deckId: deck.id,
    userId,
    cards,
  });
  return { ...deck, cards: created };
}

/**
 * Records a finished Study Session holding the given answers, in order, each
 * graded the way the app grades it. A card answered more than once gets
 * retry attempts. For suites that need attempt history, such as several
 * attempts at one card, without going through the study flow.
 */
export async function recordStudySession(
  prisma: PrismaClient,
  {
    userId,
    deckId,
    answers,
  }: {
    userId: string;
    deckId: string;
    answers: { cardId: string; userAnswer: string }[];
  },
) {
  const session = await prisma.studySession.create({
    data: {
      userId,
      deckId,
      sessionType: 'STANDARD',
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });

  const attemptsByCard = new Map<string, number>();
  for (const { cardId, userAnswer } of answers) {
    const card = await prisma.card.findUniqueOrThrow({
      where: { id: cardId },
      include: withCanonicalAnswers,
    });
    const attemptNumber = (attemptsByCard.get(cardId) ?? 0) + 1;
    attemptsByCard.set(cardId, attemptNumber);

    await prisma.cardAttempt.create({
      data: {
        studySessionId: session.id,
        cardId,
        userAnswer,
        recallGrade: gradeAnswer(userAnswer, primaryAnswerText(card)),
        attemptNumber,
        isRetry: attemptNumber > 1,
      },
    });
  }

  return session;
}
