import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import {
  abandonStudySession,
  acceptAnswer,
  answerItem,
  finishStudySession,
  findResumableReview,
  findResumableSession,
  previewQueue,
  previewTodaysReview,
  startStudySession,
  startTodaysReview,
} from '../services/studySessions.js';
import {
  assertStudiesIn,
  findActiveDeck,
  findOwnedDeck,
} from '../services/decks.js';
import { studyDirection } from './inputs.js';

/**
 * How the learner chooses to study: a session's type, Quick, Standard or
 * Deep, Standard unless given, its mode, Study, Drill Weakest or Cram,
 * Study unless given, and its Study Direction, Forward unless given
 * (ADR-0011).
 */
const sessionChoiceInput = {
  sessionType: z.enum(['QUICK', 'STANDARD', 'DEEP']).default('STANDARD'),
  studyMode: z
    .enum(['STUDY', 'DRILL_WEAKEST', 'CRAM', 'REVIEW_RETIRED'])
    .default('STUDY'),
  direction: studyDirection,
};

/**
 * How the learner chooses to study Today's Review: its type, as for a
 * deck, and its mode, Study, Drill Weakest or Cram; Review retired is a
 * deck's alone, and each card's direction the pool's (ADR-0013).
 */
const reviewChoiceInput = {
  sessionType: sessionChoiceInput.sessionType,
  studyMode: z.enum(['STUDY', 'DRILL_WEAKEST', 'CRAM']).default('STUDY'),
};

export const studyRouter = router({
  /** What Today's Review started now would hold (#137). */
  reviewPreview: protectedProcedure
    .input(z.object(reviewChoiceInput))
    .query(({ ctx, input }) =>
      previewTodaysReview(ctx.prisma, { userId: ctx.userId }, input),
    ),

  /** The learner's unfinished Today's Review to resume, or null. */
  activeReview: protectedProcedure.query(({ ctx }) =>
    findResumableReview(ctx.prisma, { userId: ctx.userId }),
  ),

  /**
   * Starts Today's Review across the ticked decks, or resumes the
   * unfinished one; null when there's nothing to study.
   */
  startReview: protectedProcedure
    .input(z.object(reviewChoiceInput))
    .mutation(({ ctx, input }) =>
      startTodaysReview(ctx.prisma, { userId: ctx.userId }, input),
    ),

  queuePreview: protectedProcedure
    .input(z.object({ deckId: z.string(), ...sessionChoiceInput }))
    .query(async ({ ctx, input }) => {
      const deck = await findOwnedDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
      assertStudiesIn(deck, input.direction);

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
      const deck = await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
      assertStudiesIn(deck, input.direction);

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
