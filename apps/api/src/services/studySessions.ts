import {
  type Prisma,
  type PrismaClient,
  type RecallGrade,
} from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { NO_MATCH, type Grading } from './answerGrader.js';
import {
  addAcceptedVariant,
  alreadyAccepts,
  currentVersionId,
  deckOrder,
  gradeCardAnswer,
  withCanonicalAnswers,
} from './cards.js';
import {
  applyAnswer,
  replayAnswers,
  type ScheduledAnswer,
} from './progressUpdater.js';
import { countsSinceReset } from './countedAttempts.js';

/** Include for returning a Study Session with its items in queue order. */
const withItems = {
  items: {
    orderBy: { position: 'asc' },
    include: { card: { include: withCanonicalAnswers } },
  },
} as const;

/** The most cards a Standard session holds (`updated-plan.md` §12.1). */
const STANDARD_SESSION_SIZE = 25;

/**
 * A learner's counted answers to a card, oldest first: those since its
 * progress last reset (`countsSinceReset`, as a query), as the scheduler
 * takes them, leaving out the attempt being applied.
 */
async function findCountedAnswers(
  tx: Prisma.TransactionClient,
  {
    userId,
    cardId,
    resetAt,
    exceptAttemptId,
  }: {
    userId: string;
    cardId: string;
    resetAt: Date;
    exceptAttemptId?: string;
  },
): Promise<ScheduledAnswer[]> {
  const attempts = await tx.cardAttempt.findMany({
    where: {
      cardId,
      studySession: { userId },
      createdAt: { gte: resetAt },
      ...(exceptAttemptId && { id: { not: exceptAttemptId } }),
    },
    orderBy: { createdAt: 'asc' },
    select: { recallGrade: true, createdAt: true, studySessionId: true },
  });
  return attempts.map(toScheduledAnswer);
}

function toScheduledAnswer(attempt: {
  recallGrade: RecallGrade;
  createdAt: Date;
  studySessionId: string;
}): ScheduledAnswer {
  return {
    recallGrade: attempt.recallGrade,
    answeredAt: attempt.createdAt,
    studySessionId: attempt.studySessionId,
  };
}

/** A learner's cards in one deck. */
type LearnerDeck = { userId: string; deckId: string };

/** A deck's cards in review whose due time has come. */
function dueCardsWhere({
  userId,
  deckId,
}: LearnerDeck): Prisma.CardProgressWhereInput {
  return {
    userId,
    deckId,
    lifecycleState: { in: ['LEARNING', 'STABLE'] },
    dueAt: { lte: new Date() },
  };
}

/** A deck's cards that have never been studied. */
function newCardsWhere({
  userId,
  deckId,
}: LearnerDeck): Prisma.CardProgressWhereInput {
  return { userId, deckId, lifecycleState: 'NEW' };
}

/**
 * How many of a deck's cards are due and how many are NEW, by the rules a
 * Study Session's queue uses. A Standard session takes at most
 * STANDARD_SESSION_SIZE of them.
 */
export async function countDueAndNewCards(
  prisma: PrismaClient,
  deck: LearnerDeck,
) {
  const [dueCount, newCount] = await Promise.all([
    prisma.cardProgress.count({ where: dueCardsWhere(deck) }),
    prisma.cardProgress.count({ where: newCardsWhere(deck) }),
  ]);
  return { dueCount, newCount };
}

/**
 * What a Standard Study Session started now would hold: its size, from the
 * deck's due and NEW cards, and, for when it would hold nothing, when the
 * next card in review comes due.
 */
export async function previewQueue(prisma: PrismaClient, deck: LearnerDeck) {
  const [{ dueCount, newCount }, next] = await Promise.all([
    countDueAndNewCards(prisma, deck),
    prisma.cardProgress.findFirst({
      where: {
        ...deck,
        lifecycleState: { in: ['LEARNING', 'STABLE'] },
        dueAt: { gt: new Date() },
      },
      orderBy: { dueAt: 'asc' },
      select: { dueAt: true },
    }),
  ]);
  return {
    sessionSize: Math.min(STANDARD_SESSION_SIZE, dueCount + newCount),
    dueCount,
    newCount,
    nextDueAt: next?.dueAt ?? null,
  };
}

/**
 * Starts a Standard Study Session on a deck. The queue is the deck's due
 * cards, earliest due first, then its NEW cards in deck order. Bucket shares
 * and interleaving come with the queue generator (#8). Returns null, and
 * starts nothing, when the deck has nothing to study.
 */
export async function startStudySession(
  prisma: PrismaClient,
  { userId, deckId }: LearnerDeck,
) {
  const dueCards = await prisma.cardProgress.findMany({
    where: dueCardsWhere({ userId, deckId }),
    orderBy: { dueAt: 'asc' },
    select: { cardId: true },
    take: STANDARD_SESSION_SIZE,
  });
  const newCards = await prisma.cardProgress.findMany({
    where: newCardsWhere({ userId, deckId }),
    orderBy: deckOrder.map((order) => ({ card: order })),
    select: { cardId: true },
    take: STANDARD_SESSION_SIZE - dueCards.length,
  });
  const queue = [...dueCards, ...newCards];

  if (queue.length === 0) return null;

  return prisma.studySession.create({
    data: {
      userId,
      deckId,
      sessionType: 'STANDARD',
      items: {
        create: queue.map(({ cardId }, position) => ({ cardId, position })),
      },
    },
    include: withItems,
  });
}

/**
 * Grades the answer to one Study Session item. In one transaction it
 * completes the item, saves the attempt and updates the card's progress
 * (`updated-plan.md` §11.3). A null answer is "I don't know", a MISSED
 * attempt (§5.2). Returns the attempt, whether it was an Accent Mismatch and
 * the Accepted Variant it matched, if any.
 */
