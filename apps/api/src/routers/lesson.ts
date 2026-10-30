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
  type LessonRegeneration,
  lessonFeedbackChipSchema,
  OPPOSITE_CHIPS,
} from '../ai/lesson.js';
import {
  buildCardProposalPrompt,
  CARD_PROPOSAL_MODEL,
  CARD_PROPOSAL_PROMPT_VERSION,
  CARD_PROPOSAL_SYSTEM_PROMPT,
  cardProposalOutputSchema,
  cardProposalSchema,
} from '../ai/cardProposal.js';
import { courseSetupSchema, MAX_FEEDBACK_LENGTH } from '../ai/syllabus.js';
import { continueTarget } from '../services/syllabus.js';
import { startTutorThread } from '../services/tutorThreads.js';
import { userCanUseAI } from '../ai/access.js';
import { type AiProvider } from '../ai/provider.js';
import {
  createCards,
  deckOrder,
  primaryAnswerText,
  withCanonicalAnswers,
} from '../services/cards.js';
import {
  attemptsSinceReset,
  nextResetTime,
  toAttemptView,
} from '../services/exercises.js';

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

/**
 * The learner state of a lesson in the user's course; throws NOT_FOUND for
 * anyone else's.
 */
async function findOwnedLessonState(
  prisma: PrismaClient,
  userId: string,
  id: string,
) {
  const lesson = await prisma.lesson.findFirst({
    where: { id, course: { userId } },
    select: { completedAt: true, resetAt: true },
  });

  if (!lesson) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found' });
  }
  return lesson;
}

/** Attempts the learner got wrong, wholly or in part (ADR-0006). */
const attemptGotWrong = {
  evaluation: { in: ['INCORRECT', 'PARTIALLY_CORRECT'] },
} satisfies Prisma.ExerciseAttemptWhereInput;

/**
 * A lesson with its current version, and each exercise's latest attempt
 * since the learner last started the lesson over.
 */
async function findOwnedLesson(
  prisma: PrismaClient,
  userId: string,
  id: string,
) {
  const { resetAt } = await findOwnedLessonState(prisma, userId, id);
  return prisma.lesson.findUniqueOrThrow({
    where: { id },
    include: {
      course: {
        select: {
          id: true,
          title: true,
          archivedAt: true,
          // For where to continue: the active syllabus
          lessons: {
            where: { archivedAt: null },
            select: {
              id: true,
              title: true,
              position: true,
              completedAt: true,
            },
          },
        },
      },
      versions: {
        ...currentVersion,
        include: {
          exercises: {
            orderBy: { position: 'asc' },
            include: {
              attempts: {
                where: attemptsSinceReset(resetAt),
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
              // Ever got wrong, which review card proposals focus on
              _count: { select: { attempts: { where: attemptGotWrong } } },
            },
          },
        },
      },
    },
  });
}

/** The Course Deck a lesson's review cards join. */
async function findCourseDeck(prisma: PrismaClient, courseId: string) {
  const deck = await prisma.deck.findUnique({ where: { courseId } });

  if (!deck) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'This course has no deck to add review cards to.',
    });
  }
  return deck;
}

/**
 * A lesson as the learner sees it. Exercises leave out their expected
 * answers and points, which the learner must not see before attempting.
 * Open Exercises can need AI evaluation (ADR-0005), so a learner without
 * AI access doesn't see them, only how many are hidden.
 */
