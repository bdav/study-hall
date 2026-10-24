import { config } from 'dotenv';
import { type ExerciseType, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { LESSON_MODEL, LESSON_PROMPT_VERSION } from './ai/lesson.js';
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
        recallGrade: gradeAnswer(userAnswer, primaryAnswerText(card))
          .recallGrade,
        attemptNumber,
        isRetry: attemptNumber > 1,
      },
    });
  }

  return session;
}

/**
 * Creates a course with one lesson and a generated Lesson Version holding
 * the given exercises, as lesson generation stores them. For suites that
 * work with a generated lesson without going through AI generation.
 */
export async function createLessonVersion(
  prisma: PrismaClient,
  {
    userId,
    exercises,
  }: {
    userId: string;
    exercises: {
      type: ExerciseType;
      prompt: string;
      expectedAnswers?: string[];
      expectedPoints?: string[];
      /** Short answers only; the other types' marking is fixed (ADR-0005). */
      open?: boolean;
    }[];
  },
) {
  const course = await prisma.course.create({
    data: {
      userId,
      title: 'Italian',
      topic: 'Italian',
      goal: 'A2 by summer',
      priorKnowledge: '',
      timePerWeek: '3 hours',
      depth: 'Balanced',
      notes: '',
      lessons: {
        create: {
          title: 'Greetings',
          position: 0,
          objectives: ['Greet someone'],
        },
      },
    },
    include: { lessons: true },
  });

  return prisma.lessonVersion.create({
    data: {
      lessonId: course.lessons[0].id,
      content: [{ heading: 'Saying hello', paragraphs: ['Ciao means hi.'] }],
      examples: [{ example: 'Ciao!', explanation: 'Hi.' }],
      summary: 'Taught ciao.',
      model: LESSON_MODEL,
      promptVersion: LESSON_PROMPT_VERSION,
      exercises: {
        create: exercises.map((exercise, position) => ({
          position,
          type: exercise.type,
          prompt: exercise.prompt,
          expectedAnswers: exercise.expectedAnswers ?? [],
          expectedPoints: exercise.expectedPoints ?? [],
          open:
            exercise.type === 'FREE_FORM_EXPLANATION' ||
            (exercise.type === 'SHORT_ANSWER' && (exercise.open ?? false)),
        })),
      },
    },
    include: { exercises: { orderBy: { position: 'asc' } } },
  });
}
