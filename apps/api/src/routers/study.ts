import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import {
  acceptAnswer,
  answerItem,
  finishStudySession,
  startStudySession,
} from '../services/studySessions.js';

export const studyRouter = router({
  startSession: protectedProcedure
    .input(z.object({ deckId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      return startStudySession(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
    }),

  submitAnswer: protectedProcedure
    .input(
      z.object({
        itemId: z.string(),
        userAnswer: z.string().trim().min(1, 'Answer cannot be empty'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return answerItem(ctx.prisma, { userId: ctx.userId, ...input });
    }),

  dontKnow: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return answerItem(ctx.prisma, {
        userId: ctx.userId,
        itemId: input.itemId,
        userAnswer: null,
      });
    }),

  finishSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return finishStudySession(ctx.prisma, {
        userId: ctx.userId,
        id: input.id,
      });
    }),

  acceptAnswer: protectedProcedure
    .input(
      z.object({
        attemptId: z.string(),
        // The primary Canonical Answer when absent
        canonicalAnswerId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return acceptAnswer(ctx.prisma, { userId: ctx.userId, ...input });
    }),
});
