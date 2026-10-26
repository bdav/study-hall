import { Prisma, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { NEW_PROGRESS } from './progressUpdater.js';
import {
  gradeAnswer,
  matchAnswer,
  NO_MATCH,
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
      position: true,
      acceptedVariants: {
        select: { id: true, text: true },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
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
    gradings.find((g) => g.recallGrade === 'GOOD') ??
    NO_MATCH
  );
}

/** A card to create: its front and its Canonical Answers, primary first. */
export interface NewCard {
  front: string;
  canonicalAnswers: string[];
}

/**
 * One of a card's Canonical Answers in an edit: an existing answer, by id,
 * possibly retyped, or a new one. An answer without an id that has an
 * existing answer's exact text is that answer, so its variants stay.
 */
export interface AnswerEdit {
  id?: string;
  text: string;
}

/** Refuses answers that grading couldn't tell apart, so each is distinct. */
function assertDistinctAnswers(texts: string[]) {
  const duplicate = texts.some((text, i) =>
    texts.slice(0, i).some((earlier) => matchAnswer(text, earlier) === 'exact'),
  );
  if (duplicate) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A card can’t have the same answer twice',
    });
  }
}

/** The data for a card's Canonical Answer at a place in its list. */
function answerData(text: string, position: number) {
  return {
    text,
    normalizedText: normalizeAnswer(text),
    isPrimary: position === 0,
    position,
  };
}

/** Where cards made from a lesson came from: its Source Lesson and proposal. */
export interface CardSource {
  lessonId: string;
  model: string;
  promptVersion: string;
}

/**
 * Creates cards at the end of a deck, in the order given, each with its
 * Canonical Answers, the first primary, and card progress in NEW state for
 * the deck owner.
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

  for (const card of cards) assertDistinctAnswers(card.canonicalAnswers);

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
            create: card.canonicalAnswers.map(answerData),
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
 * Edits a card's front and/or its Canonical Answers, given in full, the
 * first primary. A change to the front or to the answers' texts resets the
 * card's progress to NEW but keeps its attempts (ADR-0004); choosing another
 * primary alone doesn't, as every answer is equally correct. A retyped
 * answer keeps only the Accepted Variants in `keepVariantIds`, since the old
 * text's variants may not fit it; none are kept when it's absent. A removed
 * answer's variants go with it, and a variant that is now one of the card's
 * answers is dropped, as adding it would be.
 */
export async function editCard(
  db: Db,
  {
    cardId,
    front,
    canonicalAnswers,
    keepVariantIds = [],
  }: {
    cardId: string;
    front?: string;
    canonicalAnswers?: AnswerEdit[];
    keepVariantIds?: string[];
  },
) {
  const card = await db.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });

  const frontChanged = front !== undefined && front !== card.front;
  if (frontChanged) {
    await db.card.update({ where: { id: cardId }, data: { front } });
  }

  const answersChanged =
    canonicalAnswers !== undefined &&
    (await replaceAnswers(db, {
      cardId,
      existing: card.canonicalAnswers,
      answers: canonicalAnswers,
      keepVariantIds,
    }));

  if (frontChanged || answersChanged) {
    await db.cardProgress.updateMany({
      where: { cardId },
      data: { ...NEW_PROGRESS, resetAt: new Date() },
    });
  }

  return cardWithAnswers(db, cardId);
}

/**
 * Makes a card's Canonical Answers the given ones, in order. Returns whether
 * their texts changed, not just their order.
 */
async function replaceAnswers(
  db: Db,
  {
    cardId,
    existing,
    answers,
    keepVariantIds,
  }: {
    cardId: string;
    existing: {
      id: string;
      text: string;
      isPrimary: boolean;
      position: number;
    }[];
    answers: AnswerEdit[];
    keepVariantIds: string[];
  },
) {
  const texts = answers.map((answer) => answer.text);
  assertDistinctAnswers(texts);
  const ids = answers.flatMap((answer) => (answer.id ? [answer.id] : []));
  if (new Set(ids).size !== ids.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'An answer can only appear once',
    });
  }

  // Each answer's existing row: by id, then, for an answer without one, by
  // the unchanged text of a row no other answer has
  const rows = answers.map((answer) => {
    if (!answer.id) return undefined;
    const row = existing.find((r) => r.id === answer.id);
    if (!row) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Canonical answer not found',
      });
    }
    return row;
  });
  const claimed = new Set(ids);
  for (const [i, answer] of answers.entries()) {
    if (answer.id) continue;
    const row = existing.find(
      (r) => !claimed.has(r.id) && r.text === answer.text,
    );
    if (row) {
      rows[i] = row;
      claimed.add(row.id);
    }
  }

  await db.canonicalAnswer.deleteMany({
    where: { cardId, id: { notIn: [...claimed] } },
  });
  // A text moving to another row gets there in two steps, through a
  // placeholder no answer has, so no two rows ever share one
  const retyped = answers.flatMap((answer, i) => {
    const row = rows[i];
    return row && row.text !== answer.text ? [row] : [];
  });
  for (const row of retyped) {
    await db.canonicalAnswer.update({
      where: { id: row.id },
      data: { text: `moving answer ${row.id}` },
    });
  }
  for (const [position, answer] of answers.entries()) {
    const row = rows[position];
    const data = answerData(answer.text, position);
    if (!row) {
      await db.canonicalAnswer.create({ data: { cardId, ...data } });
    } else if (
      row.text !== data.text ||
      row.isPrimary !== data.isPrimary ||
      row.position !== data.position
    ) {
      await db.canonicalAnswer.update({ where: { id: row.id }, data });
    }
  }
  for (const row of retyped) {
    await db.acceptedVariant.deleteMany({
      where: { canonicalAnswerId: row.id, id: { notIn: keepVariantIds } },
    });
  }

  // A variant that is now one of the card's answers adds nothing
  const variants = await db.acceptedVariant.findMany({
    where: { canonicalAnswer: { cardId } },
    select: { id: true, text: true },
  });
  const nowAnswers = variants.filter((variant) =>
    texts.some((text) => matchAnswer(variant.text, text) === 'exact'),
  );
  await db.acceptedVariant.deleteMany({
    where: { id: { in: nowAnswers.map((variant) => variant.id) } },
  });

  const sorted = (list: string[]) => [...list].sort().join('\n');
  return sorted(texts) !== sorted(existing.map((row) => row.text));
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
