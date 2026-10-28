import { Prisma, type PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { markKnown, NEW_PROGRESS } from './progressUpdater.js';
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

const variantsByAnswerSchema = z.array(
  z.object({ text: z.string(), acceptedVariants: z.array(z.string()) }),
);

/**
 * Each of a card's Canonical Answers with its Accepted Variants' texts, as a
 * Card Version records them when it ends (#51).
 */
export type VariantsByAnswer = z.infer<typeof variantsByAnswerSchema>;

/** A card's answers' variants, loaded with `withCanonicalAnswers`. */
export function variantsByAnswer(card: {
  canonicalAnswers: { text: string; acceptedVariants: { text: string }[] }[];
}): VariantsByAnswer {
  return card.canonicalAnswers.map((answer) => ({
    text: answer.text,
    acceptedVariants: answer.acceptedVariants.map((v) => v.text),
  }));
}

/** A Card Version's recorded variants; null for one with none recorded. */
export function parseVariantsByAnswer(value: Prisma.JsonValue) {
  return value === null ? null : variantsByAnswerSchema.parse(value);
}

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
 * `acceptedVariants`, when given, are all of its Accepted Variants' texts;
 * without them an unchanged answer keeps its variants and a retyped one,
 * whose old variants may not fit it, loses them.
 */
export interface AnswerEdit {
  id?: string;
  text: string;
  acceptedVariants?: string[];
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

/**
 * Refuses listed Accepted Variants that add nothing: one that grading
 * couldn't tell apart from an earlier one of its answer's, or from one of
 * the card's answers. One differing only in accents isn't refused, so a
 * variant can accept an unaccented form as exact.
 */
function assertUsefulVariants(answers: AnswerEdit[]) {
  const texts = answers.map((answer) => answer.text);
  for (const answer of answers) {
    const variants = answer.acceptedVariants ?? [];
    for (const [i, variant] of variants.entries()) {
      const accepted = [...texts, ...variants.slice(0, i)];
      if (accepted.some((text) => matchAnswer(variant, text) === 'exact')) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `“${variant}” is already accepted`,
        });
      }
    }
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
 * Canonical Answers, the first primary, card progress in NEW state for the
 * deck owner, and its first Card Version, starting with that progress.
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
    const startedAt = new Date();
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
          progress: { create: { userId, deckId, resetAt: startedAt } },
          versions: {
            create: {
              number: 1,
              front: card.front,
              canonicalAnswers: card.canonicalAnswers,
              startedAt,
            },
          },
        },
        include: withCanonicalAnswers,
      }),
    );
  }
  return created;
}

/**
 * Edits a card's front and/or its Canonical Answers, given in full, the
 * first primary, each with its Accepted Variants when listed (`AnswerEdit`).
 * A change to the front or to the answers' texts resets the card's progress
 * to NEW but keeps its attempts (ADR-0004), and starts a new Card Version
 * with it (ADR-0008), the one it ends keeping the Accepted Variants it had;
 * choosing another primary or changing variants alone does neither, as
 * neither changes what the card asks.
 * A listed variant still on its answer keeps its row. A removed answer's
 * variants go with it, and an unlisted variant that is now one of the
 * card's answers is dropped, as listing it would be refused.
 * An edit from a revision of the deck (ADR-0007) records its model and
 * prompt version on the Card Version it starts, and one restoring an
 * earlier version (#54) that version's number.
 */
export async function editCard(
  db: Db,
  {
    cardId,
    front,
    canonicalAnswers,
    source,
    restoredFromNumber,
  }: {
    cardId: string;
    front?: string;
    canonicalAnswers?: AnswerEdit[];
    source?: Omit<CardSource, 'lessonId'>;
    restoredFromNumber?: number;
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
    }));

  const edited = await cardWithAnswers(db, cardId);
  if (frontChanged || answersChanged) {
    const resetAt = new Date();
    await db.cardProgress.updateMany({
      where: { cardId },
      data: { ...NEW_PROGRESS, resetAt },
    });
    // The version this edit ends keeps the variants it had (#51)
    const ending = await db.cardVersion.findFirstOrThrow({
      where: { cardId },
      orderBy: { number: 'desc' },
      select: { id: true, number: true },
    });
    await db.cardVersion.update({
      where: { id: ending.id },
      data: { acceptedVariants: variantsByAnswer(card) },
    });
    await db.cardVersion.create({
      data: {
        cardId,
        number: ending.number + 1,
        front: edited.front,
        canonicalAnswers: edited.canonicalAnswers.map((answer) => answer.text),
        startedAt: resetAt,
        sourceModel: source?.model,
        sourcePromptVersion: source?.promptVersion,
        restoredFromNumber,
      },
    });
  }

  return edited;
}

