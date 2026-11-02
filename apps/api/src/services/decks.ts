import { type PrismaClient, type StudyDirection } from '@prisma/client';
import { TRPCError } from '@trpc/server';

/*
 * An archived deck keeps everything and can be read, but can't be studied
 * or changed until it's restored (#77, ADR-0003).
 */

function archivedDeckError() {
  return new TRPCError({
    code: 'CONFLICT',
    message: 'This deck is archived. Restore it to study or change it.',
  });
}

function deckNotFoundError() {
  return new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
}

/** Refuses a change to a deck once it's archived. */
export function assertDeckActive(deck: { archivedAt: Date | null }) {
  if (deck.archivedAt) throw archivedDeckError();
}

/**
 * Refuses studying a deck in Reverse unless it's a Reversible Deck
 * (ADR-0011): turned off, Reverse is hidden.
 */
export function assertStudiesIn(
  deck: { reversible: boolean },
  direction: StudyDirection,
) {
  if (direction === 'REVERSE' && !deck.reversible) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This deck isn’t studied both ways',
    });
  }
}

/** The user's deck, archived or not; NOT_FOUND for anyone else's. */
export async function findOwnedDeck(
  prisma: PrismaClient,
  { userId, deckId }: { userId: string; deckId: string },
) {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId, userId },
  });
  if (!deck) throw deckNotFoundError();
  return deck;
}

/** The user's deck when it isn't archived: one they can study or change. */
export async function findActiveDeck(
  prisma: PrismaClient,
  where: { userId: string; deckId: string },
) {
  const deck = await findOwnedDeck(prisma, where);
  assertDeckActive(deck);
  return deck;
}

/**
 * Refuses, as not found, any card that isn't in one of the user's decks,
 * and any in an archived deck as archived. When changing the cards in
 * Study Directions, any in a deck not studied in one of them is refused
 * (`assertStudiesIn`).
 */
export async function assertCanChangeCards(
  prisma: PrismaClient,
  {
    userId,
    cardIds,
    directions = [],
  }: { userId: string; cardIds: string[]; directions?: StudyDirection[] },
) {
  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds }, deck: { userId } },
    select: { deck: { select: { archivedAt: true, reversible: true } } },
  });
  if (cards.length !== new Set(cardIds).size) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
  }
  for (const { deck } of cards) {
    assertDeckActive(deck);
    for (const direction of directions) assertStudiesIn(deck, direction);
  }
}
