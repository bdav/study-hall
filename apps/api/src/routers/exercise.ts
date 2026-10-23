import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import {
  evaluateExerciseAnswer,
  toAttemptView,
} from '../services/exercises.js';

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
      const exercise = await ctx.prisma.exercise.findFirst({
        where: {
          id: input.exerciseId,
          lessonVersion: { lesson: { course: { userId: ctx.userId } } },
        },
      });

      if (!exercise) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Exercise not found',
        });
      }

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
          evaluation: evaluateExerciseAnswer(
            input.answer,
            exercise.expectedAnswers,
          ),
          method: 'DETERMINISTIC',
        },
      });

      return toAttemptView(attempt);
    }),
});
