import { type Prisma, type PrismaClient } from '@prisma/client';
import { normalizeAnswer } from './answerGrader.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Include for returning a card with its canonical answers, primary first. */
export const withCanonicalAnswers = {
  canonicalAnswers: {
    select: { id: true, text: true, isPrimary: true },
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

export interface NewCard {
  front: string;
  canonicalAnswer: string;
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
  }: { deckId: string; userId: string; cards: NewCard[] },
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
 */
export async function editCard(
  db: Db,
  {
    cardId,
    front,
    canonicalAnswer,
  }: { cardId: string; front?: string; canonicalAnswer?: string },
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
    } else {
      await db.canonicalAnswer.create({
        data: { cardId, isPrimary: true, ...answerData },
      });
    }
  }

  if (frontChanged || answerChanged) {
    await db.cardProgress.updateMany({
      where: { cardId },
      data: {
        lifecycleState: 'NEW',
        masteryScore: 0,
        dueAt: null,
        lastReviewedAt: null,
        lastIntervalDays: null,
        lapseCount: 0,
        resetAt: new Date(),
      },
    });
  }

  return db.card.findUniqueOrThrow({
    where: { id: cardId },
    include: withCanonicalAnswers,
  });
}
