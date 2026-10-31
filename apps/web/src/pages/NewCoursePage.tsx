import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { BackLink } from '@/components/BackLink';
import { CenteredPage } from '@/components/CenteredPage';
import { WritingLoader } from '@/components/WritingLoader';
import {
  CourseSetupForm,
  type CourseSetup,
  type DraftSetup,
} from '@/components/CourseSetupForm';
import { SetupInterview, type Transcript } from '@/components/SetupInterview';

/**
 * Where course creation is: the Setup Interview (from its opening box), or
 * the course form, filled in from the interview's draft or empty after
 * Skip.
 */
type Stage =
  | { step: 'interview' }
  | { step: 'form'; draft: DraftSetup | null; interview: Transcript | null };

/** Shown instead of the form when AI can't be used, pointing to flashcards. */
function AiUnavailableNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <CenteredPage centered>
      <div className="max-w-md text-center text-white">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-white/70">{children}</p>
        <p className="mt-4 text-white/70">
          Standalone{' '}
          <Link to="/flashcards" className="underline hover:text-white">
            flashcards
          </Link>{' '}
          are fully available.
        </p>
      </div>
    </CenteredPage>
  );
}

export default function NewCoursePage() {
  const [stage, setStage] = useState<Stage>({ step: 'interview' });
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();

  const createCourse = trpc.course.create.useMutation({
    onSuccess: (data) => {
      utils.course.list.invalidate();
      navigate(`/courses/${data.id}`);
    },
  });

  if (me.data?.user && !me.data.user.canUseAI) {
    return (
      <AiUnavailableNotice title="Courses need AI access">
        Your account doesn&apos;t have access to AI features yet, and courses
        use them to build your syllabus and lessons.
      </AiUnavailableNotice>
    );
  }

  // The monthly AI spending cap was reached: AI is paused, not broken
  if (createCourse.error?.data?.code === 'TOO_MANY_REQUESTS') {
    return (
      <AiUnavailableNotice title="AI features are paused">
        {createCourse.error.message}
      </AiUnavailableNotice>
    );
  }

  function create(setup: CourseSetup, interview: Transcript | null) {
    createCourse.mutate(interview ? { ...setup, interview } : setup);
  }

  return (
    <>
      {createCourse.isPending && (
        <CenteredPage centered>
          <WritingLoader
            label="Writing your syllabus"
            title="Writing your syllabus proposal"
            detail="This takes about a minute. You can shape it before you start."
          />
        </CenteredPage>
      )}
      {/* Kept as the learner left it underneath, should generating fail */}
      <div hidden={createCourse.isPending} className="flex flex-1 flex-col">
        <CenteredPage>
          <div className="mb-3 w-full max-w-xl">
            <BackLink to="/courses">Courses</BackLink>
          </div>
          {stage.step === 'interview' ? (
            <SetupInterview
              onDone={(draft, interview) =>
                setStage({ step: 'form', draft, interview })
              }
              onSkip={() =>
                setStage({ step: 'form', draft: null, interview: null })
              }
            />
          ) : (
            <CourseSetupForm
              draft={stage.draft}
              onSubmit={(setup) => create(setup, stage.interview)}
              error={createCourse.error?.message ?? null}
            />
          )}
        </CenteredPage>
      </div>
    </>
  );
}
