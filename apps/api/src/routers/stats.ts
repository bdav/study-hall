import { type StudyDirection } from '@prisma/client';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import { studyDirection } from './inputs.js';
import {
  type CountedAttempt,
  findCountedAttempts,
  isCorrect,
} from '../services/countedAttempts.js';
import { askedIn, withCanonicalAnswers } from '../services/cards.js';
import { assertStudiesIn, findOwnedDeck } from '../services/decks.js';

/** One card in one Study Direction, each of which has its own stats. */
interface PerCardStats {
  cardId: string;
  direction: StudyDirection;
  totalAttempts: number;
  avgAttemptsToCorrect: number | null;
}

/**
 * Computes per-card stats from a list of attempts, scoped per session.
 * Groups by (sessionId, cardId), then averages attempts-to-correct across sessions.
 */
function computePerCardStats(attempts: CountedAttempt[]): {
  perCard: PerCardStats[];
  firstTryAccuracy: number;
  uniqueCardsStudied: number;
} {
  // Group attempts by (sessionId, cardId)
  const bySessionCard = new Map<string, CountedAttempt[]>();
  for (const attempt of attempts) {
    const key = `${attempt.studySessionId}:${attempt.cardId}`;
    const existing = bySessionCard.get(key);
    if (existing) {
      existing.push(attempt);
    } else {
      bySessionCard.set(key, [attempt]);
    }
  }

  // First-try accuracy: for each (session, card) pair, was attempt #1 correct?
  let firstTryCorrect = 0;
  let totalFirstTries = 0;
  for (const [, sessionCardAttempts] of bySessionCard) {
    totalFirstTries++;
    const first = sessionCardAttempts.reduce((min, a) =>
      a.attemptNumber < min.attemptNumber ? a : min,
    );
    if (isCorrect(first.recallGrade)) {
      firstTryCorrect++;
    }
  }
  const firstTryAccuracy =
    totalFirstTries === 0 ? 0 : firstTryCorrect / totalFirstTries;

  // Per card direction: average attempts-to-correct across sessions, each
  // of which is in one direction
  const byCard = new Map<string, number[]>();
  for (const [, sessionCardAttempts] of bySessionCard) {
    const { cardId, direction } = sessionCardAttempts[0];
    const key = `${cardId}:${direction}`;
    const sorted = [...sessionCardAttempts].sort(
      (a, b) => a.attemptNumber - b.attemptNumber,
    );
    const firstCorrectIdx = sorted.findIndex((a) => isCorrect(a.recallGrade));
    const attemptsToCorrect =
      firstCorrectIdx === -1 ? null : firstCorrectIdx + 1;

    if (!byCard.has(key)) {
      byCard.set(key, []);
    }
    if (attemptsToCorrect !== null) {
      byCard.get(key)!.push(attemptsToCorrect);
    }
  }

  const perCard = Array.from(byCard.entries()).map(
    ([key, attemptsToCorrectList]) => {
      const [cardId, direction] = key.split(':') as [string, StudyDirection];
      const totalCardAttempts = attempts.filter(
        (a) => a.cardId === cardId && a.direction === direction,
      ).length;
      const avg =
        attemptsToCorrectList.length === 0
          ? null
          : attemptsToCorrectList.reduce((sum, n) => sum + n, 0) /
            attemptsToCorrectList.length;
      return {
        cardId,
        direction,
        totalAttempts: totalCardAttempts,
        avgAttemptsToCorrect: avg,
      };
    },
  );

  return { perCard, firstTryAccuracy, uniqueCardsStudied: byCard.size };
}

const MAX_WEAK_CARDS = 10;

