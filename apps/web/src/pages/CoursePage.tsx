import { Link, useNavigate, useParams } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { BackLink } from '@/components/BackLink';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CourseSkeleton } from '@/components/PageSkeleton';

type LessonStatus =
  inferRouterOutputs<AppRouter>['course']['getById']['lessons'][number]['status'];

/**
 * A lesson of the syllabus has an id and the learner's progress through
 * it; a proposed lesson doesn't exist yet.
 */
type LessonOutline = {
  id?: string;
  title: string;
  objectives: string[];
  status?: LessonStatus;
};

const STATUS_LABELS: Record<LessonStatus, string> = {
  NOT_STARTED: 'Not started',
  OPENED: 'Opened',
  COMPLETE: 'Complete',
};

function LessonList({
  lessons,
  labelledBy,
}: {
  lessons: LessonOutline[];
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
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold">
              <span className="mr-2 text-white/50">{index + 1}.</span>
              {lesson.id ? (
                <Link
                  to={`/lessons/${lesson.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {lesson.title}
                </Link>
              ) : (
                lesson.title
              )}
            </p>
            {lesson.status && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  lesson.status === 'COMPLETE'
                    ? 'bg-white/30 text-white'
                    : 'text-white/60'
                }`}
              >
                {STATUS_LABELS[lesson.status]}
              </span>
            )}
          </div>
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
    <CenteredPage>
      <div className="w-full max-w-2xl text-white">
        <BackLink to="/courses">Courses</BackLink>
        <h1 className="mt-2 text-2xl font-bold">{course.title}</h1>
        <p className="mt-1 text-white/70">{course.goal}</p>

        {isProposal ? (
          <section className="mt-8">
            <h2 id="syllabus-heading" className="text-lg font-semibold">
              Syllabus Proposal
            </h2>
            <p className="mt-1 text-sm text-white/60">
              Review the lessons below. Accepting creates your course&apos;s
              syllabus.
            </p>
            <LessonList
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
          <section className="mt-8">
            {course.continueLesson ? (
              <Link
                to={`/lessons/${course.continueLesson.id}`}
                className="block rounded-lg bg-white/20 px-4 py-3 text-white backdrop-blur-sm hover:bg-white/30"
              >
                Continue:{' '}
                <span className="font-semibold">
                  {course.continueLesson.title}
                </span>
              </Link>
            ) : (
              course.lessons.length > 0 && (
                <p className="text-white/70">
                  You&apos;ve completed every lesson. Open any of them to look
                  back over it.
                </p>
              )
            )}
            <h2 id="syllabus-heading" className="mt-8 text-lg font-semibold">
              Syllabus
            </h2>
            <LessonList
              lessons={course.lessons}
              labelledBy="syllabus-heading"
            />
          </section>
        )}
      </div>
    </CenteredPage>
  );
}