export async function answerItem(
  prisma: PrismaClient,
  {
    userId,
    itemId,
    userAnswer,
  }: { userId: string; itemId: string; userAnswer: string | null },
) {
  const item = await prisma.studySessionItem.findFirst({
    where: { id: itemId, studySession: { userId } },
    include: {
      card: { include: withCanonicalAnswers },
      studySession: { select: { status: true } },
    },
  });
  if (!item) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Study session card not found',
    });
  }
  if (item.studySession.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Session already finished',
    });
  }

  const {
    recallGrade,
    accentMismatch,
    matchedAnswer,
    matchedVariant,
  }: Grading =
    userAnswer === null ? NO_MATCH : gradeCardAnswer(userAnswer, item.card);
  const progressKey = { userId_cardId: { userId, cardId: item.cardId } };

  return prisma.$transaction(async (tx) => {
    // Completing only a PENDING item keeps two concurrent answers from both
    // counting.
    const completed = await tx.studySessionItem.updateMany({
      where: { id: item.id, status: 'PENDING' },
      data: { status: 'COMPLETED' },
    });
    if (completed.count === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Card already answered in this session',
      });
    }

    const attempt = await tx.cardAttempt.create({
      data: {
        studySessionId: item.studySessionId,
        studySessionItemId: item.id,
        cardId: item.cardId,
        cardVersionId: await currentVersionId(tx, item.cardId),
        userAnswer,
        recallGrade,
        gradingMethod: 'DETERMINISTIC',
      },
    });

    const progress = await tx.cardProgress.findUniqueOrThrow({
      where: progressKey,
    });
    const earlier = await findCountedAnswers(tx, {
      userId,
      cardId: item.cardId,
      resetAt: progress.resetAt,
      exceptAttemptId: attempt.id,
    });
    await tx.cardProgress.update({
      where: progressKey,
      data: applyAnswer(progress, toScheduledAnswer(attempt), earlier),
    });

    return { ...attempt, accentMismatch, matchedAnswer, matchedVariant };
  });
}

/**
 * "My answer was correct": accepts a typed answer graded MISSED. The answer
 * becomes an Accepted Variant of the card's primary Canonical Answer, or of
 * the one given, unless grading already accepts it, and is graded again.
 * The attempt becomes the final one, recording the MISSED it first had
 * (`updated-plan.md` §11.1), and the card's progress is rebuilt from its
 * counted attempts as if it had been graded so from the start. Returns the
 * new grade and the card.
 */
export async function acceptAnswer(
  prisma: PrismaClient,
  {
    userId,
    attemptId,
    canonicalAnswerId,
  }: { userId: string; attemptId: string; canonicalAnswerId?: string },
) {
  const attempt = await prisma.cardAttempt.findFirst({
    where: {
      id: attemptId,
      studySession: { userId },
      card: { deck: { userId } },
    },
    include: { card: { include: withCanonicalAnswers } },
  });
  if (!attempt) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Attempt not found' });
  }
  const { userAnswer } = attempt;
  if (attempt.recallGrade !== 'MISSED' || userAnswer === null) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Only a missed typed answer can be accepted',
    });
  }
  const progressKey = { userId_cardId: { userId, cardId: attempt.cardId } };
  const { resetAt } = await prisma.cardProgress.findUniqueOrThrow({
    where: progressKey,
  });
  // It answered what was effectively a different card
  if (!countsSinceReset(attempt.createdAt, resetAt)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Answered before the card was edited',
    });
  }
  const answer = canonicalAnswerId
    ? attempt.card.canonicalAnswers.find((a) => a.id === canonicalAnswerId)
    : attempt.card.canonicalAnswers[0];
  if (!answer) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Canonical answer not found',
    });
  }

  return prisma.$transaction(async (tx) => {
    const card = alreadyAccepts(answer, userAnswer)
      ? attempt.card
      : await addAcceptedVariant(tx, {
          canonicalAnswerId: answer.id,
          text: userAnswer,
        });
    const grading = gradeCardAnswer(userAnswer, card);
    // An answer with no letters or digits never matches, even itself
    if (grading.recallGrade === 'MISSED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "That answer can't be accepted",
      });
    }

    // Finalizing only a MISSED attempt keeps two concurrent acceptances from
    // both applying
    const finalized = await tx.cardAttempt.updateMany({
      where: { id: attempt.id, recallGrade: 'MISSED' },
      data: {
        recallGrade: grading.recallGrade,
        initialSuggestedGrade: 'MISSED',
        refinementApplied: true,
        gradingMethod: 'REFINED_VARIANT',
      },
    });
    if (finalized.count === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Answer already accepted',
      });
    }

    await tx.cardProgress.update({
      where: progressKey,
      data: replayAnswers(
        await findCountedAnswers(tx, {
          userId,
          cardId: attempt.cardId,
          resetAt,
        }),
      ),
    });

    return { ...grading, card };
  });
}

/**
 * Finishes a Study Session, at its last card or early: unanswered items are
 * skipped, and the session is completed with an end time.
 */
export async function finishStudySession(
  prisma: PrismaClient,
  { userId, id }: { userId: string; id: string },
) {
  const studySession = await prisma.studySession.findFirst({
    where: { id, userId },
  });
  if (!studySession) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Study session not found',
    });
  }
  if (studySession.status !== 'ACTIVE') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Session already finished',
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.studySessionItem.updateMany({
      where: { studySessionId: id, status: 'PENDING' },
      data: { status: 'SKIPPED' },
    });
    return tx.studySession.update({
      where: { id },
      data: { status: 'COMPLETED', endedAt: new Date() },
      include: withItems,
    });
  });
}