export const statsRouter = router({
  /** A deck's stats in one Study Direction, Forward unless given. */
  deckStats: protectedProcedure
    .input(z.object({ deckId: z.string(), direction: studyDirection }))
    .query(async ({ ctx, input }) => {
      const deck = await findOwnedDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
      assertStudiesIn(deck, input.direction);

      const attempts = await findCountedAttempts(ctx.prisma, {
        userId: ctx.userId,
        deckIds: [input.deckId],
        direction: input.direction,
      });

      if (attempts.length === 0) {
        return {
          totalAttempts: 0,
          uniqueCardsStudied: 0,
          firstTryAccuracy: 0,
          overallAccuracy: 0,
          cardStats: [],
        };
      }

      const totalAttempts = attempts.length;
      const totalCorrect = attempts.filter((a) =>
        isCorrect(a.recallGrade),
      ).length;
      const overallAccuracy = totalCorrect / totalAttempts;

      const { perCard, firstTryAccuracy, uniqueCardsStudied } =
        computePerCardStats(attempts);

      // Each card's front, and what it asks in the direction, for the
      // per-card breakdown
      const cardIds = perCard.map((c) => c.cardId);
      const cards =
        cardIds.length > 0
          ? await ctx.prisma.card.findMany({
              where: { id: { in: cardIds } },
              include: withCanonicalAnswers,
            })
          : [];
      const cardMap = new Map(cards.map((c) => [c.id, c]));

      return {
        totalAttempts,
        uniqueCardsStudied,
        firstTryAccuracy,
        overallAccuracy,
        cardStats: perCard.map((c) => {
          const card = cardMap.get(c.cardId);
          return {
            ...c,
            front: card?.front ?? '',
            question: card ? askedIn(card, c.direction) : '',
          };
        }),
      };
    }),

  overallStats: protectedProcedure.query(async ({ ctx }) => {
    // TODO: Add pagination or date-range filtering for users with large attempt histories
    // Decks in Flashcards: archived ones are left out (#77)
    const activeDecks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.userId, archivedAt: null },
      select: { id: true },
    });
    const attempts = await findCountedAttempts(ctx.prisma, {
      userId: ctx.userId,
      deckIds: activeDecks.map((deck) => deck.id),
    });

    if (attempts.length === 0) {
      return {
        totalAttempts: 0,
        totalCorrect: 0,
        overallAccuracy: 0,
        deckCount: 0,
        weakCards: [] as {
          cardId: string;
          direction: StudyDirection;
          front: string;
          question: string;
          deckId: string;
          deckName: string;
          // Its deck's Reversible Deck settings, to name the direction
          deck: {
            reversible: boolean;
            forwardLabel: string | null;
            reverseLabel: string | null;
          } | null;
          avgAttemptsToCorrect: number;
        }[],
      };
    }

    const totalAttempts = attempts.length;
    const totalCorrect = attempts.filter((a) =>
      isCorrect(a.recallGrade),
    ).length;
    const overallAccuracy = totalCorrect / totalAttempts;
    const deckIds = new Set(attempts.map((a) => a.deckId));

    const { perCard } = computePerCardStats(attempts);

    // Get card details for weak card directions (avgAttemptsToCorrect > 1)
    const weakCardCandidates = perCard
      .filter(
        (c) => c.avgAttemptsToCorrect !== null && c.avgAttemptsToCorrect > 1,
      )
      .sort((a, b) => {
        const diff = b.avgAttemptsToCorrect! - a.avgAttemptsToCorrect!;
        if (diff !== 0) return diff;
        return (
          a.cardId.localeCompare(b.cardId) ||
          a.direction.localeCompare(b.direction)
        );
      })
      .slice(0, MAX_WEAK_CARDS);

    // Fetch card context (front text, deckId) for the weak cards
    const weakCardIds = weakCardCandidates.map((c) => c.cardId);
    const cards =
      weakCardIds.length > 0
        ? await ctx.prisma.card.findMany({
            where: { id: { in: weakCardIds } },
            include: {
              ...withCanonicalAnswers,
              deck: {
                select: {
                  name: true,
                  reversible: true,
                  forwardLabel: true,
                  reverseLabel: true,
                },
              },
            },
          })
        : [];
    const cardMap = new Map(cards.map((c) => [c.id, c]));

    const weakCards = weakCardCandidates.map((c) => {
      const card = cardMap.get(c.cardId);
      return {
        cardId: c.cardId,
        direction: c.direction,
        front: card?.front ?? '',
        question: card ? askedIn(card, c.direction) : '',
        deckId: card?.deckId ?? '',
        deckName: card?.deck.name ?? '',
        deck: card
          ? {
              reversible: card.deck.reversible,
              forwardLabel: card.deck.forwardLabel,
              reverseLabel: card.deck.reverseLabel,
            }
          : null,
        avgAttemptsToCorrect: c.avgAttemptsToCorrect!,
      };
    });

    return {
      totalAttempts,
      totalCorrect,
      overallAccuracy,
      deckCount: deckIds.size,
      weakCards,
    };
  }),
});
