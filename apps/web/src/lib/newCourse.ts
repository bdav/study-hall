import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import type { DraftSetup } from '@/components/CourseSetupForm';
import { forgetTabState } from '@/hooks/useTabState';

/**
 * A new course's creation as the tab keeps it (`useTabState`), so a reload
 * picks it up where it was: the page's stage, and the Setup Interview so
 * far. Both are forgotten once the course is created, on starting over and
 * on logging out.
 */
const STAGE_KEY = 'new-course:stage';
const INTERVIEW_KEY = 'new-course:interview';

type AnsweredRound =
  inferRouterInputs<AppRouter>['course']['interviewRound']['rounds'][number];
type Round = inferRouterOutputs<AppRouter>['course']['interviewRound'];

/** The interview as course creation keeps it, for tuning the interview. */
export type Transcript = NonNullable<
  inferRouterInputs<AppRouter>['course']['create']['interview']
>;

/**
 * Where course creation is: the Setup Interview (from its opening box), or
 * the course form, filled in from the interview's draft or empty after
 * Skip.
 */
export type Stage =
  | { step: 'interview' }
  | { step: 'form'; draft: DraftSetup | null; interview: Transcript | null };

/** The Setup Interview so far: what the learner said, and the rounds. */
export type InterviewState = {
  opening: string;
  rounds: AnsweredRound[];
  /** The round being answered, with the latest draft */
  current: Round | null;
};

export const FIRST_STAGE: Stage = { step: 'interview' };

export const NO_INTERVIEW: InterviewState = {
  opening: '',
  rounds: [],
  current: null,
};

export const STAGE = {
  key: STAGE_KEY,
  initial: FIRST_STAGE,
  isValid: (kept: unknown): kept is Stage =>
    isObject(kept) &&
    (kept.step === 'interview' ||
      (kept.step === 'form' && 'draft' in kept && 'interview' in kept)),
};

export const INTERVIEW = {
  key: INTERVIEW_KEY,
  initial: NO_INTERVIEW,
  isValid: (kept: unknown): kept is InterviewState =>
    isObject(kept) &&
    typeof kept.opening === 'string' &&
    Array.isArray(kept.rounds) &&
    (kept.current === null ||
      (isObject(kept.current) &&
        Array.isArray(kept.current.questions) &&
        isObject(kept.current.draft))),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Forgets a new course's creation, so the next one starts afresh. */
export function forgetNewCourse() {
  forgetTabState(STAGE_KEY, INTERVIEW_KEY);
}
