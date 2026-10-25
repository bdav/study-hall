import { useEffect, useRef, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { BackLink } from '@/components/BackLink';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CourseSkeleton } from '@/components/PageSkeleton';
import { LessonExercise } from '@/components/LessonExercise';
import { ReviewCardsDialog } from '@/components/ReviewCardsDialog';

/** How often to check on a lesson another open is writing. */
const GENERATING_POLL_MS = 3000;

type Lesson = inferRouterOutputs<AppRouter>['lesson']['getById'];
type LessonVersion = NonNullable<Lesson['version']>;

function LessonHeader({
  lesson,
  actions,
}: {
  lesson: Lesson;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <BackLink to={`/courses/${lesson.course.id}`}>
          {lesson.course.title}
        </BackLink>
        {actions}
      </div>
      <h1 className="mt-2 text-2xl font-bold">{lesson.title}</h1>
    </>
  );
}

/**
 * Starts the lesson over, so its exercises can be practised from scratch.
 * The lesson then shows only answers given from now on; earlier ones are
 * still saved.
 */
function StartOver({ lesson }: { lesson: Lesson }) {
  const utils = trpc.useUtils();
  const startOver = trpc.lesson.startOver.useMutation({
    onSuccess: async () => {
      // Starting over clears Lesson Completion
      utils.course.getById.invalidate({ id: lesson.course.id });
      // The refetched lesson remounts every exercise. Only then forget the
      // revealed answers, which now need a new attempt: a revealed exercise
      // still mounted would refetch them and fail
      await utils.lesson.getById.invalidate({ id: lesson.id });
      utils.exercise.answers.reset();
    },
    onError: () => {
      toast.error("Couldn't start the lesson over");
    },
  });

  return (
    <ConfirmDialog
      title="Start this lesson over?"
      description="Your answers are cleared from the lesson so you can practise its exercises from scratch, and it's no longer marked complete. Your earlier answers are still saved."
      confirmLabel="Start over"
      onConfirm={() => startOver.mutate({ id: lesson.id })}
      trigger={
        <button
          type="button"
          disabled={startOver.isPending}
          className="text-sm text-white/60 hover:text-white disabled:opacity-50"
        >
          Start over
        </button>
      }
    />
  );
}

/** Shown in place of a lesson that hasn't been written yet. */
function NotWrittenYet({
  lesson,
  children,
}: {
  lesson: Lesson;
  children: ReactNode;
}) {
  return (
    <CenteredPage>
      <div className="w-full max-w-2xl text-white">
        <LessonHeader lesson={lesson} />
        <div className="mt-8 text-white/70">{children}</div>
        {/* Completion needs no AI, so an unwritten lesson is never locked */}
        <LessonCompletion lesson={lesson} />
      </div>
    </CenteredPage>
  );
}

/**
 * Lesson Completion: the learner's own mark that they're done with the
 * lesson, set and undone in any order. It records where they are in the
 * syllabus, never how well they know the material.
 */
function LessonCompletion({ lesson }: { lesson: Lesson }) {
  const utils = trpc.useUtils();
  const setCompleted = trpc.lesson.setCompleted.useMutation({
    onSuccess: () => {
      utils.lesson.getById.invalidate({ id: lesson.id });
      // The syllabus shows the lesson's status and where to continue
      utils.course.getById.invalidate({ id: lesson.course.id });
    },
    onError: () => {
      toast.error("Couldn't save the lesson's completion");
    },
  });
  const complete = lesson.completedAt !== null;

  return (
    <section className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/20 pt-6">
      {complete && (
        <p className="text-white/80">You marked this lesson complete.</p>
      )}
      <button
        type="button"
        onClick={() =>
          setCompleted.mutate({ id: lesson.id, completed: !complete })
        }
        disabled={setCompleted.isPending}
        className={
          complete
            ? 'rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white disabled:opacity-60'
            : 'rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-60'
        }
      >
        {complete ? 'Mark as not complete' : 'Mark lesson complete'}
      </button>
    </section>
  );
}

/**
 * Proposes review cards from the lesson, weighted toward the exercises the
 * learner got wrong, and opens them in the preview. Only the cards the
 * learner confirms join the Course Deck (ADR-0001).
 */
