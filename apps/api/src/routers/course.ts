import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { continueTarget, lessonStatus } from '../services/syllabus.js';
import { countDueAndNewCards } from '../services/studySessions.js';
import { generateStructured } from '../ai/generate.js';
import {
  buildSyllabusPrompt,
  courseSetupSchema,
  parseProposalLessons,
  proposalEditSchema,
  SYLLABUS_MODEL,
  SYLLABUS_PROMPT_VERSION,
  SYLLABUS_SYSTEM_PROMPT,
  syllabusOutputSchema,
} from '../ai/syllabus.js';

/** The longest feedback a regeneration takes. */
const MAX_FEEDBACK_LENGTH = 1000;

const ACCEPTED_MESSAGE =
  'This syllabus has been accepted, so it is no longer a proposal';

export const courseRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const courses = await ctx.prisma.course.findMany({
      where: { userId: ctx.userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        proposal: { select: { acceptedAt: true } },
        _count: { select: { lessons: { where: { archivedAt: null } } } },
      },
    });

    return courses.map((course) => ({
      id: course.id,
      title: course.title,
      goal: course.goal,
      createdAt: course.createdAt,
      lessonCount: course._count.lessons,
      syllabusAccepted: Boolean(course.proposal?.acceptedAt),
    }));
  }),

  create: aiProcedure
    .input(courseSetupSchema)
    .mutation(async ({ ctx, input }) => {
      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'SYLLABUS_GENERATION',
        model: SYLLABUS_MODEL,
        promptVersion: SYLLABUS_PROMPT_VERSION,
        system: SYLLABUS_SYSTEM_PROMPT,
        prompt: buildSyllabusPrompt(input),
        outputSchema: syllabusOutputSchema,
      });

      const course = await ctx.prisma.course.create({
        data: {
          ...input,
          userId: ctx.userId,
          title: input.topic,
          proposal: {
            create: { lessons: output.lessons, model, promptVersion },
          },
        },
      });

      return { id: course.id };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.prisma.course.findUnique({
        where: { id: input.id, userId: ctx.userId },
        include: {
          deck: { select: { id: true } },
          proposal: true,
          lessons: {
            where: { archivedAt: null },
            orderBy: { position: 'asc' },
          },
        },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }

      const { deck, proposal, lessons, ...rest } = course;
      return {
        ...rest,
        continueLesson: continueTarget(lessons),
        lessons: lessons.map((lesson) => ({
          ...lesson,
          status: lessonStatus(lesson),
        })),
        deckId: deck?.id ?? null,
        // The course page's review section: its Course Deck's due and NEW
        // cards
        review: deck
          ? {
              deckId: deck.id,
              ...(await countDueAndNewCards(ctx.prisma, {
                userId: ctx.userId,
                deckId: deck.id,
              })),
            }
          : null,
        proposal: proposal && {
          ...proposal,
          lessons: parseProposalLessons(proposal.lessons),
        },
      };
    }),

  acceptProposal: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await ctx.prisma.syllabusProposal.findFirst({
        where: { courseId: input.courseId, course: { userId: ctx.userId } },
        include: { course: { select: { title: true } } },
      });

      if (!proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }

      await ctx.prisma.$transaction(async (tx) => {
        // Claim the proposal first so a concurrent accept can't double it
        const claimed = await tx.syllabusProposal.updateMany({
          where: { id: proposal.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        });

        if (claimed.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This syllabus proposal has already been accepted',
          });
        }

        // Read after claiming, so an edit saved meanwhile is in: the claim
        // holds off any edit from here on
        const lessons = parseProposalLessons(
          (
            await tx.syllabusProposal.findUniqueOrThrow({
              where: { id: proposal.id },
            })
          ).lessons,
        );

        await tx.lesson.createMany({
          data: lessons.map((lesson, position) => ({
            courseId: input.courseId,
            title: lesson.title,
            objectives: lesson.objectives,
            position,
          })),
        });

        // The Course Deck exists only once the course has a Syllabus
        await tx.deck.create({
          data: {
            userId: ctx.userId,
            courseId: input.courseId,
            name: proposal.course.title,
          },
        });
      });

      return { success: true };
    }),

  /**
   * Saves the learner's edits to a Syllabus Proposal: its lessons in full,
   * in order, as the learner left them.
   */
  updateProposal: protectedProcedure
    .input(
      z.object({
        courseId: z.string(),
        lessons: proposalEditSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.prisma.course.findUnique({
        where: { id: input.courseId, userId: ctx.userId },
        include: { proposal: { select: { id: true } } },
      });

      if (!course?.proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }

      // Only while unaccepted: an accept in between wins
      const updated = await ctx.prisma.syllabusProposal.updateMany({
        where: { id: course.proposal.id, acceptedAt: null },
        data: { lessons: input.lessons },
      });

      if (updated.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: ACCEPTED_MESSAGE,
        });
      }

      return { success: true };
    }),

  /**
   * Regenerates a Syllabus Proposal from the learner's feedback: the model
   * gets the setup answers, every piece of feedback so far and the proposal
   * as the learner left it, and its answer replaces the proposal.
   */
  regenerateProposal: aiProcedure
    .input(
      z.object({
        courseId: z.string(),
        feedback: z.string().trim().min(1).max(MAX_FEEDBACK_LENGTH),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.prisma.course.findUnique({
        where: { id: input.courseId, userId: ctx.userId },
        include: { proposal: true },
      });

      if (!course?.proposal) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }
      if (course.proposal.acceptedAt) {
        throw new TRPCError({ code: 'CONFLICT', message: ACCEPTED_MESSAGE });
      }

      const feedback = [...course.proposal.feedback, input.feedback];
      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'SYLLABUS_GENERATION',
        model: SYLLABUS_MODEL,
        promptVersion: SYLLABUS_PROMPT_VERSION,
        system: SYLLABUS_SYSTEM_PROMPT,
        prompt: buildSyllabusPrompt(courseSetupSchema.parse(course), {
          feedback,
          lessons: parseProposalLessons(course.proposal.lessons),
        }),
        outputSchema: syllabusOutputSchema,
      });

      // Only while unaccepted: an accept during the call wins
      const updated = await ctx.prisma.syllabusProposal.updateMany({
        where: { id: course.proposal.id, acceptedAt: null },
        data: { lessons: output.lessons, feedback, model, promptVersion },
      });

      if (updated.count === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: ACCEPTED_MESSAGE });
      }

      return { success: true };
    }),

  /**
   * Deletes a course that never got past its Syllabus Proposal. Before
   * acceptance there is no learning history, so nothing needs archiving.
   */
  discardProposal: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.prisma.course.findUnique({
        where: { id: input.courseId, userId: ctx.userId },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }

      await ctx.prisma.$transaction(async (tx) => {
        // Claim the unaccepted proposal first so a concurrent accept can't win
        const claimed = await tx.syllabusProposal.deleteMany({
          where: { courseId: course.id, acceptedAt: null },
        });

        if (claimed.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'An accepted syllabus cannot be discarded',
          });
        }

        await tx.course.delete({ where: { id: course.id } });
      });

      return { success: true };
    }),
});