function toLessonView(
  lesson: Awaited<ReturnType<typeof findOwnedLesson>>,
  { canUseAI }: { canUseAI: boolean },
) {
  const [version] = lesson.versions;
  const shown = (version?.exercises ?? []).filter(
    (exercise) => canUseAI || !exercise.open,
  );
  const { generationClaimedAt } = lesson;
  const isClaimed =
    generationClaimedAt !== null &&
    generationClaimedAt >= staleClaimsBefore(new Date());
  const { lessons: syllabus, ...course } = lesson.course;
  // Where Continue goes from here: never back to this lesson
  const nextLesson = continueTarget(
    syllabus.filter((other) => other.id !== lesson.id),
  );
  return {
    id: lesson.id,
    title: lesson.title,
    objectives: lesson.objectives,
    // Still readable once archived, but not to be written again
    archivedAt: lesson.archivedAt,
    firstOpenedAt: lesson.firstOpenedAt,
    completedAt: lesson.completedAt,
    // Exercises start afresh when it changes
    resetAt: lesson.resetAt,
    course,
    nextLesson,
    // Another open is writing the lesson; the page waits for it to finish
    generating: !version && isClaimed,
    // A new version is being written; the page shows this one until then
    regenerating: Boolean(version) && isClaimed,
    version: version
      ? {
          id: version.id,
          content: parseLessonContent(version.content),
          examples: parseLessonExamples(version.examples),
          exercises: shown.map(({ id, type, prompt, attempts: [latest] }) => ({
            id,
            type,
            prompt,
            latestAttempt: latest ? toAttemptView(latest) : null,
          })),
          hiddenExerciseCount: version.exercises.length - shown.length,
          // The exercises review cards will focus on: any the learner got
          // wrong on this version, whether since put right or before
          // starting over, as proposeReviewCards picks them
          missedExerciseCount: version.exercises.filter(
            (exercise) => exercise._count.attempts > 0,
          ).length,
        }
      : null,
  };
}

/**
 * Runs `write` while holding the lesson's generation claim, so a first open
 * and a regeneration, or two of either, never write at once and pay twice.
 * A claim older than the stale window can be taken over. Returns false,
 * without running `write`, when another call holds the claim.
 */
async function withGenerationClaim(
  prisma: PrismaClient,
  lessonId: string,
  /** What else the lesson must be to claim it. */
  where: Prisma.LessonWhereInput,
  write: () => Promise<void>,
): Promise<boolean> {
  const claim = new Date();
  const claimed = await prisma.lesson.updateMany({
    where: {
      id: lessonId,
      ...where,
      OR: [
        { generationClaimedAt: null },
        { generationClaimedAt: { lt: staleClaimsBefore(claim) } },
      ],
    },
    data: { generationClaimedAt: claim },
  });
  if (claimed.count === 0) return false;

  try {
    await write();
  } finally {
    // Release this claim only, so the learner can try again straight away:
    // a call that outlived it leaves a newer one alone
    await prisma.lesson.updateMany({
      where: { id: lessonId, generationClaimedAt: claim },
      data: { generationClaimedAt: null },
    });
  }
  return true;
}

/**
 * Writes a new Lesson Version from what generation builds on
 * (courses-plan.md, Lesson generation context), and a regeneration's
 * replaced version and feedback. The newest version is the lesson's
 * current one (ADR-0003). Run it holding the lesson's generation claim.
 */
async function writeLessonVersion(
  ctx: { prisma: PrismaClient; ai: AiProvider; userId: string },
  lesson: { id: string; courseId: string; firstOpenedAt: Date | null },
  regeneration?: LessonRegeneration,
) {
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
    prompt: buildLessonPrompt(context, regeneration),
    outputSchema: lessonOutputSchema,
  });

  await ctx.prisma.$transaction([
    ctx.prisma.lessonVersion.create({
      data: {
        lessonId: lesson.id,
        content: output.content,
        examples: output.examples,
        summary: output.summary,
        feedback: regeneration?.feedback ?? null,
        feedbackChips: regeneration?.chips ?? [],
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
      data: { firstOpenedAt: lesson.firstOpenedAt ?? new Date() },
    }),
  ]);
}

const BEING_WRITTEN =
  'This lesson is already being written. Try again in a moment.';

