import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { continueTarget, lessonStatus } from '../services/syllabus.js';
import { countDueAndNewCards } from '../services/studySessions.js';
import { generateStructured } from '../ai/generate.js';
import { isChipChoice, MAX_FEEDBACK_LENGTH } from '../ai/feedback.js';
import {
  buildSyllabusPrompt,
  courseSetupSchema,
  OPPOSITE_SYLLABUS_CHIPS,
  parseFeedbackRounds,
  parseProposalLessons,
  proposalEditSchema,
  lessonTitleSchema,
  MAX_LESSONS,
  objectivesSchema,
  SYLLABUS_MODEL,
  SYLLABUS_PROMPT_VERSION,
  SYLLABUS_SYSTEM_PROMPT,
  syllabusFeedbackChipSchema,
  syllabusOutputSchema,
} from '../ai/syllabus.js';

const ACCEPTED_MESSAGE =
  'This syllabus has been accepted, so it is no longer a proposal';

const ARCHIVED_MESSAGE = 'Archived lessons and courses cannot be edited';

/**
 * Locks a course's row until the transaction ends, so changes to its
 * Syllabus that check it first, such as archiving all but one lesson or
 * placing a new lesson after the last, take turns. An update takes the
 * lock (and marks the course updated, as its Syllabus is), through Prisma
 * so it reaches the course's own schema.
 */
async function lockCourse(tx: Prisma.TransactionClient, courseId: string) {
  await tx.course.update({
    where: { id: courseId },
    data: { updatedAt: new Date() },
  });
}

/*
 * A lesson's position is its place in the Syllabus, a numbered slot.
 * Reordering shuffles the Syllabus's lessons among the slots they hold and
 * archiving keeps a lesson's slot, so a restored lesson can go back to it.
 */

/** Refuses a lesson joining a full Syllabus; run it holding the lock. */
async function assertRoomInSyllabus(
  tx: Prisma.TransactionClient,
  courseId: string,
) {
  const inSyllabus = await tx.lesson.count({
    where: { courseId, archivedAt: null },
  });
  if (inSyllabus >= MAX_LESSONS) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: `A syllabus holds at most ${MAX_LESSONS} lessons`,
    });
  }
}

/**
 * The slot after every lesson's, archived ones included, so a new slot
 * never takes an archived lesson's. Run it holding the course's lock.
 */
async function slotAfterLast(tx: Prisma.TransactionClient, courseId: string) {
  const { _max } = await tx.lesson.aggregate({
    where: { courseId },
    _max: { position: true },
  });
  return (_max.position ?? -1) + 1;
}

/** Refuses a change to a course archived meanwhile; run it holding the lock. */
async function assertCourseActive(
  tx: Prisma.TransactionClient,
  courseId: string,
) {
  const { archivedAt } = await tx.course.findUniqueOrThrow({
    where: { id: courseId },
    select: { archivedAt: true },
  });
  if (archivedAt) {
    throw new TRPCError({ code: 'CONFLICT', message: ARCHIVED_MESSAGE });
  }
}

/**
 * A lesson of the user's accepted Syllabus they can still edit: not
 * archived, in a course that isn't. Throws NOT_FOUND for anyone else's.
 */
async function findEditableLesson(
  prisma: PrismaClient,
  userId: string,
  lessonId: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, course: { userId } },
    include: { course: { select: { archivedAt: true } } },
  });

  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found' });
  }
  if (lesson.archivedAt || lesson.course.archivedAt) {
    throw new TRPCError({ code: 'CONFLICT', message: ARCHIVED_MESSAGE });
  }
  return lesson;
}

/**
 * A course of the user's whose accepted Syllabus they can still edit: not
 * archived. Throws NOT_FOUND for anyone else's.
 */
