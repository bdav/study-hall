import { useNavigate } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { useTabState } from '@/hooks/useTabState';
import {
  FIRST_STAGE,
  forgetNewCourse,
  INTERVIEW,
  NO_INTERVIEW,
  STAGE,
  type Transcript,
} from '@/lib/newCourse';
import { AiUnavailableNotice } from '@/components/AiUnavailableNotice';
import { BackLink } from '@/components/BackLink';
import { CenteredPage } from '@/components/CenteredPage';
import { WritingLoader } from '@/components/WritingLoader';
import {
  CourseSetupForm,
  type CourseSetup,
} from '@/components/CourseSetupForm';
import { SetupInterview } from '@/components/SetupInterview';

export default function NewCoursePage() {
  // Kept for the tab, so a reload picks it up where it was
  const [stage, setStage] = useTabState(
    STAGE.key,
    STAGE.initial,
    STAGE.isValid,
  );
  const [interview, setInterview] = useTabState(
    INTERVIEW.key,
    INTERVIEW.initial,
    INTERVIEW.isValid,
  );
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();

  const createCourse = trpc.course.create.useMutation({
    onSuccess: (data) => {
      // The next new course starts afresh
      forgetNewCourse();
      utils.course.list.invalidate();
      navigate(`/courses/${data.id}`);
    },
  });

  if (me.data?.user && !me.data.user.canUseAI) {
    return (
      <CenteredPage centered>
        <AiUnavailableNotice title="Courses need AI access">
          Your account doesn&apos;t have access to AI features yet, and courses
          use them to build your syllabus and lessons.
        </AiUnavailableNotice>
      </CenteredPage>
    );
  }

  // The monthly AI spending cap was reached: AI is paused, not broken
  if (createCourse.error?.data?.code === 'TOO_MANY_REQUESTS') {
    return (
      <CenteredPage centered>
        <AiUnavailableNotice title="AI features are paused">
          {createCourse.error.message}
        </AiUnavailableNotice>
      </CenteredPage>
    );
  }

  function create(setup: CourseSetup, transcript: Transcript | null) {
    createCourse.mutate(
      transcript ? { ...setup, interview: transcript } : setup,
    );
  }

  /** Back to an empty opening box, forgetting everything said so far. */
  function startOver() {
    forgetNewCourse();
    setStage(FIRST_STAGE);
    setInterview(NO_INTERVIEW);
  }

  const hasBegun = stage.step === 'form' || interview.current !== null;

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
          <div className="mb-3 flex w-full max-w-xl items-center justify-between gap-4">
            <BackLink to="/courses">Courses</BackLink>
            {hasBegun && (
              <button
                type="button"
                onClick={startOver}
                className="text-sm text-white/60 hover:text-white"
              >
                Start over
              </button>
            )}
          </div>
          {stage.step === 'interview' ? (
            <SetupInterview
              interview={interview}
              onChange={setInterview}
              onDone={(draft, transcript) =>
                setStage({ step: 'form', draft, interview: transcript })
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
