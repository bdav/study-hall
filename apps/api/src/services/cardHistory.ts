import { type PrismaClient, type RecallGrade } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { isCorrect } from './countedAttempts.js';
import {
  parseVariantsByAnswer,
  variantsByAnswer,
  withCanonicalAnswers,
  type VariantsByAnswer,
} from './cards.js';

/**
 * Each of a version's answers' variants, in its answers' order, found by
 * text, since the primary may have changed without a new version.
 */
function variantsOf(canonicalAnswers: string[], byAnswer: VariantsByAnswer) {
  return canonicalAnswers.map(
    (text) => byAnswer.find((a) => a.text === text)?.acceptedVariants ?? [],
  );
}

type Attempt = {
  id: string;
  userAnswer: string | null;
  recallGrade: RecallGrade;
  createdAt: Date;
};

/** A set of answers to a card: newest first, how many, and how many right. */
function summarizeAttempts(attempts: Attempt[]) {
  return {
    attempts,
    answeredCount: attempts.length,
    rightCount: attempts.filter((a) => isCorrect(a.recallGrade)).length,
  };
}

/**
 * A learner's history with one of their cards (ADR-0008): each Card
 * Version, newest first, with its answers and how many were right, and the
 * attempts from before versions were recorded, as an earlier version. Each
 * version has its answers' Accepted Variants: the card's own for the current
 * one, those it ended with for an earlier one, or none (`null`) for one that
 * ended before they were recorded. An attempt's grade is its final one,
 * after "My answer was correct". The card's progress is its lifecycle state
 * and when it's next due; the mastery score stays inside the scheduler. Only
 * the deck's owner sees it.
 */
export async function cardHistory(
  prisma: PrismaClient,
  { userId, cardId }: { userId: string; cardId: string },
) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { userId } },
    select: {
      versions: {
        orderBy: { number: 'desc' },
        select: {
          id: true,
          number: true,
          front: true,
          canonicalAnswers: true,
          acceptedVariants: true,
          startedAt: true,
        },
      },
      canonicalAnswers: withCanonicalAnswers.canonicalAnswers,
      progress: {
        where: { userId },
        select: { lifecycleState: true, dueAt: true },
      },
    },
  });
  if (!card) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
  }

  const attempts = await prisma.cardAttempt.findMany({
    where: { cardId, studySession: { userId } },
    orderBy: [{ createdAt: 'desc' }, { attemptNumber: 'desc' }],
    select: {
      id: true,
      cardVersionId: true,
      userAnswer: true,
      recallGrade: true,
      createdAt: true,
    },
  });
  const attemptsOf = (versionId: string | null) =>
    attempts
      .filter((attempt) => attempt.cardVersionId === versionId)
      .map(({ id, userAnswer, recallGrade, createdAt }) => ({
        id,
        userAnswer,
        recallGrade,
        createdAt,
      }));

  const unversioned = attemptsOf(null);
  return {
    progress: card.progress[0] ?? null,
    versions: card.versions.map(({ acceptedVariants, ...version }, i) => {
      // The card's own for the current version, those it ended with for one
      // that's over
      const byAnswer =
        i === 0
          ? variantsByAnswer(card)
          : parseVariantsByAnswer(acceptedVariants);
      return {
        ...version,
        isCurrent: i === 0,
        acceptedVariants: byAnswer
          ? variantsOf(version.canonicalAnswers, byAnswer)
          : null,
        ...summarizeAttempts(attemptsOf(version.id)),
      };
    }),
    unversioned: unversioned.length > 0 ? summarizeAttempts(unversioned) : null,
  };
}
