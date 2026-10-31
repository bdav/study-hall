import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import {
  abandonStudySession,
  acceptAnswer,
  answerItem,
  finishStudySession,
  findResumableSession,
  previewQueue,
  startStudySession,
} from '../services/studySessions.js';
import { findActiveDeck } from '../services/decks.js';

/**
 * How the learner chooses to study: a session's type, Quick, Standard or
 * Deep, Standard unless given, and its mode, Study, Drill Weakest or Cram,
 * Study unless given.
 */
const sessionChoiceInput = {
  sessionType: z.enum(['QUICK', 'STANDARD', 'DEEP']).default('STANDARD'),
  studyMode: z.enum(['STUDY', 'DRILL_WEAKEST', 'CRAM']).default('STUDY'),
};

export const studyRouter = router({
  queuePreview: protectedProcedure
    .input(z.object({ deckId: z.string(), ...sessionChoiceInput }))
    .query(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      return previewQueue(
        ctx.prisma,
        { userId: ctx.userId, deckId: input.deckId },
        input,
      );
    }),

  activeSession: protectedProcedure
    .input(z.object({ deckId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
      });
      if (!deck) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
      }

      return findResumableSession(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
    }),

  startSession: protectedProcedure
    .input(z.object({ deckId: z.string(), ...sessionChoiceInput }))
    .mutation(async ({ ctx, input }) => {
      await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });

      return startStudySession(
        ctx.prisma,
        { userId: ctx.userId, deckId: input.deckId },
        input,
      );
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

  abandonSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return abandonStudySession(ctx.prisma, {
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
