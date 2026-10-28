import { Link, useNavigate, useParams } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { ChevronRight, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CourseSkeleton } from '@/components/PageSkeleton';
import { PAGE_WIDTH } from '@/lib/layout';
import { PinnedHeader } from '@/components/PinnedHeader';

type SyllabusLesson =
  inferRouterOutputs<AppRouter>['course']['getById']['lessons'][number];
type LessonStatus = SyllabusLesson['status'];

/** A proposed lesson: it doesn't exist yet, so it has no id or progress. */
type ProposedLesson = { title: string; objectives: string[] };

/** How each Lesson Completion status shows in a syllabus row. */
const STATUSES: Record<
  LessonStatus,
  { label: string; Icon: typeof Circle; className: string }
> = {
  NOT_STARTED: {
    label: 'Not started',
    Icon: Circle,
    className: 'text-white/60',
  },
  OPENED: { label: 'Opened', Icon: CircleDot, className: 'text-white/60' },
  COMPLETE: { label: 'Complete', Icon: CircleCheck, className: 'text-white' },
};

/**
 * A Syllabus Proposal's lessons, objectives in full, since reading them is
 * the point of reviewing it.
 */
function ProposedLessons({
  lessons,
  labelledBy,
}: {
  lessons: ProposedLesson[];
  labelledBy: string;
}) {
  return (
    <ol aria-labelledby={labelledBy} className="mt-4 space-y-3">
      {lessons.map((lesson, index) => (
        <li
          key={index}
          aria-label={`Lesson ${index + 1}: ${lesson.title}`}
          className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm"
        >
          <p className="font-semibold">
            <span className="mr-2 text-white/50">{index + 1}.</span>
            {lesson.title}
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-10 text-sm text-white/70">
            {lesson.objectives.map((objective, objectiveIndex) => (
              <li key={objectiveIndex}>{objective}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/**
 * The accepted Syllabus as a compact list, like a table of contents: a row
 * per lesson, its objectives collapsed until the learner opens them, one
 * lesson's at a time.
 */
function Syllabus({
  lessons,
  upNextId,
  labelledBy,
}: {
  lessons: SyllabusLesson[];
  /** The lesson Continue goes to, if any. */
  upNextId: string | undefined;
  labelledBy: string;
}) {
  // One lesson's objectives at a time, like an accordion
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpenId((previous) => (previous === id ? null : id));

  return (
    <ol
      aria-labelledby={labelledBy}
      className="mt-4 divide-y divide-white/10 rounded-xl border border-white/20 bg-white/5"
    >
      {lessons.map((lesson, index) => {
        const isOpen = openId === lesson.id;
        const objectivesId = `objectives-${lesson.id}`;
        const status = STATUSES[lesson.status];
        return (
          <li
            key={lesson.id}
            aria-label={`Lesson ${index + 1}: ${lesson.title}`}
            className="px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={objectivesId}
                aria-label={`Objectives: ${lesson.title}`}
                onClick={() => toggle(lesson.id)}
                className="relative touch-target shrink-0 rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <ChevronRight
                  className={`size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
              </button>
              <span className="w-6 shrink-0 text-white/50 tabular-nums">
                {index + 1}.
              </span>
              <Link
                to={`/lessons/${lesson.id}`}
                className="min-w-0 flex-1 font-medium underline-offset-2 hover:underline"
              >
                {lesson.title}
              </Link>
              {lesson.id === upNextId && (
                <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-xs">
                  Up next
                </span>
              )}
              <span
                className={`flex shrink-0 items-center gap-1.5 text-xs ${status.className}`}
              >
                <status.Icon className="size-4" aria-hidden />
                {/* The icon alone on narrow screens, for room */}
                <span className="sr-only sm:not-sr-only">{status.label}</span>
              </span>
            </div>
            {/* Slides open and shut: the row's height animates from none
                to the list's, unless the learner prefers less motion.
                Closed, the list stays in the page but out of reach */}
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div
                className="overflow-hidden"
                inert={!isOpen}
                aria-hidden={!isOpen}
              >
                <ul
                  id={objectivesId}
                  aria-label="Objectives"
                  className="mt-2 mb-1 ml-16 list-disc space-y-0.5 text-sm text-white/70"
                >
                  {lesson.objectives.map((objective, objectiveIndex) => (
                    <li key={objectiveIndex}>{objective}</li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function cardWord(count: number) {
  return count === 1 ? 'card' : 'cards';
}

/**
 * The Course Deck as part of the course: how many cards are waiting, and a
 * way into the study flow every deck uses.
 */
function Review({
  deckId,
  dueCount,
  newCount,
}: {
  deckId: string;
  dueCount: number;
  newCount: number;
}) {
  return (
    <section
      aria-labelledby="review-heading"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3"
    >
      <h2 id="review-heading" className="font-semibold">
        Review
      </h2>
      {dueCount + newCount > 0 ? (
        <>
          <p className="flex-1 text-white/80">
            <span className="whitespace-nowrap">{`${dueCount} ${cardWord(dueCount)} due`}</span>
            <span className="mx-2 text-white/40">·</span>
            <span className="whitespace-nowrap">{`${newCount} new ${cardWord(newCount)}`}</span>
          </p>
          <Link
            to={`/decks/${deckId}`}
            className="rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white backdrop-blur-sm hover:bg-white/30"
          >
            Study now
          </Link>
        </>
      ) : (
        <p className="flex-1 text-sm text-white/70">
          Nothing to review right now. Make review cards from a lesson, or come
          back when cards are due.
        </p>
      )}
    </section>
  );
}

export default function CoursePage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const courseQuery = trpc.course.getById.useQuery({ id: courseId });

  const acceptProposal = trpc.course.acceptProposal.useMutation({
    onSuccess: () => {
      utils.course.getById.invalidate({ id: courseId });
      utils.course.list.invalidate();
    },
    onError: () => {
      toast.error('Failed to accept the syllabus');
    },
  });

  const discardProposal = trpc.course.discardProposal.useMutation({
    onSuccess: () => {
      utils.course.list.invalidate();
      navigate('/courses');
    },
    onError: () => {
      toast.error('Failed to discard the proposal');
    },
  });

  if (courseQuery.isLoading) {
    return <CourseSkeleton />;
  }

  const course = courseQuery.data;
  if (courseQuery.isError || !course) {
    const notFound = courseQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <CenteredPage centered>
        <p className="text-destructive">
          {notFound ? 'Course not found.' : 'Error loading course.'}
        </p>
      </CenteredPage>
    );
  }

  const proposal = course.proposal;
  const isProposal = proposal !== null && proposal.acceptedAt === null;

  return (
    <div className="flex flex-1 flex-col text-white">
      <PinnedHeader
        back={{ to: '/courses', label: 'Courses' }}
        title={course.title}
        subtitle={course.goal}
      >
        {!isProposal &&
          (course.continueLesson ? (
            <Link
              to={`/lessons/${course.continueLesson.id}`}
              // A line of its own on narrow screens, so it's never squeezed
              className="flex w-full shrink-0 items-center justify-center gap-1 rounded-lg bg-white/25 px-4 py-2 font-medium text-white backdrop-blur-sm hover:bg-white/35 sm:w-auto"
            >
              Continue: {course.continueLesson.title}
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            course.lessons.length > 0 && (
              <p className="text-sm text-white/70">Every lesson is complete</p>
            )
          ))}
      </PinnedHeader>
      <main className={`${PAGE_WIDTH} py-8`}>
        {/* Centred: unlike a lesson, there's no outline beside it */}
        <div className="mx-auto max-w-3xl">
          {isProposal ? (
            <section>
              <h2 id="syllabus-heading" className="text-lg font-semibold">
                Syllabus Proposal
              </h2>
              <p className="mt-1 text-sm text-white/60">
                Review the lessons below. Accepting creates your course&apos;s
                syllabus.
              </p>
              <ProposedLessons
                lessons={proposal.lessons}
                labelledBy="syllabus-heading"
              />
              <button
                type="button"
                onClick={() => acceptProposal.mutate({ courseId })}
                disabled={acceptProposal.isPending}
                className="mt-6 w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
              >
                {acceptProposal.isPending ? 'Accepting…' : 'Accept syllabus'}
              </button>
              <ConfirmDialog
                title="Discard proposal"
                description={`Discard the proposed syllabus and remove "${course.title}"? You can create the course again later.`}
                confirmLabel="Discard"
                onConfirm={() => discardProposal.mutate({ courseId })}
                trigger={
                  <button
                    type="button"
                    disabled={discardProposal.isPending}
                    className="mt-3 w-full rounded-lg py-2 text-sm text-white/60 hover:text-white disabled:opacity-50"
                  >
                    Discard proposal
                  </button>
                }
              />
            </section>
          ) : (
            <section>
              {course.review && <Review {...course.review} />}
              <h2 id="syllabus-heading" className="mt-8 text-lg font-semibold">
                Syllabus
              </h2>
              <Syllabus
                lessons={course.lessons}
                upNextId={course.continueLesson?.id}
                labelledBy="syllabus-heading"
              />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
