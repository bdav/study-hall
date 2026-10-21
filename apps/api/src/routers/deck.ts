import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import { deckOrder, withCanonicalAnswers } from '../services/cards.js';
import { findCountedAttempts, isCorrect } from '../services/countedAttempts.js';

export const deckRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.id, userId: ctx.userId },
        include: {
          cards: {
            orderBy: deckOrder,
            include: withCanonicalAnswers,
          },
        },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      return deck;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const decks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { cards: true } },
        studySessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { startedAt: true },
        },
      },
    });

    // Fetch counted attempt stats per deck in a single query
    const deckIds = decks.map((d) => d.id);
    const attemptsByDeck = new Map<
      string,
      { total: number; correct: number }
    >();

    if (deckIds.length > 0) {
      const attempts = await findCountedAttempts(ctx.prisma, {
        userId: ctx.userId,
        deckIds,
      });

      for (const attempt of attempts) {
        const stats = attemptsByDeck.get(attempt.deckId) ?? {
          total: 0,
          correct: 0,
        };
        stats.total++;
        if (isCorrect(attempt.recallGrade)) stats.correct++;
        attemptsByDeck.set(attempt.deckId, stats);
      }
    }

    return decks.map((deck) => {
      const stats = attemptsByDeck.get(deck.id) ?? { total: 0, correct: 0 };
      const accuracy = stats.total === 0 ? 0 : stats.correct / stats.total;

      return {
        id: deck.id,
        name: deck.name,
        description: deck.description,
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        userId: deck.userId,
        cardCount: deck._count.cards,
        totalAttempts: stats.total,
        accuracy,
        lastStudied: deck.studySessions[0]?.startedAt ?? null,
      };
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.deck.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          userId: ctx.userId,
        },
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.id, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      return ctx.prisma.deck.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
        },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.id, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      await ctx.prisma.deck.delete({ where: { id: input.id } });

      return { success: true };
    }),
});
