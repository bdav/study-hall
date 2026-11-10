import { type Prisma } from '@prisma/client';
import { z } from 'zod';
import { protectedProcedure, router } from './trpc.js';
import { readCardStanding } from '../services/cardStanding.js';
import { liveCramDate } from '../services/cramDate.js';
import { deckNotFoundError } from '../services/decks.js';
import { continueTarget } from '../services/syllabus.js';
import { isAiPaused } from '../ai/spend.js';

/** Names in the order a reader expects, whatever their case. */
const byName = (a: string, b: string) =>
  a.localeCompare(b, 'en', { sensitivity: 'base' });

/**
 * What Today reads of a course: its next lesson and the learner's latest
 * activity in it, in its lessons archived or not.
 */
const courseFields = {
  id: true,
  title: true,
  goal: true,
  deadline: true,
  createdAt: true,
  proposal: { select: { acceptedAt: true } },
  lessons: {
    select: {
      id: true,
      title: true,
      position: true,
      archivedAt: true,
      firstOpenedAt: true,
      completedAt: true,
      versions: {
        select: {
          attempts: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { createdAt: true },
          },
          tutorThreads: {
            select: {
              messages: {
                where: { role: 'LEARNER' },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { createdAt: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CourseSelect;

type TodayCourse = Prisma.CourseGetPayload<{ select: typeof courseFields }>;

/** A course's Syllabus: its lessons, archived ones left out. */
const syllabusOf = (course: TodayCourse) =>
  course.lessons.filter((lesson) => !lesson.archivedAt);

/**
 * When the learner last did something in a course: opened or completed a
 * lesson, answered an exercise or asked the Tutor, or else created it.
 */
function latestActivity(course: TodayCourse) {
  const times = course.lessons.flatMap((lesson) => [
    lesson.firstOpenedAt,
    lesson.completedAt,
    ...lesson.versions.flatMap((version) => [
      ...version.attempts.map((attempt) => attempt.createdAt),
      ...version.tutorThreads.flatMap((thread) =>
        thread.messages.map((message) => message.createdAt),
      ),
    ]),
  ]);
  return Math.max(
    course.createdAt.getTime(),
    ...times.map((time) => time?.getTime() ?? 0),
  );
}

/**
 * What's next in a course: its waiting Syllabus Proposal, or the lesson
 * the course page's Continue opens, and whether it's written yet; none once
 * every lesson is complete.
 */
function nextInCourse(course: TodayCourse) {
  if (!course.proposal?.acceptedAt) {
    return { kind: 'SYLLABUS_PROPOSAL' as const };
  }
  const syllabus = syllabusOf(course);
  const next = continueTarget(syllabus);
  if (!next) return null;
  const { versions } = syllabus.find((lesson) => lesson.id === next.id)!;
  return {
    kind: 'LESSON' as const,
    lesson: { ...next, written: versions.length > 0 },
  };
}

export const todayRouter = router({
  /**
   * Today (#114): what the learner has to do now, never stats. Review: the
   * decks Flashcards lists with cards due or new, most due, then most new,
   * then by name, each saying whether Today's Review takes it (#115).
   * Continue learning: each active course's next step, the course the
   * learner was last active in first.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    // The decks Flashcards lists, newest first
    const decks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        cramUntil: true,
        leftOutOfToday: true,
        course: { select: { title: true } },
        _count: { select: { cards: true } },
        studySessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { startedAt: true },
        },
      },
    });

    // Every deck's cards, both ways a Reversible Deck is studied, in one read
    const { cards, nextDueAt } = await readCardStanding(ctx.prisma, {
      userId: ctx.userId,
      deckIds: decks.map((deck) => deck.id),
      now,
    });

    const courses = (
      await ctx.prisma.course.findMany({
        where: { userId: ctx.userId, archivedAt: null },
        select: courseFields,
      })
    ).toSorted((a, b) => latestActivity(b) - latestActivity(a));

    return {
      review: {
        decks: decks
          .map((deck) => {
            const deckCards = cards.filter((card) => card.deckId === deck.id);
            return {
              id: deck.id,
              name: deck.name,
              course: deck.course,
              cardCount: deck._count.cards,
              dueCount: deckCards.filter((card) => card.isDue).length,
              newCount: deckCards.filter(
                (card) => card.lifecycleState === 'NEW',
              ).length,
              cramUntil: liveCramDate(deck.cramUntil, now),
              ticked: !deck.leftOutOfToday,
            };
          })
          .filter((deck) => deck.dueCount > 0 || deck.newCount > 0)
          .sort(
            (a, b) =>
              b.dueCount - a.dueCount ||
              b.newCount - a.newCount ||
              byName(a.name, b.name),
          ),
        // For when none are due or new
        nextDueAt,
      },
      continueLearning: courses.flatMap((course) => {
        const next = nextInCourse(course);
        return next
          ? [
              {
                id: course.id,
                title: course.title,
                goal: course.goal,
                deadline: course.deadline,
                next,
              },
            ]
          : [];
      }),
      // Each area's tiles, most recent first, for a block with nothing in it
      previews: {
        // Most recently studied first, then those never studied (a stable
        // sort, so newest first)
        decks: decks
          .toSorted(
            (a, b) =>
              (b.studySessions[0]?.startedAt.getTime() ?? 0) -
              (a.studySessions[0]?.startedAt.getTime() ?? 0),
          )
          .map((deck) => ({
            id: deck.id,
            name: deck.name,
            course: deck.course,
            cardCount: deck._count.cards,
          })),
        // As Courses' tiles show them, archived lessons left out
        courses: courses.map((course) => {
          const syllabus = syllabusOf(course);
          return {
            id: course.id,
            title: course.title,
            goal: course.goal,
            syllabusAccepted: Boolean(course.proposal?.acceptedAt),
            lessonCount: syllabus.length,
            completedLessonCount: syllabus.filter(
              (lesson) => lesson.completedAt,
            ).length,
          };
        }),
      },
      // A lesson not yet written can't be written while AI is paused
      aiPaused: await isAiPaused(ctx.prisma),
    };
  }),

  /**
   * Ticks or unticks decks for Today's Review (#115): one, or several at
   * once with Select all. What's kept is the decks left out, so a new deck
   * starts ticked.
   */
  setDecksTicked: protectedProcedure
    .input(
      z.object({
        deckIds: z.array(z.string()).min(1).max(1000),
        ticked: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deckIds = [...new Set(input.deckIds)];
      // Every deck the learner's, or none changes
      const owned = await ctx.prisma.deck.count({
        where: { id: { in: deckIds }, userId: ctx.userId },
      });
      if (owned !== deckIds.length) throw deckNotFoundError();

      await ctx.prisma.deck.updateMany({
        where: { id: { in: deckIds }, userId: ctx.userId },
        data: { leftOutOfToday: !input.ticked },
      });
      return { success: true };
    }),
});
