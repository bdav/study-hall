import { TRPCError } from '@trpc/server';
import { type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { generateStreamed } from '../ai/generate.js';
import { parseLessonContent, parseLessonExamples } from '../ai/lesson.js';
import { courseSetupSchema } from '../ai/syllabus.js';
import { attemptsSinceReset } from '../services/exercises.js';
import { startTutorThread, threadToAskIn } from '../services/tutorThreads.js';
import {
  assembleTutorContext,
  buildTutorRequest,
  TUTOR_PROMPT_VERSION,
} from '../ai/tutor.js';

/**
 * A lesson in the user's course with its current version, that version's
 * Tutor Threads, the current one first, and one thread's messages, oldest
 * first: the current thread's, or those of the thread asked for, which must
 * be one of the version's. Earlier threads with no messages, left by
 * starting afresh before asking anything, are left out. Throws NOT_FOUND
 * for anyone else's lesson.
 */
async function findOwnedLessonThread(
  prisma: PrismaClient,
  userId: string,
  lessonId: string,
  threadId?: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, course: { userId } },
    include: {
      // The newest Lesson Version is the lesson's current one
      versions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          // The highest-numbered thread is the version's current one
          tutorThreads: {
            orderBy: { number: 'desc' },
            select: {
              id: true,
              number: true,
              _count: { select: { messages: true } },
            },
          },
        },
      },
    },
  });

  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found' });
  }
  const [version] = lesson.versions;
  const threads = (version?.tutorThreads ?? [])
    .filter((thread, index) => index === 0 || thread._count.messages > 0)
    .map(({ id, number }, index) => ({ id, number, isCurrent: index === 0 }));
  const thread = threadId
    ? threads.find((candidate) => candidate.id === threadId)
    : threads[0];
  if (threadId && !thread) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
  }
  const messages = thread
    ? await prisma.tutorMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
      })
    : [];
  return { lesson, version, threads, thread, messages };
}

export const tutorRouter = router({
  /**
   * The Tutor Threads of the lesson's current version, the current one
   * first, and the messages of one, oldest first: the current thread's, or
   * an earlier one's to read back. Empty until the learner first asks.
   * Reading needs no AI.
   */
  thread: protectedProcedure
    .input(z.object({ lessonId: z.string(), threadId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { threads, messages } = await findOwnedLessonThread(
        ctx.prisma,
        ctx.userId,
        input.lessonId,
        input.threadId,
      );
      return {
        threads,
        messages: messages.map(({ id, role, content, createdAt }) => ({
          id,
          role,
          content,
          createdAt,
        })),
      };
    }),

  /**
   * Starts a fresh Tutor Thread on the lesson's current version, for when
   * the current one has grown long or gone off track. The tutor sees only
   * the new thread from then on; the earlier ones are kept. Needs no AI.
   */
  startThread: protectedProcedure
    .input(z.object({ lessonId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { version } = await findOwnedLessonThread(
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
      return startTutorThread(ctx.prisma, version.id);
    }),

  /**
   * Asks the tutor about the lesson's current version, and the exercise the
   * learner is on, if any: the tutor sees their attempts, and an
   * exercise's answers only once they have attempted it. The reply streams
   * back in pieces; once it is complete, the message and the reply join
   * the version's Tutor Thread together.
   */
  ask: aiProcedure
    .input(
      z.object({
        lessonId: z.string(),
        message: z.string().trim().min(1).max(4000),
        // The exercise on the learner's screen, if any
        exerciseId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lesson, version, thread, messages } = await findOwnedLessonThread(
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
      // Its attempts since any Start over, as the lesson page shows them
      const exercises = await ctx.prisma.exercise.findMany({
        where: { lessonVersionId: version.id },
        include: { attempts: { where: attemptsSinceReset(lesson.resetAt) } },
      });
      const context = assembleTutorContext({
        setup: courseSetupSchema.parse(course),
        lessons: course.lessons,
        lessonId: lesson.id,
        version: {
          content: parseLessonContent(version.content),
          examples: parseLessonExamples(version.examples),
        },
        exercises,
        currentExerciseId: input.exerciseId ?? null,
        history: messages,
      });

      // The exchange joins the thread it was asked in, even if the learner
      // starts another, or the lesson over, while the reply is under way
      const threadId = await threadToAskIn(ctx.prisma, version.id, thread);
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
          await ctx.prisma.tutorMessage.createMany({
            data: exchange.map((message) => ({ ...message, threadId })),
          });
        },
      });
    }),
});
