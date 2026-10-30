/**
 * How a syllabus fits the learner's time: the lesson budget a deadline sets
 * before a syllabus is proposed, and the pacing line a proposal shows. Both
 * take a lesson to be one session, and count weeks at the learner's time per
 * week.
 */

/** The learner's time, from the Course Setup. */
type LearnerTime = {
  minutesPerWeek: number | null;
  sessionMinutes: number | null;
  deadline: Date | null;
};

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** The start of today in UTC, as a deadline (a date with no time) is stored. */
function startOfToday(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Weeks from today until the deadline, in part weeks; none once it's past. */
function weeksUntil(deadline: Date, now: Date): number {
  return Math.max(
    0,
    (deadline.getTime() - startOfToday(now).getTime()) / MS_PER_WEEK,
  );
}

/**
 * About how many lessons fit before the deadline: weeks until it × minutes
 * per week ÷ session minutes, at least one. Null without a deadline, or
 * without the learner's time, so the model chooses.
 */
export function lessonBudget(
  { minutesPerWeek, sessionMinutes, deadline }: LearnerTime,
  now: Date,
): number | null {
  if (!deadline || !minutesPerWeek || !sessionMinutes) return null;
  return Math.max(
    1,
    Math.floor((weeksUntil(deadline, now) * minutesPerWeek) / sessionMinutes),
  );
}

export type Pacing = {
  lessons: number;
  sessionMinutes: number;
  minutesPerWeek: number;
  /** Weeks the lessons take, rounded up to whole weeks. */
  weeks: number;
  /** Whole weeks past the deadline, rounded up; 0 when it finishes before. */
  deadline: { finishesBefore: boolean; weeksOver: number } | null;
};

/**
 * A proposal's pacing line: its lessons, each one session, take lessons ×
 * session minutes ÷ minutes per week weeks, compared with the deadline when
 * there is one. Null without the learner's time.
 */
export function pacing(
  lessons: number,
  { minutesPerWeek, sessionMinutes, deadline }: LearnerTime,
  now: Date,
): Pacing | null {
  if (!minutesPerWeek || !sessionMinutes) return null;

  const weeks = (lessons * sessionMinutes) / minutesPerWeek;
  const over = deadline ? weeks - weeksUntil(deadline, now) : null;

  return {
    lessons,
    sessionMinutes,
    minutesPerWeek,
    weeks: Math.max(1, Math.ceil(weeks)),
    deadline:
      over === null
        ? null
        : {
            finishesBefore: over <= 0,
            weeksOver: Math.max(0, Math.ceil(over)),
          },
  };
}
