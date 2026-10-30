import { Link, useNavigate, useParams } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { ChevronRight, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { CenteredPage } from '@/components/CenteredPage';
import { CourseSkeleton } from '@/components/PageSkeleton';
import { PAGE_WIDTH } from '@/lib/layout';
import {
  HEADER_MENU_ITEM,
  HeaderMenu,
  PinnedHeader,
} from '@/components/PinnedHeader';
import { SyllabusEditor } from '@/components/SyllabusEditor';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ProposalEditor } from '@/components/ProposalEditor';

type SyllabusLesson =
  inferRouterOutputs<AppRouter>['course']['getById']['lessons'][number];
type LessonStatus = SyllabusLesson['status'];

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
              {lesson.objectives.length > 0 ? (
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
              ) : (
                // A lesson added without objectives has none to open; the
                // space keeps its number in line with the others
                <span className="size-6 shrink-0" aria-hidden />
              )}
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
  const [isEditing, setIsEditing] = useState(false);
  // The pinned header's place for a proposal's Accept, which the editor
  // renders into
  const [acceptTarget, setAcceptTarget] = useState<HTMLElement | null>(null);
  const [isConfirmingArchive, setIsConfirmingArchive] = useState(false);

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

  const archive = trpc.course.archive.useMutation({
    onSuccess: () => {
      utils.course.list.invalidate();
      utils.course.listArchived.invalidate();
      // Deck and lesson pages show whether their course is archived
      utils.deck.list.invalidate();
      utils.deck.getById.invalidate();
      utils.lesson.getById.invalidate();
      navigate('/courses');
    },
    onError: () => {
      toast.error('Failed to archive the course');
    },
  });

  // Back in Courses as it was, its Syllabus editable again
  const restore = trpc.course.restore.useMutation({
    onSuccess: () => {
      utils.course.getById.invalidate({ id: courseId });
      utils.course.list.invalidate();
      utils.course.listArchived.invalidate();
      // Deck and lesson pages show whether their course is archived
      utils.deck.list.invalidate();
      utils.deck.getById.invalidate();
      utils.lesson.getById.invalidate();
      toast.success('Course restored');
    },
    onError: () => {
      toast.error('Failed to restore the course');
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
  const isArchived = course.archivedAt !== null;
  // A proposal has its own actions, and an archived course is kept as it
  // was, with nowhere to continue
  const isActive = !isProposal && !isArchived;
  const isEditingSyllabus = isEditing && isActive;

  return (
    <div className="flex flex-1 flex-col text-white">
      <PinnedHeader
        back={{ to: '/courses', label: 'Courses' }}
        title={course.title}
        subtitle={course.goal}
      >
        {isProposal && (
          <div ref={setAcceptTarget} className="w-full sm:w-auto" />
        )}
        {isEditingSyllabus ? (
          // In view however far down the learner is editing
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            className="flex w-full shrink-0 items-center justify-center rounded-lg bg-white/25 px-4 py-2 font-medium text-white backdrop-blur-sm hover:bg-white/35 sm:w-auto"
          >
            Done
          </button>
        ) : (
          <>
            {isActive &&
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
                  <p className="text-sm text-white/70">
                    Every lesson is complete
                  </p>
                )
              ))}
            {isActive && (
              <HeaderMenu triggerClassName="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white">
                <DropdownMenuItem
                  onSelect={() => setIsEditing(true)}
                  className={HEADER_MENU_ITEM}
                >
                  Edit syllabus
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setIsConfirmingArchive(true)}
                  className={HEADER_MENU_ITEM}
                >
                  Archive course
                </DropdownMenuItem>
              </HeaderMenu>
            )}
          </>
        )}
      </PinnedHeader>
      <ConfirmDialog
        open={isConfirmingArchive}
        onOpenChange={setIsConfirmingArchive}
        title="Archive course"
        description={`Archive "${course.title}"? It leaves Courses. Its lessons and your work in them are kept, and its cards stay in Flashcards.`}
        confirmLabel="Archive"
        onConfirm={() => {
          if (!archive.isPending) archive.mutate({ courseId });
        }}
      />
      <main className={`${PAGE_WIDTH} py-8`}>
        {/* Centred: unlike a lesson, there's no outline beside it */}
        <div className="mx-auto max-w-3xl">
          {isProposal ? (
            <section>
              <ProposalEditor
                courseId={courseId}
                courseTitle={course.title}
                lessons={proposal.lessons}
                feedback={proposal.feedback}
                pacing={course.pacing}
                onAccept={() => acceptProposal.mutate({ courseId })}
                isAccepting={acceptProposal.isPending}
                acceptTarget={acceptTarget}
                onDiscard={() => discardProposal.mutate({ courseId })}
                isDiscarding={discardProposal.isPending}
              />
            </section>
          ) : (
            <section>
              {isArchived && (
                <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/20 bg-white/5 px-4 py-3">
                  <p className="flex-1 text-sm text-white/80">
                    This course is archived. Its lessons and your work in them
                    are kept, and its cards stay in Flashcards.
                  </p>
                  <button
                    type="button"
                    onClick={() => restore.mutate({ courseId })}
                    disabled={restore.isPending}
                    className="shrink-0 rounded-lg bg-white/20 px-3 py-1.5 text-sm text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
                  >
                    {restore.isPending ? 'Restoring…' : 'Restore course'}
                  </button>
                </div>
              )}
              {course.review && <Review {...course.review} />}
              <h2 id="syllabus-heading" className="mt-8 text-lg font-semibold">
                Syllabus
              </h2>
              {isEditingSyllabus ? (
                <SyllabusEditor courseId={courseId} lessons={course.lessons} />
              ) : (
                <Syllabus
                  lessons={course.lessons}
                  upNextId={course.continueLesson?.id}
                  labelledBy="syllabus-heading"
                />
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
