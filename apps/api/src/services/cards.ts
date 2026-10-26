import { Prisma, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { NEW_PROGRESS } from './progressUpdater.js';
import {
  gradeAnswer,
  matchAnswer,
  normalizeAnswer,
  type Grading,
} from './answerGrader.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Include for returning a card with its canonical answers, primary first,
 * each with its Accepted Variants in the order they were added.
 */
export const withCanonicalAnswers = {
  canonicalAnswers: {
    select: {
      id: true,
      text: true,
      isPrimary: true,
      acceptedVariants: {
        select: { id: true, text: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.CardInclude;

/** A deck's cards in the order they were added. */
export const deckOrder = [
  { position: 'asc' },
  { createdAt: 'asc' },
] satisfies Prisma.CardOrderByWithRelationInput[];

/** The text of a card's primary canonical answer, loaded with `withCanonicalAnswers`. */
export function primaryAnswerText(card: {
  canonicalAnswers: { text: string }[];
}) {
  return card.canonicalAnswers[0]?.text ?? '';
}

/**
 * Grades an answer to a card, loaded with `withCanonicalAnswers`, against
 * each of its canonical answers and their Accepted Variants. The best grade
 * wins, the primary answer first among equals.
 */
export function gradeCardAnswer(
  userAnswer: string,
  card: {
    canonicalAnswers: { text: string; acceptedVariants: { text: string }[] }[];
  },
): Grading {
  const gradings = card.canonicalAnswers.map((answer) =>
    gradeAnswer(
      userAnswer,
      answer.text,
      answer.acceptedVariants.map((variant) => variant.text),
    ),
  );
  return (
    gradings.find((g) => g.recallGrade === 'NAILED') ??
    gradings.find((g) => g.recallGrade === 'GOOD') ?? {
      recallGrade: 'MISSED',
      accentMismatch: false,
      matchedVariant: null,
    }
  );
}

export interface NewCard {
  front: string;
  canonicalAnswer: string;
}

/** Where cards made from a lesson came from: its Source Lesson and proposal. */
export interface CardSource {
  lessonId: string;
  model: string;
  promptVersion: string;
}

/**
 * Creates cards at the end of a deck, each with one primary canonical answer
 * and card progress in NEW state for the deck owner.
 */
export async function createCards(
  db: Db,
  {
    deckId,
    userId,
    cards,
    source,
  }: { deckId: string; userId: string; cards: NewCard[]; source?: CardSource },
) {
  const last = await db.card.aggregate({
    where: { deckId },
    _max: { position: true },
  });
  const firstPosition = (last._max.position ?? -1) + 1;

  const created = [];
  for (const [i, card] of cards.entries()) {
    created.push(
      await db.card.create({
        data: {
          deckId,
          front: card.front,
          position: firstPosition + i,
          sourceLessonId: source?.lessonId,
          sourceModel: source?.model,
          sourcePromptVersion: source?.promptVersion,
          canonicalAnswers: {
            create: {
              text: card.canonicalAnswer,
              normalizedText: normalizeAnswer(card.canonicalAnswer),
              isPrimary: true,
            },
          },
          progress: { create: { userId, deckId } },
        },
        include: withCanonicalAnswers,
      }),
    );
  }
  return created;
}

/**
 * Edits a card's front and/or its primary canonical answer. A change to
 * either resets the card's progress to NEW but keeps its attempts (ADR-0004).
 * A new answer keeps only the Accepted Variants in `keepVariantIds`, since
 * the old answer's variants may not fit it; none are kept when it's absent.
 * A variant the new answer has become is dropped, as adding it would be.
 */
export async function editCard(
  db: Db,
  {
    cardId,
    front,
    canonicalAnswer,
    keepVariantIds = [],
  }: {
    cardId: string;
    front?: string;
    canonicalAnswer?: string;
    keepVariantIds?: string[];
  },
) {
  const card = await db.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });
  const primary = card.canonicalAnswers[0];

  const frontChanged = front !== undefined && front !== card.front;
  const answerChanged =
    canonicalAnswer !== undefined && canonicalAnswer !== primary?.text;

  if (frontChanged) {
    await db.card.update({ where: { id: cardId }, data: { front } });
  }

  if (answerChanged) {
    const answerData = {
      text: canonicalAnswer,
      normalizedText: normalizeAnswer(canonicalAnswer),
    };
    if (primary) {
      await db.canonicalAnswer.update({
        where: { id: primary.id },
        data: answerData,
      });
      const kept = primary.acceptedVariants.filter(
        (variant) =>
          keepVariantIds.includes(variant.id) &&
          matchAnswer(variant.text, canonicalAnswer) !== 'exact',
      );
      await db.acceptedVariant.deleteMany({
        where: {
          canonicalAnswerId: primary.id,
          id: { notIn: kept.map((variant) => variant.id) },
        },
      });
    } else {
      await db.canonicalAnswer.create({
        data: { cardId, isPrimary: true, ...answerData },
      });
    }
  }

  if (frontChanged || answerChanged) {
    await db.cardProgress.updateMany({
      where: { cardId },
      data: { ...NEW_PROGRESS, resetAt: new Date() },
    });
  }

  return db.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });
}

/**
 * Adds an Accepted Variant to a Canonical Answer. A variant doesn't change
 * what the card asks, so the card's progress is untouched (ADR-0004). One
 * that grading can't tell apart from the answer or one of its variants is
 * a duplicate; one that differs only in accents isn't, so a variant can
 * accept an unaccented form as exact. Returns the card.
 */
export async function addAcceptedVariant(
  db: Db,
  { canonicalAnswerId, text }: { canonicalAnswerId: string; text: string },
) {
  const answer = await db.canonicalAnswer.findUniqueOrThrow({
    where: { id: canonicalAnswerId },
    select: {
      cardId: true,
      text: true,
      acceptedVariants: { select: { text: true } },
    },
  });
  if (alreadyAccepts(answer, text)) throw alreadyAccepted();

  try {
    await db.acceptedVariant.create({
      data: { canonicalAnswerId, text, normalizedText: normalizeAnswer(text) },
    });
  } catch (error) {
    // The same variant added concurrently, caught by its unique constraint
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw alreadyAccepted();
    }
    throw error;
  }
  return cardWithAnswers(db, answer.cardId);
}

/**
 * Whether grading can't tell `text` apart from a Canonical Answer or one of
 * its Accepted Variants.
 */
export function alreadyAccepts(
  answer: { text: string; acceptedVariants: { text: string }[] },
  text: string,
) {
  return [answer.text, ...answer.acceptedVariants.map((v) => v.text)].some(
    (accepted) => matchAnswer(text, accepted) === 'exact',
  );
}

function alreadyAccepted() {
  return new TRPCError({
    code: 'CONFLICT',
    message: 'That answer is already accepted',
  });
}

/**
 * Removes an Accepted Variant, leaving the card's progress untouched.
 * Returns the card.
 */
export async function removeAcceptedVariant(
  db: Db,
  { variantId }: { variantId: string },
) {
  const variant = await db.acceptedVariant.delete({
    where: { id: variantId },
    select: { canonicalAnswer: { select: { cardId: true } } },
  });
  return cardWithAnswers(db, variant.canonicalAnswer.cardId);
}

function cardWithAnswers(db: Db, cardId: string) {
  return db.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });
}
