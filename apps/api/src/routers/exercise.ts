import { TRPCError } from '@trpc/server';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  assertAiNotPaused,
  assertCanUseAI,
  protectedProcedure,
  router,
} from './trpc.js';
import { generateStructured } from '../ai/generate.js';
import {
  buildEvaluationPrompt,
  EXERCISE_EVALUATION_MODEL,
  EXERCISE_EVALUATION_PROMPT_VERSION,
  EXERCISE_EVALUATION_SYSTEM_PROMPT,
  exerciseEvaluationSchema,
} from '../ai/exerciseEvaluation.js';
import {
  checkDeterministically,
  toAttemptView,
} from '../services/exercises.js';

/**
 * The longest answer accepted. Far more than any exercise needs, and it
 * bounds what one AI evaluation can cost against the shared cap.
 */
const MAX_ANSWER_LENGTH = 2000;

const AI_EVALUATION_DENIED_MESSAGE =
  "Checking this answer needs AI, and your account doesn't have access to AI features.";

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
   * the exercise's Lesson Version. The deterministic check comes first and
   * needs no AI access; only an answer it can't settle, to an open exercise,
   * goes to the model (ADR-0005), behind `canUseAI` and the spending cap.
   */
  submitAttempt: protectedProcedure
    .input(
      z.object({
        exerciseId: z.string(),
        answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const exercise = await findOwnedExercise(
        ctx.prisma,
        ctx.userId,
        input.exerciseId,
      );

      const deterministic = checkDeterministically(exercise, input.answer);
      let evaluated;
      if (deterministic) {
        evaluated = { ...deterministic, method: 'DETERMINISTIC' as const };
      } else {
        await assertCanUseAI(
          ctx.prisma,
          ctx.userId,
          AI_EVALUATION_DENIED_MESSAGE,
        );
        await assertAiNotPaused(ctx.prisma);
        const { output } = await generateStructured(ctx, {
          userId: ctx.userId,
          purpose: 'EXERCISE_EVALUATION',
          model: EXERCISE_EVALUATION_MODEL,
          promptVersion: EXERCISE_EVALUATION_PROMPT_VERSION,
          system: EXERCISE_EVALUATION_SYSTEM_PROMPT,
          prompt: buildEvaluationPrompt(exercise, input.answer),
          outputSchema: exerciseEvaluationSchema,
          maxTokens: 1000,
        });
        evaluated = { ...output, method: 'LLM' as const };
      }

      const attempt = await ctx.prisma.exerciseAttempt.create({
        data: {
          lessonVersionId: exercise.lessonVersionId,
          exerciseId: exercise.id,
          answer: input.answer,
          ...evaluated,
        },
      });

      return toAttemptView(attempt);
    }),

  /**
   * An exercise's expected answers, or a free-form explanation's expected
   * points, which the learner can reveal once they have tried it: never
   * before (courses-plan.md, Tutor).
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

      return {
        expectedAnswers: exercise.expectedAnswers,
        expectedPoints: exercise.expectedPoints,
      };
    }),
});
