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
import {
  buildCardProposalPrompt,
  CARD_PROPOSAL_MODEL,
  CARD_PROPOSAL_PROMPT_VERSION,
  CARD_PROPOSAL_SYSTEM_PROMPT,
  cardProposalOutputSchema,
  cardProposalSchema,
} from '../ai/cardProposal.js';
import { courseSetupSchema } from '../ai/syllabus.js';
import { userCanUseAI } from '../ai/access.js';
import {
  createCards,
  deckOrder,
  primaryAnswerText,
  withCanonicalAnswers,
} from '../services/cards.js';
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

/** Attempts the learner got wrong, wholly or in part (ADR-0006). */
const attemptGotWrong = {
  evaluation: { in: ['INCORRECT', 'PARTIALLY_CORRECT'] },
} satisfies Prisma.ExerciseAttemptWhereInput;

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
          exercises: shown.map(({ id, type, prompt, attempts: [latest] }) => ({
            id,
            type,
            prompt,
            latestAttempt: latest ? toAttemptView(latest) : null,
          })),
          hiddenExerciseCount: version.exercises.length - shown.length,
        }
      : null,
  };
}

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
        if (latest.versions.length > 0) return toLessonView(latest, access);
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
        access,
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
        canonicalAnswer,
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
});