/**
 * Whether a Card Version asks what a card, loaded with
 * `withCanonicalAnswers`, asks: the same front and answers, in any order, as
 * an edit that changes only the primary starts no version.
 */
export function asksTheSame(
  version: { front: string; canonicalAnswers: string[] },
  card: { front: string; canonicalAnswers: { text: string }[] },
) {
  const sorted = (list: string[]) => [...list].sort().join('\n');
  return (
    version.front === card.front &&
    sorted(version.canonicalAnswers) ===
      sorted(card.canonicalAnswers.map((answer) => answer.text))
  );
}

/**
 * Restores an earlier Card Version of a card (#54): an edit like any other
 * (`editCard`), setting the card's front and Canonical Answers to the
 * version's, and starting a new version that names it. When it recorded
 * its Accepted Variants, its answers come back as it ended with them,
 * primary first, with their variants; otherwise in the order it started
 * with, an answer whose text is unchanged keeping its variants and the
 * others having none.
 */
export async function restoreCardVersion(
  db: Db,
  { cardId, versionId }: { cardId: string; versionId: string },
) {
  const version = await db.cardVersion.findFirst({
    where: { id: versionId, cardId },
  });
  if (!version) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });
  }
  const card = await cardWithAnswers(db, cardId);
  if (asksTheSame(version, card)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The card already asks what this version asks',
    });
  }
  const recorded = parseVariantsByAnswer(version.acceptedVariants);
  return editCard(db, {
    cardId,
    front: version.front,
    canonicalAnswers:
      recorded ?? version.canonicalAnswers.map((text) => ({ text })),
    restoredFromNumber: version.number,
  });
}

/** The id of a card's current Card Version, the latest. */
export async function currentVersionId(db: Db, cardId: string) {
  const version = await db.cardVersion.findFirstOrThrow({
    where: { cardId },
    orderBy: { number: 'desc' },
    select: { id: true },
  });
  return version.id;
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
  }: {
    cardId: string;
    existing: {
      id: string;
      text: string;
      isPrimary: boolean;
      position: number;
      acceptedVariants: { id: string; text: string }[];
    }[];
    answers: AnswerEdit[];
  },
) {
  const texts = answers.map((answer) => answer.text);
  assertDistinctAnswers(texts);
  assertUsefulVariants(answers);
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
    const answerId =
      row?.id ??
      (
        await db.canonicalAnswer.create({
          data: { cardId, ...data },
          select: { id: true },
        })
      ).id;
    if (
      row &&
      (row.text !== data.text ||
        row.isPrimary !== data.isPrimary ||
        row.position !== data.position)
    ) {
      await db.canonicalAnswer.update({ where: { id: row.id }, data });
    }

    const listed = answer.acceptedVariants;
    const current = row?.acceptedVariants ?? [];
    if (listed === undefined) {
      // A retyped answer's old variants may not fit it
      if (row && row.text !== answer.text) {
        await db.acceptedVariant.deleteMany({
          where: { canonicalAnswerId: row.id },
        });
      }
      continue;
    }
    await db.acceptedVariant.deleteMany({
      where: { canonicalAnswerId: answerId, text: { notIn: listed } },
    });
    const kept = new Set(current.map((variant) => variant.text));
    for (const text of listed.filter((text) => !kept.has(text))) {
      await db.acceptedVariant.create({
        data: {
          canonicalAnswerId: answerId,
          text,
          normalizedText: normalizeAnswer(text),
        },
      });
    }
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

function cardWithAnswers(db: Db, cardId: string) {
  return db.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });
}

/**
 * Marks a learner's cards known (ADR-0009), in one transaction: NEW and
 * LEARNING cards take `markKnown`'s progress, and ones already STABLE or
 * RETIRED are left as they are. No attempt is recorded. The cards' items
 * waiting in a Study Session under way are skipped, as the study screen
 * moves past them. Returns how many cards were marked.
 */
export async function markCardsKnown(
  prisma: PrismaClient,
  { userId, cardIds }: { userId: string; cardIds: string[] },
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const progresses = await tx.cardProgress.findMany({
      where: { userId, cardId: { in: cardIds } },
    });
    let markedCount = 0;
    for (const progress of progresses) {
      const known = markKnown(progress, now);
      if (!known) continue;
      await tx.cardProgress.update({ where: { id: progress.id }, data: known });
      markedCount++;
    }
    await tx.studySessionItem.updateMany({
      where: {
        cardId: { in: cardIds },
        status: 'PENDING',
        studySession: { userId, status: 'ACTIVE' },
      },
      data: { status: 'SKIPPED' },
    });
    return { markedCount };
  });
}
