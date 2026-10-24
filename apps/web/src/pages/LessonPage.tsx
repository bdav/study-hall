import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
import { CourseSkeleton } from '@/components/PageSkeleton';
import { LessonExercise } from '@/components/LessonExercise';

/** How often to check on a lesson another open is writing. */
const GENERATING_POLL_MS = 3000;

type Lesson = inferRouterOutputs<AppRouter>['lesson']['getById'];
type LessonVersion = NonNullable<Lesson['version']>;

function LessonHeader({ lesson }: { lesson: Lesson }) {
  return (
    <>
      <Link
        to={`/courses/${lesson.course.id}`}
        className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
      >
        <ArrowLeft className="size-4" />
        {lesson.course.title}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{lesson.title}</h1>
    </>
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
      </div>
    </CenteredPage>
  );
}

function LessonContent({
  lessonId,
  version,
}: {
  lessonId: string;
  version: LessonVersion;
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
              key={exercise.id}
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
          <LessonHeader lesson={lesson} />
          <LessonContent lessonId={lesson.id} version={lesson.version} />
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
