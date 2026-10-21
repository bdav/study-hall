import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import { gradeAnswer } from '../services/answerGrader.js';
import { primaryAnswerText, withCanonicalAnswers } from '../services/cards.js';

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

      // The MVP study flow runs through every card in the deck; session
      // types and modes come with the v2 session builder.
      return ctx.prisma.studySession.create({
        data: {
          userId: ctx.userId,
          deckId: input.deckId,
          sessionType: 'STANDARD',
        },
      });
    }),

  submitAttempt: protectedProcedure
    .input(
      z.object({
        studySessionId: z.string(),
        cardId: z.string(),
        userAnswer: z.string().min(1, 'Answer cannot be empty'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.studySession.findUnique({
        where: { id: input.studySessionId },
      });

      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Study session not found',
        });
      }

      if (session.status !== 'ACTIVE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Session already finished',
        });
      }

      const card = await ctx.prisma.card.findUnique({
        where: { id: input.cardId },
        include: withCanonicalAnswers,
      });

      if (!card) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Card not found',
        });
      }

      if (card.deckId !== session.deckId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Card does not belong to this session's deck",
        });
      }

      const recallGrade = gradeAnswer(
        input.userAnswer,
        primaryAnswerText(card),
      );

      // Wrap count + create in a transaction to prevent race conditions on attemptNumber
      return ctx.prisma.$transaction(async (tx) => {
        const previousAttempts = await tx.cardAttempt.count({
          where: {
            studySessionId: input.studySessionId,
            cardId: input.cardId,
          },
        });

        return tx.cardAttempt.create({
          data: {
            studySessionId: input.studySessionId,
            cardId: input.cardId,
            userAnswer: input.userAnswer,
            recallGrade,
            attemptNumber: previousAttempts + 1,
            isRetry: previousAttempts > 0,
          },
        });
      });
    }),

  finishSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.studySession.findUnique({
        where: { id: input.id },
      });

      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Study session not found',
        });
      }

      if (session.status !== 'ACTIVE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Session already finished',
        });
      }

      return ctx.prisma.studySession.update({
        where: { id: input.id },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
    }),

  getSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.studySession.findUnique({
        where: { id: input.id },
        include: { attempts: { orderBy: { createdAt: 'asc' } } },
      });

      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Study session not found',
        });
      }

      return session;
    }),
});
