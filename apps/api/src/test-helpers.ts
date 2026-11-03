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
import { countsSinceReset } from './services/countedAttempts.js';
import {
  replayAnswers,
  type ScheduledAnswer,
} from './services/progressUpdater.js';

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
 * Records a finished Study Session, Forward unless given another Study
 * Direction, holding the given answers, in order, each graded the way the
 * app grades it. A card answered more than once gets
 * retry attempts. For suites that need attempt history, such as several
 * attempts at one card, without going through the study flow.
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

    await prisma.cardAttempt.create({
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
 * a Retry, and the progress the scheduler would have left from them: its
 * Counted Answers replayed (`replayAnswers`), since `resetAt` when the
 * card's progress last reset then, and the card marked known at
 * `markedKnownAt`, if given. Progress built this way always agrees with
 * the attempts, as studying would leave it.
 */
export async function recordCardHistory(
  prisma: PrismaClient,
  {
    userId,
    cardId,
    direction = 'FORWARD',
    answers,
    resetAt,
    markedKnownAt = null,
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

  const counted: ScheduledAnswer[] = [];
  let session: { id: string } | null = null;
  let attemptNumber = 0;
  for (const answer of answers) {
    if (!answer.retry || !session) {
      session = await prisma.studySession.create({
        data: {
          userId,
          deckId: card.deckId,
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
    await prisma.cardAttempt.create({
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
    if (!answer.retry && (!resetAt || countsSinceReset(answer.at, resetAt))) {
      counted.push({
        recallGrade: answer.grade,
        answeredAt: answer.at,
        studySessionId: session.id,
      });
    }
  }

  // Without a reset, the progress started before its first answer
  const startedAt = new Date(
    Math.min(Date.now(), ...answers.map(({ at }) => at.getTime())),
  );
  return prisma.cardProgress.update({
    where: { userId_cardId_direction: { userId, cardId, direction } },
    data: {
      ...replayAnswers(counted, markedKnownAt),
      resetAt: resetAt ?? startedAt,
    },
  });
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