async function findEditableCourse(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
) {
  const course = await prisma.course.findUnique({
    where: { id: courseId, userId },
    include: { proposal: { select: { acceptedAt: true } } },
  });

  if (!course) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
  }
  if (course.archivedAt) {
    throw new TRPCError({ code: 'CONFLICT', message: ARCHIVED_MESSAGE });
  }
  if (!course.proposal?.acceptedAt) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Accept the syllabus proposal first',
    });
  }
  return course;
}

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

  /** The learner's archived courses, most recently archived first. */
  listArchived: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.course.findMany({
      where: { userId: ctx.userId, archivedAt: { not: null } },
      orderBy: { archivedAt: 'desc' },
      select: { id: true, title: true, archivedAt: true },
    }),
  ),

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
          feedback: parseFeedbackRounds(proposal.feedback),
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
   * Regenerates a Syllabus Proposal from the learner's feedback, chips and
   * words: the model gets the setup answers, every round of feedback so far
   * and the proposal as the learner left it, and its answer replaces the
   * proposal.
   */
  regenerateProposal: aiProcedure
    .input(
      z
        .object({
          courseId: z.string(),
          chips: z.array(syllabusFeedbackChipSchema).default([]),
          feedback: z.string().trim().max(MAX_FEEDBACK_LENGTH).optional(),
        })
        .refine((input) => input.chips.length > 0 || Boolean(input.feedback), {
          message: 'Choose what should change, or say it',
        })
        .refine(({ chips }) => isChipChoice(chips, OPPOSITE_SYLLABUS_CHIPS), {
          message: 'Choose each chip once, and one of each pair',
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

      const feedback = [
        ...parseFeedbackRounds(course.proposal.feedback),
        { chips: input.chips, text: input.feedback || null },
      ];
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

  /** Renames a lesson of an accepted Syllabus or edits its objectives. */
  updateLesson: protectedProcedure
    .input(
      z
        .object({
          lessonId: z.string(),
          title: lessonTitleSchema.optional(),
          objectives: objectivesSchema.optional(),
        })
        .refine(
          (input) =>
            input.title !== undefined || input.objectives !== undefined,
          { message: 'Give a title or objectives' },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await findEditableLesson(ctx.prisma, ctx.userId, input.lessonId);

      await ctx.prisma.lesson.update({
        where: { id: input.lessonId },
        data: { title: input.title, objectives: input.objectives },
      });

      return { success: true };
    }),

  /**
   * Puts an accepted Syllabus's lessons in the order given. Lessons it
   * leaves out, such as one added as the learner dragged, go at the end in
   * their order, and ones no longer in the Syllabus, such as one archived
   * meanwhile, are ignored. Archived lessons keep their places, out of it.
   */
  reorderLessons: protectedProcedure
    .input(z.object({ courseId: z.string(), lessonIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      if (new Set(input.lessonIds).size !== input.lessonIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Name each lesson once',
        });
      }
      await findEditableCourse(ctx.prisma, ctx.userId, input.courseId);

      await ctx.prisma.$transaction(async (tx) => {
        await lockCourse(tx, input.courseId);
        const lessons = await tx.lesson.findMany({
          where: { courseId: input.courseId, archivedAt: null },
          orderBy: { position: 'asc' },
          select: { id: true, position: true },
        });

        const inSyllabus = new Set(lessons.map((lesson) => lesson.id));
        const named = input.lessonIds.filter((id) => inSyllabus.has(id));
        const left = lessons
          .map((lesson) => lesson.id)
          .filter((id) => !named.includes(id));

        // The same slots, in the new order: archived lessons keep theirs
        const slots = lessons.map((lesson) => lesson.position);
        for (const [index, id] of [...named, ...left].entries()) {
          await tx.lesson.update({
            where: { id },
            data: { position: slots[index] },
          });
        }
      });

      return { success: true };
    }),

  /** Adds a lesson by its title alone to the end of an accepted Syllabus. */
  addLesson: protectedProcedure
    .input(z.object({ courseId: z.string(), title: lessonTitleSchema }))
    .mutation(async ({ ctx, input }) => {
      await findEditableCourse(ctx.prisma, ctx.userId, input.courseId);

      const lesson = await ctx.prisma.$transaction(async (tx) => {
        await lockCourse(tx, input.courseId);
        await assertCourseActive(tx, input.courseId);
        await assertRoomInSyllabus(tx, input.courseId);
        return tx.lesson.create({
          data: {
            courseId: input.courseId,
            title: input.title,
            objectives: [],
            position: await slotAfterLast(tx, input.courseId),
          },
        });
      });

      return { id: lesson.id };
    }),

  /**
   * Archives a lesson: it leaves the Syllabus and navigation, while its
   * versions, attempts, tutor threads and cards stay (ADR-0003). A Syllabus
   * keeps at least one lesson; archiving the course is for the rest.
   */
  archiveLesson: protectedProcedure
    .input(z.object({ lessonId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const lesson = await findEditableLesson(
        ctx.prisma,
        ctx.userId,
        input.lessonId,
      );

      await ctx.prisma.$transaction(async (tx) => {
        await lockCourse(tx, lesson.courseId);
        await assertCourseActive(tx, lesson.courseId);
        const inSyllabus = await tx.lesson.count({
          where: { courseId: lesson.courseId, archivedAt: null },
        });
        if (inSyllabus <= 1) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'A syllabus keeps at least one lesson. Archive the course instead.',
          });
        }

        // Only if still in the Syllabus: two archives of it count once
        await tx.lesson.updateMany({
          where: { id: lesson.id, archivedAt: null },
          data: { archivedAt: new Date() },
        });
      });

      return { success: true };
    }),

  /** A course's archived lessons, most recently archived first. */
  listArchivedLessons: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const course = await ctx.prisma.course.findUnique({
        where: { id: input.courseId, userId: ctx.userId },
        select: { id: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }

      return ctx.prisma.lesson.findMany({
        where: { courseId: course.id, archivedAt: { not: null } },
        orderBy: { archivedAt: 'desc' },
        select: { id: true, title: true, archivedAt: true },
      });
    }),

  /**
   * Restores an archived lesson to its place in the Syllabus, the slot it
   * kept, with everything it had: its versions, Lesson Completion,
   * attempts, tutor threads and cards (ADR-0003). Within the Syllabus's
   * limit of lessons.
   */
  restoreLesson: protectedProcedure
    .input(z.object({ lessonId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const lesson = await ctx.prisma.lesson.findFirst({
        where: { id: input.lessonId, course: { userId: ctx.userId } },
      });

      if (!lesson) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found' });
      }

      await ctx.prisma.$transaction(async (tx) => {
        await lockCourse(tx, lesson.courseId);
        // Checked under the lock, so an archive of the course meanwhile wins
        await assertCourseActive(tx, lesson.courseId);
        const current = await tx.lesson.findUniqueOrThrow({
          where: { id: lesson.id },
          select: { archivedAt: true },
        });
        if (!current.archivedAt) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This lesson is not archived',
          });
        }

        await assertRoomInSyllabus(tx, lesson.courseId);
        // Back in its own slot, unless a reorder from before slots were kept
        // gave it to another lesson: then at the end
        const taken = await tx.lesson.count({
          where: {
            courseId: lesson.courseId,
            archivedAt: null,
            position: lesson.position,
          },
        });
        await tx.lesson.update({
          where: { id: lesson.id },
          data: {
            archivedAt: null,
            position:
              taken > 0
                ? await slotAfterLast(tx, lesson.courseId)
                : lesson.position,
          },
        });
      });

      return { success: true };
    }),

  /**
   * Archives a course: it leaves Courses, while its lessons, learning
   * history and Course Deck stay (ADR-0003); the deck stays in Flashcards.
   * A course still at its proposal has no history, and is discarded instead.
   */
  archive: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await findEditableCourse(ctx.prisma, ctx.userId, input.courseId);

      await ctx.prisma.course.update({
        where: { id: input.courseId },
        data: { archivedAt: new Date() },
      });

      return { success: true };
    }),

  /**
   * Restores an archived course: it's back in Courses as it was, its
   * Syllabus editable again. Lessons archived on their own stay archived.
   */
  restore: protectedProcedure
    .input(z.object({ courseId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const course = await ctx.prisma.course.findUnique({
        where: { id: input.courseId, userId: ctx.userId },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found' });
      }

      const restored = await ctx.prisma.course.updateMany({
        where: { id: course.id, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (restored.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This course is not archived',
        });
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