function MakeReviewCards({ lessonId }: { lessonId: string }) {
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
      <h2 className="text-lg font-semibold">Review</h2>
      <p className="mt-2 text-white/70">
        Turn this lesson into flashcards for spaced review, with extra cards on
        the exercises you got wrong. You choose which ones to keep.
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

function LessonContent({
  lessonId,
  version,
  resetAt,
  canUseAI,
}: {
  lessonId: string;
  version: LessonVersion;
  resetAt: Lesson['resetAt'];
  canUseAI: boolean;
}) {
  return (
    <>
      {version.content.map((block, index) => (
        <section key={index} className="mt-8">
          <h2 className="text-lg font-semibold">{block.heading}</h2>
          {block.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="mt-2 text-white/80">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Examples</h2>
        <ul className="mt-3 space-y-3">
          {version.examples.map((example, index) => (
            <li
              key={index}
              className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm"
            >
              <p className="font-medium">{example.example}</p>
              <p className="mt-1 text-sm text-white/70">
                {example.explanation}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 id="lesson-exercises" className="text-lg font-semibold">
          Exercises
        </h2>
        <ol aria-labelledby="lesson-exercises" className="mt-3 space-y-3">
          {version.exercises.map((exercise, index) => (
            <LessonExercise
              // Starting over gives every exercise a fresh start
              key={`${exercise.id}:${resetAt ?? ''}`}
              exercise={exercise}
              index={index}
              lessonId={lessonId}
            />
          ))}
        </ol>
        {/* Open Exercises can need AI to check, so the API hides them from
            learners without AI access (ADR-0005) */}
        {version.hiddenExerciseCount > 0 && (
          <p className="mt-3 text-sm text-white/50">
            {version.hiddenExerciseCount === 1
              ? '1 more exercise needs'
              : `${version.hiddenExerciseCount} more exercises need`}{' '}
            AI to check your answers, and your account doesn&apos;t have access
            to AI features.
          </p>
        )}
      </section>

      {/* Proposing cards is an AI call */}
      {canUseAI && <MakeReviewCards lessonId={lessonId} />}
    </>
  );
}

export default function LessonPage() {
  const { lessonId = '' } = useParams<{ lessonId: string }>();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const lessonQuery = trpc.lesson.getById.useQuery(
    { id: lessonId },
    // While another open writes the lesson, check back until it's done
    {
      refetchInterval: (query) =>
        query.state.data?.generating ? GENERATING_POLL_MS : false,
    },
  );

  // A lesson is written the first time it's opened. The ref asks once per
  // lesson, so a re-run effect (StrictMode) never pays for a second call.
  const requestedFor = useRef<string | null>(null);

  const generate = trpc.lesson.generate.useMutation({
    onSuccess: async (data) => {
      // A refetch still in flight would put back the lesson without content
      await utils.lesson.getById.cancel({ id: lessonId });
      utils.lesson.getById.setData({ id: lessonId }, data);
    },
    onError: (error) => {
      // Another open got there first: wait for it, and take over if it fails
      if (error.data?.code === 'CONFLICT') {
        requestedFor.current = null;
        utils.lesson.getById.invalidate({ id: lessonId });
      }
    },
  });
  const { mutate: generateLesson } = generate;

  const lesson = lessonQuery.data;
  const canUseAI = Boolean(me.data?.user?.canUseAI);
  const needsGenerating =
    lesson !== undefined && lesson.version === null && !lesson.generating;

  useEffect(() => {
    if (needsGenerating && canUseAI && requestedFor.current !== lessonId) {
      requestedFor.current = lessonId;
      generateLesson({ id: lessonId });
    }
  }, [needsGenerating, canUseAI, lessonId, generateLesson]);

  if (lessonQuery.isLoading) {
    return <CourseSkeleton />;
  }

  if (lessonQuery.isError || !lesson) {
    const notFound = lessonQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <CenteredPage centered>
        <p className="text-destructive">
          {notFound ? 'Lesson not found.' : 'Error loading lesson.'}
        </p>
      </CenteredPage>
    );
  }

  if (lesson.version) {
    return (
      <CenteredPage>
        <article className="w-full max-w-2xl text-white">
          <LessonHeader
            lesson={lesson}
            actions={<StartOver lesson={lesson} />}
          />
          <LessonContent
            lessonId={lesson.id}
            version={lesson.version}
            resetAt={lesson.resetAt}
            canUseAI={canUseAI}
          />
          <LessonCompletion lesson={lesson} />
        </article>
      </CenteredPage>
    );
  }

  const waitingForOtherOpen =
    lesson.generating ||
    (generate.error?.data?.code === 'CONFLICT' && lessonQuery.isFetching);

  // Until we know whether the learner can use AI, the lesson is on its way
  if (!canUseAI && !me.isLoading && !waitingForOtherOpen) {
    return (
      <NotWrittenYet lesson={lesson}>
        This lesson hasn&apos;t been written yet, and writing it needs AI
        access, which your account doesn&apos;t have.
      </NotWrittenYet>
    );
  }

  if (generate.isError && !waitingForOtherOpen) {
    // The monthly AI spending cap was reached: AI is paused, not broken
    if (generate.error?.data?.code === 'TOO_MANY_REQUESTS') {
      return (
        <NotWrittenYet lesson={lesson}>{generate.error.message}</NotWrittenYet>
      );
    }

    return (
      <NotWrittenYet lesson={lesson}>
        <p>We couldn&apos;t write this lesson. {generate.error?.message}</p>
        <button
          type="button"
          onClick={() => generateLesson({ id: lessonId })}
          className="mt-4 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30"
        >
          Try again
        </button>
      </NotWrittenYet>
    );
  }

  return (
    <NotWrittenYet lesson={lesson}>
      <div
        role="status"
        aria-label="Writing your lesson"
        className="flex items-center gap-2"
      >
        <Loader2 className="size-4 animate-spin" />
        Writing your lesson. This takes a little while the first time.
      </div>
    </NotWrittenYet>
  );
}
