import { TRPCError } from '@trpc/server';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import {
  evaluateExerciseAnswer,
  toAttemptView,
} from '../services/exercises.js';

async function findOwnedExercise(
  prisma: PrismaClient,
  userId: string,
  id: string,
) {
  const exercise = await prisma.exercise.findFirst({
    where: { id, lessonVersion: { lesson: { course: { userId } } } },
  });

  if (!exercise) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Exercise not found' });
  }
  return exercise;
}

export const exerciseRouter = router({
  /**
   * Checks an answer to an exercise and stores it as an Exercise Attempt on
   * the exercise's Lesson Version. Checks are deterministic, so they make
   * no model call and need no AI access.
   */
  submitAttempt: protectedProcedure
    .input(
      z.object({ exerciseId: z.string(), answer: z.string().trim().min(1) }),
    )
    .mutation(async ({ ctx, input }) => {
      const exercise = await findOwnedExercise(
        ctx.prisma,
        ctx.userId,
        input.exerciseId,
      );

      // Free-form explanations need AI evaluation (#22)
      if (exercise.type === 'FREE_FORM_EXPLANATION') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Free-form explanations can't be answered yet.",
        });
      }

      const attempt = await ctx.prisma.exerciseAttempt.create({
        data: {
          lessonVersionId: exercise.lessonVersionId,
          exerciseId: exercise.id,
          answer: input.answer,
          ...evaluateExerciseAnswer(input.answer, exercise.expectedAnswers),
          method: 'DETERMINISTIC',
        },
      });

      return toAttemptView(attempt);
    }),

  /**
   * An exercise's expected answers, which the learner can reveal once they
   * have tried it: never before (courses-plan.md, Tutor).
   */
  answers: protectedProcedure
    .input(z.object({ exerciseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const exercise = await findOwnedExercise(
        ctx.prisma,
        ctx.userId,
        input.exerciseId,
      );

      const attempted = await ctx.prisma.exerciseAttempt.count({
        where: { exerciseId: exercise.id },
      });
      if (attempted === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Try the exercise before revealing its answers.',
        });
      }

      return { expectedAnswers: exercise.expectedAnswers };
    }),
});