export const lessonRouter = router({
  /** Opens a lesson: its current version, or null before it is generated. */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) =>
      toLessonView(await findOwnedLesson(ctx.prisma, ctx.userId, input.id), {
        canUseAI: await userCanUseAI(ctx.prisma, ctx.userId),
      }),
    ),

  /**
   * Generates the lesson's first version on first open, and records the
   * first-opened time. A lesson that already has a version is returned as
   * it is, without a model call.
   */
  generate: aiProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // aiProcedure: only learners with AI access get here
      const access = { canUseAI: true };
      const lesson = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);
      if (lesson.versions.length > 0) return toLessonView(lesson, access);

      if (lesson.archivedAt || lesson.course.archivedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            "An archived lesson, or one of an archived course, can't be written.",
        });
      }

      const wrote = await withGenerationClaim(
        ctx.prisma,
        lesson.id,
        // A concurrent open may have written it meanwhile
        { versions: { none: {} } },
        () => writeLessonVersion(ctx, lesson),
      );

      const latest = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);
      if (!wrote && latest.versions.length === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: BEING_WRITTEN });
      }
      return toLessonView(latest, access);
    }),

  /**
   * Regenerates a written lesson, with the learner's optional feedback: a
   * new Lesson Version becomes the current one, written from what first
   * open uses plus the version it replaces, and earlier versions keep their
   * exercises, attempts and tutor threads (ADR-0003).
   */
  regenerate: aiProcedure
    .input(
      z
        .object({
          id: z.string(),
          chips: z.array(lessonFeedbackChipSchema).default([]),
          feedback: z.string().trim().max(MAX_FEEDBACK_LENGTH).optional(),
        })
        .refine((input) => input.chips.length > 0 || Boolean(input.feedback), {
          message: 'Choose what should change, or say it',
        })
        .refine(
          ({ chips }) =>
            new Set(chips).size === chips.length &&
            !OPPOSITE_CHIPS.some(
              ([one, other]) => chips.includes(one) && chips.includes(other),
            ),
          { message: 'Choose each chip once, and one of each pair' },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const lesson = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);

      if (lesson.versions.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This lesson has not been written yet. Open it first.',
        });
      }
      if (lesson.archivedAt || lesson.course.archivedAt) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            "An archived lesson, or one of an archived course, can't be regenerated.",
        });
      }

      const wrote = await withGenerationClaim(
        ctx.prisma,
        lesson.id,
        {},
        async () => {
          // Read once claimed: another regeneration may have finished since
          const [replacing] = (
            await findOwnedLesson(ctx.prisma, ctx.userId, input.id)
          ).versions;
          await writeLessonVersion(ctx, lesson, {
            replacing: {
              content: parseLessonContent(replacing.content),
              examples: parseLessonExamples(replacing.examples),
              exercises: replacing.exercises.map((exercise) => ({
                type: exercise.type,
                prompt: exercise.prompt,
                expected: [
                  ...exercise.expectedAnswers,
                  ...exercise.essentialPoints,
                  ...exercise.expectedPoints,
                ],
                // The latest answer since any Start over
                result: exercise.attempts[0]?.evaluation ?? null,
              })),
            },
            chips: input.chips,
            feedback: input.feedback || null,
          });
        },
      );

      if (!wrote) {
        throw new TRPCError({ code: 'CONFLICT', message: BEING_WRITTEN });
      }

      // aiProcedure: only learners with AI access get here
      return toLessonView(
        await findOwnedLesson(ctx.prisma, ctx.userId, input.id),
        { canUseAI: true },
      );
    }),

  /**
   * Proposes review cards from the lesson's current version, weighted
   * toward the exercises the learner got wrong, with the Course Deck's
   * cards so the model doesn't repeat them. Nothing is stored: the learner
   * confirms the cards they want with `createReviewCards` (ADR-0001).
   */
  proposeReviewCards: aiProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const lesson = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);
      const [version] = lesson.versions;
      if (!version) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "This lesson hasn't been written yet.",
        });
      }

      const deck = await findCourseDeck(ctx.prisma, lesson.courseId);
      const exercisesGotWrong = await ctx.prisma.exercise.findMany({
        where: {
          lessonVersionId: version.id,
          attempts: { some: attemptGotWrong },
        },
        orderBy: { position: 'asc' },
        include: {
          attempts: { where: attemptGotWrong, orderBy: { createdAt: 'asc' } },
        },
      });
      const deckCards = await ctx.prisma.card.findMany({
        where: { deckId: deck.id },
        orderBy: deckOrder,
        include: withCanonicalAnswers,
      });
      const existingCards = deckCards.map((card) => ({
        id: card.id,
        front: card.front,
        canonicalAnswer: primaryAnswerText(card),
      }));

      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'CARD_PROPOSAL',
        model: CARD_PROPOSAL_MODEL,
        promptVersion: CARD_PROPOSAL_PROMPT_VERSION,
        system: CARD_PROPOSAL_SYSTEM_PROMPT,
        prompt: buildCardProposalPrompt({
          lesson: { title: lesson.title, objectives: lesson.objectives },
          content: parseLessonContent(version.content),
          examples: parseLessonExamples(version.examples),
          summary: version.summary,
          exercisesGotWrong,
          existingCards,
        }),
        outputSchema: cardProposalOutputSchema,
        maxTokens: 4000,
      });

      return { cards: output.cards, model, promptVersion, existingCards };
    }),

  /**
   * Creates the review cards the learner confirmed from a proposal, as
   * edited, at the end of the Course Deck in one transaction. Each records
   * the lesson as its Source Lesson, and the model and prompt version that
   * proposed it.
   */
  createReviewCards: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        model: z.string().min(1).max(100),
        promptVersion: z.string().min(1).max(100),
        cards: z.array(cardProposalSchema).min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const lesson = await findOwnedLesson(ctx.prisma, ctx.userId, input.id);
      const deck = await findCourseDeck(ctx.prisma, lesson.courseId);

      // Typed Recall is the only card type, and the cards the app makes
      const cards = input.cards.map(({ front, canonicalAnswer }) => ({
        front,
        canonicalAnswers: [canonicalAnswer],
      }));
      await ctx.prisma.$transaction((tx) =>
        createCards(tx, {
          deckId: deck.id,
          userId: ctx.userId,
          cards,
          source: {
            lessonId: lesson.id,
            model: input.model,
            promptVersion: input.promptVersion,
          },
        }),
      );

      return { deckId: deck.id, createdCount: cards.length };
    }),

  /**
   * Sets or undoes Lesson Completion, in any order: no lesson is locked.
   * Completing an already complete lesson keeps when it was completed.
   */
  setCompleted: protectedProcedure
    .input(z.object({ id: z.string(), completed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const lesson = await findOwnedLessonState(
        ctx.prisma,
        ctx.userId,
        input.id,
      );

      return ctx.prisma.lesson.update({
        where: { id: input.id },
        data: {
          completedAt: input.completed
            ? (lesson.completedAt ?? new Date())
            : null,
        },
        select: { id: true, completedAt: true },
      });
    }),

  /**
   * Starts the lesson over, so its exercises can be practised from
   * scratch: the lesson then shows only attempts made from now on, while
   * every earlier attempt is kept (ADR-0003). Clears Lesson Completion and
   * keeps the first-opened time. It applies to the lesson, so it carries
   * across Lesson Versions.
   */
  startOver: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await findOwnedLessonState(ctx.prisma, ctx.userId, input.id);
      // A fresh Tutor Thread, so the tutor's earlier replies, which may
      // quote answers the learner is clearing, stop reaching it. It comes
      // first: should the reset then fail, a spare thread does no harm
      const { versions } = await ctx.prisma.lesson.findUniqueOrThrow({
        where: { id: input.id },
        select: { versions: { ...currentVersion, select: { id: true } } },
      });
      if (versions[0]) await startTutorThread(ctx.prisma, versions[0].id);

      return ctx.prisma.lesson.update({
        where: { id: input.id },
        data: { resetAt: await nextResetTime(ctx.prisma), completedAt: null },
        select: { id: true, resetAt: true },
      });
    }),
});
