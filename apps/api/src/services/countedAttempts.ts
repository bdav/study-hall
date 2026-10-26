import { type PrismaClient, type RecallGrade } from '@prisma/client';

export interface CountedAttempt {
  studySessionId: string;
  cardId: string;
  deckId: string;
  attemptNumber: number;
  recallGrade: RecallGrade;
}

/**
 * Whether an answer was right: NAILED, or GOOD for an answer wrong only in
 * its accents, which is accepted though never perfect (ADR-0002).
 */
export function isCorrect(grade: RecallGrade) {
  return grade === 'NAILED' || grade === 'GOOD';
}

/**
 * Whether an attempt counts toward stats and scheduling: it was made since
 * its card's latest progress reset (ADR-0004).
 */
export function countsSinceReset(createdAt: Date, resetAt: Date) {
  return createdAt >= resetAt;
}

/**
 * Finds a user's attempts that count toward stats: those made since each
 * card's latest progress reset (ADR-0004). Earlier attempts are kept as
 * history but answered what was effectively a different card.
 */
export async function findCountedAttempts(
  prisma: PrismaClient,
  { userId, deckIds }: { userId: string; deckIds?: string[] },
): Promise<CountedAttempt[]> {
  const attempts = await prisma.cardAttempt.findMany({
    where: {
      studySession: {
        userId,
        ...(deckIds && { deckId: { in: deckIds } }),
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      studySessionId: true,
      cardId: true,
      attemptNumber: true,
      recallGrade: true,
      createdAt: true,
      studySession: { select: { deckId: true } },
      card: {
        select: {
          progress: { where: { userId }, select: { resetAt: true } },
        },
      },
    },
  });

  return attempts
    .filter((a) => {
      const resetAt = a.card.progress[0]?.resetAt;
      return !resetAt || countsSinceReset(a.createdAt, resetAt);
    })
    .map((a) => ({
      studySessionId: a.studySessionId,
      cardId: a.cardId,
      deckId: a.studySession.deckId,
      attemptNumber: a.attemptNumber,
      recallGrade: a.recallGrade,
    }));
}
