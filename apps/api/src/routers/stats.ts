import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import { studyDirection } from './inputs.js';
import {
  accuracy,
  answerCount,
  type CardStanding,
  readCardStanding,
  type Standings,
} from '../services/cardStanding.js';
import { findRecentSessions } from '../services/studySessions.js';
import { askedIn, withCanonicalAnswers } from '../services/cards.js';
import { assertStudiesIn, findOwnedDeck } from '../services/decks.js';

/** The most Weak cards a stats page lists, the weakest first. */
const MAX_WEAK_CARDS = 10;

/**
 * What both stats pages show from their cards' Card Standing: Counted
 * Answers by Recall Grade, how many, and the share right; how many cards
 * are in each Lifecycle State and Mastery Band; and how many are Weak.
 */
function standingStats({ counts, weak }: Standings) {
  return {
    answers: counts.answers,
    answerCount: answerCount(counts.answers),
    accuracy: accuracy(counts.answers),
    lifecycle: counts.lifecycle,
    bands: counts.bands,
    weakCount: weak.length,
  };
}

/**
 * The weakest of the Weak cards, as Card Standing ranks them, each with
 * what it asks in its Study Direction and its deck: on a Reversible Deck
 * its Direction Labels name the direction (ADR-0011), and a Course Deck
 * names its course.
 */
async function weakestCards(prisma: PrismaClient, weak: CardStanding[]) {
  const weakest = weak.slice(0, MAX_WEAK_CARDS);
  const cards = await prisma.card.findMany({
    where: { id: { in: weakest.map(({ cardId }) => cardId) } },
    include: {
      ...withCanonicalAnswers,
      deck: {
        select: {
          id: true,
          name: true,
          reversible: true,
          forwardLabel: true,
          reverseLabel: true,
          course: { select: { id: true, title: true } },
        },
      },
    },
  });
  const byId = new Map(cards.map((card) => [card.id, card]));
  return weakest.map(({ cardId, direction, recentMisses }) => {
    const card = byId.get(cardId)!;
    return {
      cardId,
      direction,
      question: askedIn(card, direction),
      recentMisses,
      deck: card.deck,
    };
  });
}

export const statsRouter = router({
  /**
   * A deck's stats in one Study Direction, Forward unless given, on the
   * scheduler's terms (`standingStats`): its Counted Answers and their
   * accuracy, its cards by Lifecycle State and Mastery Band, its weakest
   * cards, and its recent Study Sessions.
   */
  deckStats: protectedProcedure
    .input(z.object({ deckId: z.string(), direction: studyDirection }))
    .query(async ({ ctx, input }) => {
      const deck = await findOwnedDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
      assertStudiesIn(deck, input.direction);
      const learnerDeck = {
        userId: ctx.userId,
        deckIds: [input.deckId],
        direction: input.direction,
      };

      const [standings, sessions] = await Promise.all([
        readCardStanding(ctx.prisma, learnerDeck),
        findRecentSessions(ctx.prisma, learnerDeck),
      ]);
      return {
        ...standingStats(standings),
        weakCards: await weakestCards(ctx.prisma, standings.weak),
        sessions,
      };
    }),

  /**
   * The learner's stats across their decks in Flashcards, archived ones
   * left out (#77): the same as a deck's, in every Study Direction each is
   * studied in, and how many decks the answers are from; each Weak card and
   * Study Session names its deck and its course, if any.
   */
  overallStats: protectedProcedure.query(async ({ ctx }) => {
    const activeDecks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.userId, archivedAt: null },
      select: { id: true },
    });
    const learnerDecks = {
      userId: ctx.userId,
      deckIds: activeDecks.map((deck) => deck.id),
    };

    const [standings, sessions] = await Promise.all([
      readCardStanding(ctx.prisma, learnerDecks),
      findRecentSessions(ctx.prisma, learnerDecks),
    ]);
    const answeredDecks = new Set(
      standings.cards
        .filter((card) => answerCount(card.countedAnswers) > 0)
        .map((card) => card.deckId),
    );
    return {
      ...standingStats(standings),
      deckCount: answeredDecks.size,
      weakCards: await weakestCards(ctx.prisma, standings.weak),
      sessions,
    };
  }),
});
