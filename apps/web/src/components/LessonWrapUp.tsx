import { Link } from 'react-router-dom';
import { ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { exerciseSearch } from '@/lib/lessonSteps';
import { LessonCompletion } from '@/components/LessonCompletion';
import { ReviewCardsDialog } from '@/components/ReviewCardsDialog';

type Lesson = inferRouterOutputs<AppRouter>['lesson']['getById'];
type LessonVersion = NonNullable<Lesson['version']>;
type Exercise = LessonVersion['exercises'][number];
type Evaluation = NonNullable<Exercise['latestAttempt']>['evaluation'];

const RESULT_LABELS: Record<Evaluation, string> = {
  CORRECT: 'Correct',
  PARTIALLY_CORRECT: 'Partly right',
  INCORRECT: 'Incorrect',
};

/** Wrong, wholly or in part (ADR-0006), at the latest attempt. */
const isMissed = (exercise: Exercise) =>
  exercise.latestAttempt !== null &&
  exercise.latestAttempt.evaluation !== 'CORRECT';

/**
 * Proposes review cards from the lesson, weighted toward the exercises the
 * learner got wrong, and opens them in the preview. Only the cards the
 * learner confirms join the Course Deck (ADR-0001).
 */
function MakeReviewCards({
  lessonId,
  guidance,
}: {
  lessonId: string;
  /** What the cards will focus on, given the learner's attempts so far. */
  guidance: string;
}) {
  const utils = trpc.useUtils();
  const propose = trpc.lesson.proposeReviewCards.useMutation();
  const create = trpc.lesson.createReviewCards.useMutation({
    onSuccess: ({ deckId, createdCount }) => {
      propose.reset();
      utils.card.listByDeck.invalidate({ deckId });
      utils.deck.list.invalidate();
      toast.success(
        `Added ${createdCount} review ${createdCount === 1 ? 'card' : 'cards'} to the course deck`,
      );
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  const proposal = propose.data;

  return (
    <section className="mt-8">
      <h3 className="text-lg font-semibold">Review</h3>
      <p className="mt-2 text-white/70">
        Turn this lesson into flashcards for spaced review. You choose which
        ones to keep. {guidance}
      </p>
      <button
        type="button"
        onClick={() => propose.mutate({ id: lessonId })}
        disabled={propose.isPending}
        className="mt-3 flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-60"
      >
        {propose.isPending && <Loader2 className="size-4 animate-spin" />}
        {propose.isPending ? 'Proposing cards…' : 'Make review cards'}
      </button>
      {propose.isError && (
        <p className="mt-2 text-sm text-destructive">{propose.error.message}</p>
      )}

      {proposal && (
        <ReviewCardsDialog
          open
          onClose={() => propose.reset()}
          onConfirm={(cards) =>
            create.mutate({
              id: lessonId,
              model: proposal.model,
              promptVersion: proposal.promptVersion,
              // Typed Recall is the only card type the preview edits
              cards: cards.map((card) => ({ type: 'TYPED_RECALL', ...card })),
            })
          }
          isPending={create.isPending}
          proposals={proposal.cards}
          existingCards={proposal.existingCards}
        />
      )}
    </section>
  );
}

/**
 * What the review cards will focus on: the exercises the learner ever got
 * wrong on this version, as the API counts them for the proposal, which
 * includes misses since put right or from before starting over.
 */
function reviewGuidance(version: LessonVersion) {
  const missed = version.missedExerciseCount;
  if (missed > 0) {
    return missed === 1
      ? 'The cards will focus on the 1 exercise you missed.'
      : `The cards will focus on the ${missed} exercises you missed.`;
  }
  if (!version.exercises.some((exercise) => exercise.latestAttempt)) {
    return 'Try the exercises first, so the cards can focus on what you get wrong.';
  }
  return "You haven't missed any exercises, so the cards will cover the lesson as a whole.";
}

/** Each exercise's latest result, the missed ones linked to Practice. */
function Results({ exercises }: { exercises: Exercise[] }) {
  const right = exercises.filter(
    (exercise) => exercise.latestAttempt?.evaluation === 'CORRECT',
  ).length;

  return (
    <section className="mt-6">
      <h3 className="text-lg font-semibold">Your results</h3>
      <p className="mt-2 text-white/80">
        You got {right} of {exercises.length} right.
      </p>
      <ol aria-label="Your results" className="mt-3 space-y-2">
        {exercises.map((exercise, index) => {
          const evaluation = exercise.latestAttempt?.evaluation;
          return (
            <li
              key={exercise.id}
              className="flex items-baseline gap-3 rounded-lg bg-white/5 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 text-white/80">
                {index + 1}. {exercise.prompt}
              </span>
              <span
                className={
                  evaluation === 'CORRECT'
                    ? 'text-emerald-300'
                    : evaluation
                      ? 'text-amber-200'
                      : 'text-white/50'
                }
              >
                {evaluation ? RESULT_LABELS[evaluation] : 'Not tried yet'}
              </span>
              {isMissed(exercise) && (
                <Link
                  to={exerciseSearch(exercise.id)}
                  className="shrink-0 text-white/70 underline hover:text-white"
                >
                  Try again
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The end of a lesson: how the learner did, review cards, Lesson
 * Completion and the way on to the next lesson. Only the review cards need
 * AI.
 */
export function LessonWrapUp({
  lesson,
  version,
  canUseAI,
}: {
  lesson: Lesson;
  version: LessonVersion;
  canUseAI: boolean;
}) {
  const { exercises } = version;
  const triedEvery =
    exercises.length > 0 &&
    exercises.every((exercise) => exercise.latestAttempt);

  return (
    <section>
      <h2 className="text-xl font-semibold">Wrap up</h2>
      {exercises.length > 0 && <Results exercises={exercises} />}
      {/* Proposing cards is an AI call */}
      {canUseAI && (
        <MakeReviewCards
          lessonId={lesson.id}
          guidance={reviewGuidance(version)}
        />
      )}
      <LessonCompletion
        lesson={lesson}
        suggestion={
          triedEvery &&
          "You've tried every exercise. If you're done with this lesson, mark it complete."
        }
      />
      <div className="mt-8">
        {lesson.nextLesson ? (
          <Link
            to={`/lessons/${lesson.nextLesson.id}`}
            className="inline-flex items-center gap-1 rounded-lg bg-white/25 px-5 py-2.5 font-medium text-white backdrop-blur-sm hover:bg-white/35"
          >
            Continue: {lesson.nextLesson.title}
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <p className="text-white/80">
            Every other lesson in this course is complete.{' '}
            <Link
              to={`/courses/${lesson.course.id}`}
              className="underline hover:text-white"
            >
              Back to {lesson.course.title}
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
