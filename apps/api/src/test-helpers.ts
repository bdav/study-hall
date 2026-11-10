import { config } from 'dotenv';
import {
  type ExerciseType,
  PrismaClient,
  type RecallGrade,
  type StudyDirection,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { LESSON_MODEL, LESSON_PROMPT_VERSION } from './ai/lesson.js';
import {
  createCards,
  currentVersionId,
  gradeDirectedAnswer,
  withCanonicalAnswers,
  type NewCard,
} from './services/cards.js';
import {
  applyCardAnswer,
  recordMarkedKnown,
  resetCardProgress,
} from './services/cardStanding.js';

export const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
config({ path: `${projectRoot}.env` });

function uniqueTestName() {
  return `test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function applyMigrations(databaseUrl: string) {
  execSync(`pnpm prisma migrate deploy`, {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

/**
 * Creates an isolated test database using a unique Postgres schema.
 * Each test suite gets its own schema that is dropped on teardown.
 */
export function createTestPrisma() {
  const schemaName = uniqueTestName();
  const baseUrl = process.env.DATABASE_URL!;
  const testUrl = `${baseUrl}?schema=${schemaName}`;

  // Create the schema and apply migrations
  applyMigrations(testUrl);

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
 * Creates a whole throwaway database, migrated, for code that connects by
 * `DATABASE_URL` alone, like the seed: a schema in the URL wouldn't hold it,
 * as Prisma writes to `public` unless the adapter is told otherwise.
 */
export async function createTestDatabase() {
  const name = uniqueTestName();
  const baseUrl = process.env.DATABASE_URL!;
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;

  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: baseUrl }),
  });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);

  applyMigrations(url.href);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.href }),
  });

  return {
    prisma,
    url: url.href,
    async cleanup() {
      await prisma.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.$disconnect();
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
 * Records a finished Study Session, Forward unless given another Study
 * Direction, holding the given answers, in order, each graded the way the
 * app grades it and applied to its progress through Card Standing, as
 * studying would. A card answered more than once gets retry attempts,
 * which change nothing. For suites that need attempt history, such as
 * several attempts at one card, without going through the study flow.
 */
export async function recordStudySession(
  prisma: PrismaClient,
  {
    userId,
    deckId,
    answers,
    direction = 'FORWARD',
  }: {
    userId: string;
    deckId: string;
    answers: { cardId: string; userAnswer: string }[];
    direction?: StudyDirection;
  },
) {
  const session = await prisma.studySession.create({
    data: {
      userId,
      deckId,
      decks: { create: { deckId } },
      direction,
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

    const attempt = await prisma.cardAttempt.create({
      data: {
        studySessionId: session.id,
        cardId,
        cardVersionId: await currentVersionId(prisma, cardId),
        direction,
        userAnswer,
        recallGrade: gradeDirectedAnswer(userAnswer, card, direction)
          .recallGrade,
        attemptNumber,
        isRetry: attemptNumber > 1,
      },
    });
    await applyCardAnswer(prisma, { userId, attempt });
  }

  return session;
}

/** One answer in a card's history: its grade and when it was given. */
export type HistoryAnswer = {
  grade: RecallGrade;
  at: Date;
  /** A Retry, in the Study Session of the answer before it. */
  retry?: boolean;
};

/**
 * Gives a learner's card, in one Study Direction (Forward unless given),
 * a history of answers, each in a finished Study Session of its own unless
 * a Retry, its progress reset at `resetAt` and the card marked known at
 * `markedKnownAt`, when given. Each is applied through Card Standing in
 * time order, as studying would apply it, so its progress always agrees
 * with its attempts. The card's progress starts over, in every direction,
 * at its history's first event.
 */
export async function recordCardHistory(
  prisma: PrismaClient,
  {
    userId,
    cardId,
    direction = 'FORWARD',
    answers,
    resetAt,
    markedKnownAt,
  }: {
    userId: string;
    cardId: string;
    direction?: StudyDirection;
    answers: HistoryAnswer[];
    resetAt?: Date;
    markedKnownAt?: Date | null;
  },
) {
  const card = await prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });
  const cardVersionId = await currentVersionId(prisma, cardId);

  // At one moment, a reset comes first, then a mark, then an answer, as
  // replay takes them
  type Event =
    | { kind: 'reset'; at: Date }
    | { kind: 'markedKnown'; at: Date }
    | { kind: 'answer'; at: Date; answer: HistoryAnswer };
  const order = { reset: 0, markedKnown: 1, answer: 2 };
  const events: Event[] = [
    ...(resetAt ? [{ kind: 'reset' as const, at: resetAt }] : []),
    ...(markedKnownAt
      ? [{ kind: 'markedKnown' as const, at: markedKnownAt }]
      : []),
    ...answers.map((answer) => ({
      kind: 'answer' as const,
      at: answer.at,
      answer,
    })),
  ].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || order[a.kind] - order[b.kind],
  );
  // Its history in this direction starts at its first event; another
  // direction's is left as it is
  if (events.length > 0) {
    await resetCardProgress(prisma, {
      cardId,
      direction,
      resetAt: events[0].at,
    });
  }

  let session: { id: string } | null = null;
  let attemptNumber = 0;
  for (const event of events) {
    if (event.kind === 'reset') {
      await resetCardProgress(prisma, { cardId, resetAt: event.at });
      continue;
    }
    if (event.kind === 'markedKnown') {
      await recordMarkedKnown(prisma, {
        userId,
        cardIds: [cardId],
        directions: [direction],
        at: event.at,
      });
      continue;
    }
    const { answer } = event;
    if (!answer.retry || !session) {
      session = await prisma.studySession.create({
        data: {
          userId,
          deckId: card.deckId,
          decks: { create: { deckId: card.deckId } },
          direction,
          sessionType: 'STANDARD',
          status: 'COMPLETED',
          startedAt: answer.at,
          endedAt: answer.at,
        },
      });
      attemptNumber = 0;
    }
    attemptNumber++;
    const attempt = await prisma.cardAttempt.create({
      data: {
        studySessionId: session.id,
        cardId,
        cardVersionId,
        direction,
        // "I don't know" for a miss, the primary answer otherwise
        userAnswer:
          answer.grade === 'MISSED' ? null : card.canonicalAnswers[0].text,
        recallGrade: answer.grade,
        attemptNumber,
        isRetry: answer.retry ?? false,
        createdAt: answer.at,
      },
    });
    await applyCardAnswer(prisma, { userId, attempt });
  }
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
      essentialPoints?: string[];
      supplementaryPoints?: string[];
      /** Free-form explanations generated before the split (ADR-0006). */
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
      minutesPerWeek: 180,
      sessionMinutes: 30,
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
          essentialPoints: exercise.essentialPoints ?? [],
          supplementaryPoints: exercise.supplementaryPoints ?? [],
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
