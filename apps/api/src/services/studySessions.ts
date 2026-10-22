import { type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { gradeAnswer, type Grading } from './answerGrader.js';
import { deckOrder, primaryAnswerText, withCanonicalAnswers } from './cards.js';
import { applyAnswer } from './progressUpdater.js';

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
 * Starts a Standard Study Session on a deck. The queue is the deck's due
 * cards, earliest due first, then its NEW cards in deck order. Bucket shares
 * and interleaving come with the queue generator (#8). Returns null, and
 * starts nothing, when the deck has nothing to study.
 */
export async function startStudySession(
  prisma: PrismaClient,
  { userId, deckId }: { userId: string; deckId: string },
) {
  const dueCards = await prisma.cardProgress.findMany({
    where: {
      userId,
      deckId,
      lifecycleState: { in: ['LEARNING', 'STABLE'] },
      dueAt: { lte: new Date() },
    },
    orderBy: { dueAt: 'asc' },
    select: { cardId: true },
    take: STANDARD_SESSION_SIZE,
  });
  const newCards = await prisma.cardProgress.findMany({
    where: { userId, deckId, lifecycleState: 'NEW' },
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
 * attempt (§5.2). Returns the attempt and whether it was an Accent Mismatch.
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

  const { recallGrade, accentMismatch }: Grading =
    userAnswer === null
      ? { recallGrade: 'MISSED', accentMismatch: false }
      : gradeAnswer(userAnswer, primaryAnswerText(item.card));
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
        userAnswer,
        recallGrade,
        gradingMethod: 'DETERMINISTIC',
      },
    });

    const progress = await tx.cardProgress.findUniqueOrThrow({
      where: progressKey,
    });
    await tx.cardProgress.update({
      where: progressKey,
      data: applyAnswer(progress, recallGrade, attempt.createdAt),
    });

    return { ...attempt, accentMismatch };
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
