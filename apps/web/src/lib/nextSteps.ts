import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { cameFromCourse } from '@/lib/decks';

export type Today = inferRouterOutputs<AppRouter>['today']['get'];
type ReviewDeck = Today['review']['decks'][number];
type CourseRow = Today['continueLearning'][number];

/** A way on from what just ended, to one of Today's next steps (#118). */
export type NextStep = { label: string; to: string; state?: unknown };

/**
 * A deck to study, opening its title card: named with its cards due, or
 * else its new ones.
 */
function deckStep(verb: string, deck: ReviewDeck, state?: unknown): NextStep {
  const count =
    deck.dueCount > 0 ? `${deck.dueCount} due` : `${deck.newCount} new`;
  return {
    label: `${verb}: ${deck.name} (${count})`,
    to: `/decks/${deck.id}`,
    ...(state ? { state } : {}),
  };
}

/**
 * Where a course's Continue learning row goes: its next lesson, or its
 * course page while its Syllabus Proposal waits.
 */
function courseStep(verb: string, course: CourseRow): NextStep {
  return course.next.kind === 'LESSON'
    ? {
        label: `${verb}: ${course.next.lesson.title}`,
        to: `/lessons/${course.next.lesson.id}`,
      }
    : { label: `${verb}: ${course.title}`, to: `/courses/${course.id}` };
}

/** The first Continue learning row, as Continue. */
function continueStep(today: Today) {
  const [first] = today.continueLearning;
  return first ? [courseStep('Continue', first)] : [];
}

/**
 * After a deck's own Study Session: the first deck ticked for Today's
 * Review other than this one with cards due or new, in Today's order, and
 * the first course's next step.
 */
export function afterDeckSession(today: Today, deckId: string): NextStep[] {
  const next = today.review.decks.find(
    (deck) => deck.ticked && deck.id !== deckId,
  );
  return [
    ...(next ? [deckStep('Next deck', next)] : []),
    ...continueStep(today),
  ];
}

/** After Today's Review: the first course's next step. */
export function afterReview(today: Today): NextStep[] {
  return continueStep(today);
}

/**
 * After a lesson, beside its own Continue: its Course Deck while it has
 * cards due or new, ticked for Today's Review or not, linking back to the
 * course, and the next step of the first other course.
 */
export function afterLesson(today: Today, courseId: string): NextStep[] {
  const deck = today.review.decks.find((deck) => deck.course?.id === courseId);
  const other = today.continueLearning.find((course) => course.id !== courseId);
  return [
    ...(deck ? [deckStep('Review', deck, cameFromCourse(courseId))] : []),
    ...(other ? [courseStep('Next course', other)] : []),
  ];
}
