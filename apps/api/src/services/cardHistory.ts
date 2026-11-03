import {
  type PrismaClient,
  type RecallGrade,
  type StudyDirection,
} from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { isCorrect } from './countedAttempts.js';
import { readCardStanding } from './cardStanding.js';
import {
  asksTheSame,
  parseVariantsByAnswer,
  variantsByAnswer,
  withCanonicalAnswers,
} from './cards.js';

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
 * A learner's history with one of their cards in a Study Direction
 * (ADR-0008, ADR-0011): each Card Version, newest first, with its answers
 * in that direction and how many were right, and the
 * attempts from before versions were recorded, as an earlier version. Each
 * version has its answers' Accepted Variants: the card's own for the current
 * one, those it ended with for an earlier one, or none (`null`) for one that
 * ended before they were recorded, and the Reverse Variants of its front
 * likewise. Each says when it started and ended, whether a revision of
 * the deck started it (`sourceModel`) or it restored an earlier version
 * (`restoredFromNumber`), and whether it can be restored (#54): an earlier
 * version that asks something the card doesn't now. An attempt's grade is
 * its final one, after "My answer was correct". The card's progress, in
 * the direction, is from its Card Standing: its lifecycle state, when it's
 * next due and whether it's known already; the mastery score stays inside
 * the scheduler. Only the deck's owner sees it.
 */
export async function cardHistory(
  prisma: PrismaClient,
  {
    userId,
    cardId,
    direction,
  }: { userId: string; cardId: string; direction: StudyDirection },
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
          reverseVariants: true,
          sourceModel: true,
          restoredFromNumber: true,
          startedAt: true,
        },
      },
      front: true,
      canonicalAnswers: withCanonicalAnswers.canonicalAnswers,
      reverseVariants: withCanonicalAnswers.reverseVariants,
    },
  });
  if (!card) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
  }

  const [standing] = (
    await readCardStanding(prisma, { userId, cardIds: [cardId], direction })
  ).cards;
  const attempts = await prisma.cardAttempt.findMany({
    where: { cardId, direction, studySession: { userId } },
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
    progress: standing && {
      lifecycleState: standing.lifecycleState,
      dueAt: standing.dueAt,
      isKnown: standing.isKnown,
    },
    versions: card.versions.map(
      ({ acceptedVariants, reverseVariants, ...version }, i) => {
        const isCurrent = i === 0;
        // The card's own answers and variants for the current version, those it
        // ended with for one that's over: primary first, as the primary may
        // have changed without a new version
        const byAnswer = isCurrent
          ? variantsByAnswer(card)
          : parseVariantsByAnswer(acceptedVariants);
        return {
          ...version,
          canonicalAnswers:
            byAnswer?.map((answer) => answer.text) ?? version.canonicalAnswers,
          // When the next version started
          endedAt: isCurrent ? null : card.versions[i - 1].startedAt,
          isCurrent,
          canRestore: !isCurrent && !asksTheSame(version, card),
          acceptedVariants:
            byAnswer?.map((answer) => answer.acceptedVariants) ?? null,
          reverseVariants: isCurrent
            ? card.reverseVariants.map((variant) => variant.text)
            : reverseVariants,
          ...summarizeAttempts(attemptsOf(version.id)),
        };
      },
    ),
    unversioned: unversioned.length > 0 ? summarizeAttempts(unversioned) : null,
  };
}
