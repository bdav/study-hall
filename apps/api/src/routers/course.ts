import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { continueTarget, lessonStatus } from '../services/syllabus.js';
import { pacing } from '../services/pacing.js';
import {
  buildSyllabusRevisionPrompt,
  isFixed,
  OPPOSITE_REVISION_CHIPS,
  revisionRoundSchema,
  type RevisionLesson,
  SYLLABUS_REVISION_MODEL,
  SYLLABUS_REVISION_PROMPT_VERSION,
  SYLLABUS_REVISION_SYSTEM_PROMPT,
  syllabusRevisionChipSchema,
  syllabusRevisionOutputSchema,
  toProposedRevision,
} from '../ai/syllabusRevision.js';
import { countDueAndNewCards } from '../services/studySessions.js';
import { generateStructured } from '../ai/generate.js';
import { isChipChoice, MAX_FEEDBACK_LENGTH } from '../ai/feedback.js';
import {
  buildSyllabusPrompt,
  courseSetupSchema,
  newCourseSetupSchema,
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
import {
  buildInterviewPrompt,
  INTERVIEW_MODEL,
  INTERVIEW_PROMPT_VERSION,
  INTERVIEW_SYSTEM_PROMPT,
  interviewOutputSchema,
  interviewSchema,
  formDraft,
  MAX_INTERVIEW_ROUNDS,
  transcriptSchema,
  withSuggestionOffered,
} from '../ai/courseInterview.js';

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

  /**
   * One round of a Setup Interview: from the learner's opening words and
   * every earlier round, the model drafts the Course Setup and asks the next
   * round, or says nothing important is left to ask. The page holds the
   * interview, so the server keeps none of it.
   */
  interviewRound: aiProcedure
    .input(interviewSchema)
    .mutation(async ({ ctx, input }) => {
      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'COURSE_INTERVIEW',
        model: INTERVIEW_MODEL,
        promptVersion: INTERVIEW_PROMPT_VERSION,
        system: INTERVIEW_SYSTEM_PROMPT,
        prompt: buildInterviewPrompt(input, new Date()),
        outputSchema: interviewOutputSchema,
      });

      // No more than three rounds, whatever the model returns
      const ready =
        output.ready ||
        output.questions.length === 0 ||
        input.rounds.length >= MAX_INTERVIEW_ROUNDS;
      return {
        draft: formDraft(output.draft, input.rounds),
        ready,
        questions: ready ? [] : output.questions.map(withSuggestionOffered),
        // For the transcript course creation keeps
        model,
        promptVersion,
      };
    }),

  /**
   * Creates a course and its Syllabus Proposal from the confirmed Course
   * Setup. The Setup Interview that drafted it, if any, is kept for tuning
   * the interview; generation reads only the Course Setup.
   */
  create: aiProcedure
    .input(
      z.intersection(
        newCourseSetupSchema,
        z.object({ interview: transcriptSchema.optional() }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const { interview, ...setup } = input;
      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'SYLLABUS_GENERATION',
        model: SYLLABUS_MODEL,
        promptVersion: SYLLABUS_PROMPT_VERSION,
        system: SYLLABUS_SYSTEM_PROMPT,
        prompt: buildSyllabusPrompt(setup),
        outputSchema: syllabusOutputSchema,
      });

      const course = await ctx.prisma.course.create({
        data: {
          ...setup,
          interview,
          userId: ctx.userId,
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
          deck: { select: { id: true, archivedAt: true } },
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
      const proposedLessons = proposal
        ? parseProposalLessons(proposal.lessons)
        : [];
      return {
        ...rest,
        continueLesson: continueTarget(lessons),
        lessons: lessons.map((lesson) => ({
          ...lesson,
          status: lessonStatus(lesson),
        })),
        deckId: deck?.id ?? null,
        // The course page's review section: its Course Deck's due and NEW
        // cards, while the deck isn't archived
        review:
          deck && !deck.archivedAt
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
          lessons: proposedLessons,
          feedback: parseFeedbackRounds(proposal.feedback),
        },
        // How a proposal, as the learner has left it, fits their time; an
        // accepted Syllabus has none
        pacing:
          proposal && !proposal.acceptedAt
            ? pacing(proposedLessons.length, course, new Date())
            : null,
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

      // So the proposal shows how it now fits at once
      return { pacing: pacing(input.lessons.length, course, new Date()) };
    }),

  /**
   * Regenerates a Syllabus Proposal from the learner's feedback, chips and
   * words: the model gets the Course Setup, every round of feedback so far
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

  /**
   * Proposes changes to the lessons of an accepted Syllabus the learner
   * hasn't started, from their chips and words, for them to review: edits,
   * archives, new lessons and a new order. Opened and complete lessons are
   * fixed. When refining, every earlier round and the proposal as the
   * learner left it come too, and the whole revision is proposed again.
   * Nothing changes until the learner applies it (`applySyllabusRevision`).
   */
  proposeSyllabusRevision: aiProcedure
    .input(
      z
        .object({
          courseId: z.string(),
          chips: z.array(syllabusRevisionChipSchema),
          feedback: z.string().trim().max(MAX_FEEDBACK_LENGTH).optional(),
          refining: z
            .object({
              rounds: z.array(revisionRoundSchema).max(50),
              proposal: z.object({
                edits: z
                  .array(
                    z.object({
                      lessonId: z.string(),
                      title: lessonTitleSchema,
                      objectives: objectivesSchema,
                      included: z.boolean(),
                    }),
                  )
                  .max(MAX_LESSONS),
                archives: z
                  .array(
                    z.object({ lessonId: z.string(), included: z.boolean() }),
                  )
                  .max(MAX_LESSONS),
                additions: z
                  .array(
                    z.object({
                      title: lessonTitleSchema,
                      objectives: objectivesSchema,
                      afterLessonId: z.string().nullable(),
                      included: z.boolean(),
                    }),
                  )
                  .max(MAX_LESSONS),
                order: z
                  .object({
                    lessonIds: z.array(z.string()).max(MAX_LESSONS),
                    included: z.boolean(),
                  })
                  .nullable(),
              }),
            })
            .optional(),
        })
        .refine((input) => input.chips.length > 0 || Boolean(input.feedback), {
          message: 'Choose what should change, or say it in your own words',
        })
        .refine((input) => isChipChoice(input.chips, OPPOSITE_REVISION_CHIPS), {
          message: 'Choose each chip once, and one of each opposite pair',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await findEditableCourse(
        ctx.prisma,
        ctx.userId,
        input.courseId,
      );
      const syllabus = await ctx.prisma.lesson.findMany({
        where: { courseId: course.id, archivedAt: null },
        orderBy: { position: 'asc' },
        include: {
          versions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { summary: true },
          },
        },
      });
      const lessons: RevisionLesson[] = syllabus.map((lesson) => {
        const status = lessonStatus(lesson);
        return {
          id: lesson.id,
          title: lesson.title,
          objectives: lesson.objectives,
          status,
          summary:
            status === 'NOT_STARTED'
              ? null
              : (lesson.versions[0]?.summary ?? null),
        };
      });

      // The prompt names lessons by their number in the Syllabus; a lesson
      // archived meanwhile drops out of the proposal being refined
      const numberOf = new Map(lessons.map((lesson, i) => [lesson.id, i + 1]));
      const refining = input.refining && {
        edits: input.refining.proposal.edits.flatMap(
          ({ lessonId, ...edit }) => {
            const lesson = numberOf.get(lessonId);
            return lesson ? [{ lesson, ...edit }] : [];
          },
        ),
        archives: input.refining.proposal.archives.flatMap(
          ({ lessonId, included }) => {
            const lesson = numberOf.get(lessonId);
            return lesson ? [{ lesson, included }] : [];
          },
        ),
        // One whose place left the Syllabus meanwhile goes with it
        additions: input.refining.proposal.additions.flatMap(
          ({ afterLessonId, ...addition }) => {
            if (afterLessonId === null) return [{ ...addition, after: 0 }];
            const after = numberOf.get(afterLessonId);
            return after ? [{ ...addition, after }] : [];
          },
        ),
        order: input.refining.proposal.order && {
          lessons: input.refining.proposal.order.lessonIds.flatMap(
            (id) => numberOf.get(id) ?? [],
          ),
          included: input.refining.proposal.order.included,
        },
      };

      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'SYLLABUS_REVISION',
        model: SYLLABUS_REVISION_MODEL,
        promptVersion: SYLLABUS_REVISION_PROMPT_VERSION,
        system: SYLLABUS_REVISION_SYSTEM_PROMPT,
        prompt: buildSyllabusRevisionPrompt({
          setup: courseSetupSchema.parse(course),
          lessons,
          rounds: [
            ...(input.refining?.rounds ?? []),
            { chips: input.chips, text: input.feedback || null },
          ],
          refining,
        }),
        outputSchema: syllabusRevisionOutputSchema,
      });

      const proposal = toProposedRevision(output, lessons);
      // How the lessons left fit the learner's time, at every count the
      // ticked changes can reach, so the preview needs no arithmetic
      const now = new Date();
      const lessonsLeft = lessons.filter(
        (lesson) => lesson.status !== 'COMPLETE',
      ).length;
      const fewest = Math.max(0, lessonsLeft - proposal.archives.length);
      const most = lessonsLeft + proposal.additions.length;
      const byLessonsLeft = Array.from({ length: most - fewest + 1 }, (_, i) =>
        pacing(fewest + i, course, now),
      ).filter((line) => line !== null);

      return {
        model,
        promptVersion,
        note: output.note || null,
        ...proposal,
        lessons: lessons.map(({ id, title, status }) => ({
          id,
          title,
          status,
        })),
        pacing:
          byLessonsLeft.length > 0 ? { lessonsLeft, byLessonsLeft } : null,
      };
    }),

  /**
   * Applies the changes the learner approved from a revision, as they left
   * them, in one transaction holding the course's lock, by the same rules as
   * editing the Syllabus: archived lessons keep their slots and history
   * (ADR-0003), new ones take fresh slots, a Syllabus holds one to
   * MAX_LESSONS lessons, and fixed lessons keep their places. A change to a
   * lesson opened meanwhile, or to an archived course, is refused, and
   * nothing is applied.
   */
  applySyllabusRevision: protectedProcedure
    .input(
      z
        .object({
          courseId: z.string(),
          edits: z
            .array(
              z
                .object({
                  lessonId: z.string(),
                  title: lessonTitleSchema.optional(),
                  objectives: objectivesSchema.optional(),
                })
                .refine(
                  (edit) =>
                    edit.title !== undefined || edit.objectives !== undefined,
                  {
                    message:
                      'An edit changes the title, the objectives or both',
                  },
                ),
            )
            .max(MAX_LESSONS),
          archives: z.array(z.string()).max(MAX_LESSONS),
          additions: z
            .array(
              z.object({
                title: lessonTitleSchema,
                objectives: objectivesSchema,
                afterLessonId: z.string().nullable(),
              }),
            )
            .max(MAX_LESSONS),
          order: z.array(z.string()).max(MAX_LESSONS).nullable(),
        })
        .refine(
          ({ edits, archives, additions, order }) =>
            edits.length + archives.length + additions.length > 0 || order,
          { message: 'A revision changes at least one lesson' },
        )
        .refine(
          ({ edits, archives }) => {
            const changed = [
              ...edits.map((edit) => edit.lessonId),
              ...archives,
            ];
            return new Set(changed).size === changed.length;
          },
          { message: 'A revision changes each lesson once' },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await findEditableCourse(ctx.prisma, ctx.userId, input.courseId);

      await ctx.prisma.$transaction(async (tx) => {
        await lockCourse(tx, input.courseId);
        await assertCourseActive(tx, input.courseId);
        const lessons = await tx.lesson.findMany({
          where: { courseId: input.courseId, archivedAt: null },
          orderBy: { position: 'asc' },
        });
        const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]));
        const fixed = (id: string) =>
          isFixed({ status: lessonStatus(byId.get(id)!) });
        const changedMeanwhile = () =>
          new TRPCError({
            code: 'CONFLICT',
            message:
              'The syllabus has changed since these changes were proposed. Ask for changes again.',
          });
        const openedMeanwhile = (id: string) =>
          new TRPCError({
            code: 'CONFLICT',
            message: `"${byId.get(id)!.title}" has been opened since these changes were proposed, so it can't change. Ask for changes again.`,
          });

        for (const id of [
          ...input.edits.map((edit) => edit.lessonId),
          ...input.archives,
        ]) {
          if (!byId.has(id)) throw changedMeanwhile();
          if (fixed(id)) throw openedMeanwhile(id);
        }

        // The Syllabus in its new order: fixed lessons in their places
        const current = lessons.map((lesson) => lesson.id);
        if (input.order) {
          const order = input.order;
          if (
            order.length !== current.length ||
            new Set(order).size !== order.length ||
            order.some((id) => !byId.has(id))
          ) {
            throw changedMeanwhile();
          }
          const moved = current.find(
            (id) => fixed(id) && order.indexOf(id) !== current.indexOf(id),
          );
          if (moved) throw openedMeanwhile(moved);
        }

        // New lessons after the lesson each follows, several after one in
        // the order given, then archived lessons out
        type Place = string | { addition: number };
        const places: Place[] = [...(input.order ?? current)];
        const lastAfter = new Map<string | null, Place>();
        input.additions.forEach(({ afterLessonId }, addition) => {
          if (afterLessonId !== null && !byId.has(afterLessonId)) {
            throw changedMeanwhile();
          }
          const previous = lastAfter.get(afterLessonId);
          const index =
            previous !== undefined
              ? places.indexOf(previous) + 1
              : afterLessonId === null
                ? 0
                : places.indexOf(afterLessonId) + 1;
          const place = { addition };
          places.splice(index, 0, place);
          lastAfter.set(afterLessonId, place);
        });
        const archived = new Set(input.archives);
        const syllabus = places.filter(
          (place) => typeof place !== 'string' || !archived.has(place),
        );

        if (syllabus.length === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'A syllabus keeps at least one lesson. Archive the course instead.',
          });
        }
        if (syllabus.length > MAX_LESSONS) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A syllabus holds at most ${MAX_LESSONS} lessons`,
          });
        }

        if (archived.size > 0) {
          await tx.lesson.updateMany({
            where: { id: { in: [...archived] }, archivedAt: null },
            data: { archivedAt: new Date() },
          });
        }
        for (const { lessonId, title, objectives } of input.edits) {
          await tx.lesson.update({
            where: { id: lessonId },
            data: { title, objectives },
          });
        }

        // The slots the lessons kept, archived ones keeping theirs, then
        // fresh ones for the new lessons, in the new order
        const fresh = await slotAfterLast(tx, input.courseId);
        const slots = [
          ...lessons
            .filter((lesson) => !archived.has(lesson.id))
            .map((lesson) => lesson.position),
          ...input.additions.map((_, i) => fresh + i),
        ];
        for (const [index, place] of syllabus.entries()) {
          if (typeof place === 'string') {
            await tx.lesson.update({
              where: { id: place },
              data: { position: slots[index] },
            });
          } else {
            const { title, objectives } = input.additions[place.addition];
            await tx.lesson.create({
              data: {
                courseId: input.courseId,
                title,
                objectives,
                position: slots[index],
              },
            });
          }
        }
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
   * Its Course Deck comes back with it, or a new one if it was deleted
   * while the course was archived (#77).
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

      await ctx.prisma.$transaction(async (tx) => {
        const restored = await tx.course.updateMany({
          where: { id: course.id, archivedAt: { not: null } },
          data: { archivedAt: null },
        });
        if (restored.count === 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This course is not archived',
          });
        }

        await tx.deck.upsert({
          where: { courseId: course.id },
          update: { archivedAt: null },
          create: {
            userId: ctx.userId,
            courseId: course.id,
            name: course.title,
          },
        });
      });

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
