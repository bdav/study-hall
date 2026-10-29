import { TRPCError } from '@trpc/server';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { generateStreamed } from '../ai/generate.js';
import { parseLessonContent, parseLessonExamples } from '../ai/lesson.js';
import { courseSetupSchema } from '../ai/syllabus.js';
import {
  assembleTutorContext,
  buildTutorRequest,
  TUTOR_PROMPT_VERSION,
} from '../ai/tutor.js';

/**
 * A lesson in the user's course with its current version and that
 * version's Tutor Thread, oldest message first; throws NOT_FOUND for
 * anyone else's lesson.
 */
async function findOwnedLessonThread(
  prisma: PrismaClient,
  userId: string,
  lessonId: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, course: { userId } },
    include: {
      // The newest Lesson Version is the lesson's current one
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          tutorThread: {
            include: { messages: { orderBy: { createdAt: 'asc' } } },
          },
        },
      },
    },
  });

  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found' });
  }
  const [version] = lesson.versions;
  return { lesson, version, messages: version?.tutorThread?.messages ?? [] };
}

export const tutorRouter = router({
  /**
   * The Tutor Thread of the lesson's current version, oldest message
   * first; empty until the learner first asks. Reading it needs no AI.
   */
  thread: protectedProcedure
    .input(z.object({ lessonId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { messages } = await findOwnedLessonThread(
        ctx.prisma,
        ctx.userId,
        input.lessonId,
      );
      return {
        messages: messages.map(({ id, role, content, createdAt }) => ({
          id,
          role,
          content,
          createdAt,
        })),
      };
    }),

  /**
   * Asks the tutor about the lesson's current version. The reply streams
   * back in pieces; once it is complete, the message and the reply join
   * the version's Tutor Thread together.
   */
  ask: aiProcedure
    .input(
      z.object({
        lessonId: z.string(),
        message: z.string().trim().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lesson, version, messages } = await findOwnedLessonThread(
        ctx.prisma,
        ctx.userId,
        input.lessonId,
      );
      if (!version) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "This lesson hasn't been written yet.",
        });
      }

      const course = await ctx.prisma.course.findUniqueOrThrow({
        where: { id: lesson.courseId },
        include: { lessons: true },
      });
      const context = assembleTutorContext({
        setup: courseSetupSchema.parse(course),
        lessons: course.lessons,
        lessonId: lesson.id,
        version: {
          content: parseLessonContent(version.content),
          examples: parseLessonExamples(version.examples),
        },
        history: messages,
      });

      const askedAt = new Date();
      return generateStreamed(ctx, {
        userId: ctx.userId,
        purpose: 'TUTOR',
        chat: buildTutorRequest(context, input.message),
        onComplete: async ({ text, model }) => {
          const exchange = [
            {
              role: 'LEARNER' as const,
              content: input.message,
              createdAt: askedAt,
            },
            {
              role: 'TUTOR' as const,
              content: text,
              model,
              promptVersion: TUTOR_PROMPT_VERSION,
              createdAt: new Date(),
            },
          ];
          // Without nested writes the upsert is one statement, so two first
          // messages at once can't both create the thread
          const thread = await ctx.prisma.tutorThread.upsert({
            where: { lessonVersionId: version.id },
            create: { lessonVersionId: version.id },
            update: {},
          });
          await ctx.prisma.tutorMessage.createMany({
            data: exchange.map((message) => ({
              ...message,
              threadId: thread.id,
            })),
          });
        },
      });
    }),
});
