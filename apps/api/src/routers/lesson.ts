import { TRPCError } from '@trpc/server';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { generateStructured } from '../ai/generate.js';
import {
  assembleLessonContext,
  buildLessonPrompt,
  exerciseExpectations,
  LESSON_MODEL,
  LESSON_PROMPT_VERSION,
  LESSON_SYSTEM_PROMPT,
  lessonOutputSchema,
  parseLessonContent,
  parseLessonExamples,
} from '../ai/lesson.js';
import { courseSetupSchema } from '../ai/syllabus.js';
import { toAttemptView } from '../services/exercises.js';

/**
 * How long a generation claim holds. Longer than the Anthropic client's
 * request timeout, so only a claim whose request died with the server goes
 * stale and can be taken over.
 */
const GENERATION_CLAIM_MS = 15 * 60 * 1000;

/** Claims made before this time have gone stale. */
function staleClaimsBefore(now: Date): Date {
  return new Date(now.getTime() - GENERATION_CLAIM_MS);
}

/** The newest Lesson Version is the lesson's current one. */
const currentVersion = {
  orderBy: { createdAt: 'desc' },
  take: 1,
} satisfies Prisma.Lesson$versionsArgs;

async function findOwnedLesson(
  prisma: PrismaClient,
  userId: string,
  id: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id, course: { userId } },
    include: {
      course: { select: { id: true, title: true } },
      versions: {
        ...currentVersion,
        include: {
          exercises: {
            orderBy: { position: 'asc' },
            include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } },
          },
        },
      },
    },
  });

  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found' });
  }
  return lesson;
}

/**
 * A lesson as the learner sees it. Exercises leave out their expected
 * answers and points, which the learner must not see before attempting.
 */
function toLessonView(lesson: Awaited<ReturnType<typeof findOwnedLesson>>) {
  const [version] = lesson.versions;
  const { generationClaimedAt } = lesson;
  return {
    id: lesson.id,
    title: lesson.title,
    objectives: lesson.objectives,
    firstOpenedAt: lesson.firstOpenedAt,
    course: lesson.course,
    // Another open is writing the lesson; the page waits for it to finish
    generating:
      !version &&
      generationClaimedAt !== null &&
      generationClaimedAt >= staleClaimsBefore(new Date()),
    version: version
      ? {
          id: version.id,
          content: parseLessonContent(version.content),
          examples: parseLessonExamples(version.examples),
          exercises: version.exercises.map(
            ({ id, type, prompt, attempts: [latest] }) => ({
              id,
              type,
              prompt,
              latestAttempt: latest ? toAttemptView(latest) : null,
            }),
          ),
        }
      : null,
  };
}

export const lessonRouter = router({
  /** Opens a lesson: its current version, or null before it is generated. */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) =>
      toLessonView(await findOwnedLesson(ctx.prisma, ctx.userId, input.id)),
    ),

  /**
   * Generates the lesson's first version on first open, and records the
   * first-opened time. A lesson that already has a version is returned as
   * it is, without a model call.
   */
  generate: aiProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const lesson = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);
      if (lesson.versions.length > 0) return toLessonView(lesson);

      if (lesson.archivedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "An archived lesson can't be written.",
        });
      }

      // Claim the lesson first so a concurrent open can't pay for a second
      // generation
      const now = new Date();
      const claimed = await ctx.prisma.lesson.updateMany({
        where: {
          id: lesson.id,
          versions: { none: {} },
          OR: [
            { generationClaimedAt: null },
            {
              generationClaimedAt: { lt: staleClaimsBefore(now) },
            },
          ],
        },
        data: { generationClaimedAt: now },
      });

      if (claimed.count === 0) {
        const latest = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);
        if (latest.versions.length > 0) return toLessonView(latest);
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'This lesson is already being written. Try again in a moment.',
        });
      }

      try {
        const course = await ctx.prisma.course.findUniqueOrThrow({
          where: { id: lesson.courseId },
          include: {
            lessons: {
              include: {
                versions: { ...currentVersion, select: { summary: true } },
              },
            },
          },
        });

        const context = assembleLessonContext({
          setup: courseSetupSchema.parse(course),
          lessons: course.lessons.map(({ versions, ...syllabusLesson }) => ({
            ...syllabusLesson,
            summary: versions[0]?.summary ?? null,
          })),
          lessonId: lesson.id,
        });

        const { output, model, promptVersion } = await generateStructured(ctx, {
          userId: ctx.userId,
          purpose: 'LESSON_GENERATION',
          model: LESSON_MODEL,
          promptVersion: LESSON_PROMPT_VERSION,
          system: LESSON_SYSTEM_PROMPT,
          prompt: buildLessonPrompt(context),
          outputSchema: lessonOutputSchema,
        });

        await ctx.prisma.$transaction([
          ctx.prisma.lessonVersion.create({
            data: {
              lessonId: lesson.id,
              content: output.content,
              examples: output.examples,
              summary: output.summary,
              model,
              promptVersion,
              exercises: {
                create: output.exercises.map((exercise, position) => ({
                  position,
                  type: exercise.type,
                  prompt: exercise.prompt,
                  ...exerciseExpectations(exercise),
                })),
              },
            },
          }),
          ctx.prisma.lesson.update({
            where: { id: lesson.id },
            data: {
              firstOpenedAt: lesson.firstOpenedAt ?? new Date(),
              generationClaimedAt: null,
            },
          }),
        ]);
      } catch (error) {
        // Release the claim so the learner can retry straight away
        await ctx.prisma.lesson.update({
          where: { id: lesson.id },
          data: { generationClaimedAt: null },
        });
        throw error;
      }

      return toLessonView(
        await findOwnedLesson(ctx.prisma, ctx.userId, input.id),
      );
    }),
});
