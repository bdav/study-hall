import { type CardLifecycleState, type RecallGrade } from '@prisma/client';
import { isCorrect } from './countedAttempts.js';

/**
 * The scheduler's update of a card's progress after one finalized answer
 * (`updated-plan.md` §5.3, §7, §8). Pure: the caller persists the result.
 */

/** A card's progress as the scheduler reads and writes it. */
export type ScheduledProgress = {
  lifecycleState: CardLifecycleState;
  masteryScore: number;
  dueAt: Date | null;
  lastReviewedAt: Date | null;
  lastIntervalDays: number | null;
  lapseCount: number;
  // When the card last entered its lifecycle state; none for progress from
  // before it was recorded, when every counted answer is taken as since then
  lifecycleChangedAt: Date | null;
  // When the learner last marked the card known, for replays (ADR-0009)
  markedKnownAt: Date | null;
};

/** One finalized answer to a card, as the scheduler needs it. */
export type ScheduledAnswer = {
  recallGrade: RecallGrade;
  answeredAt: Date;
  studySessionId: string;
};

const MIN_MASTERY = 0;
const MAX_MASTERY = 10;

const MINUTE_IN_DAYS = 1 / (24 * 60);

const LEARNING_INTERVAL_DAYS: Record<RecallGrade, number> = {
  MISSED: 30 * MINUTE_IN_DAYS,
  PARTIALLY_CORRECT: 1,
  GOOD: 1,
  NAILED: 2,
};

/** STABLE intervals by mastery band (`updated-plan.md` §8.4). */
type MasteryBand = 'fragile' | 'developing' | 'solid' | 'mastered';

function masteryBand(mastery: number): MasteryBand {
  if (mastery <= 2) return 'fragile';
  if (mastery <= 5) return 'developing';
  if (mastery <= 8) return 'solid';
  return 'mastered';
}

const HOUR_IN_DAYS = 1 / 24;

const STABLE_INTERVAL_DAYS: Record<MasteryBand, Record<RecallGrade, number>> = {
  fragile: { MISSED: HOUR_IN_DAYS, PARTIALLY_CORRECT: 1, GOOD: 2, NAILED: 4 },
  developing: {
    MISSED: 6 * HOUR_IN_DAYS,
    PARTIALLY_CORRECT: 2,
    GOOD: 5,
    NAILED: 10,
  },
  solid: { MISSED: 1, PARTIALLY_CORRECT: 5, GOOD: 14, NAILED: 30 },
  mastered: { MISSED: 3, PARTIALLY_CORRECT: 10, GOOD: 45, NAILED: 90 },
};

/** Active cards wait no longer than this (`updated-plan.md` §8.4). */
const MAX_INTERVAL_DAYS = 90;

/**
 * Lateness bonus (`updated-plan.md` §8.5): recalling a card well at 1.5 or
 * more of its last interval overdue lengthens its next interval, by a flat
 * 1.25×. It never touches mastery.
 */
const LATENESS_BONUS_FROM_OVERDUE_RATIO = 1.5;
const LATENESS_BONUS = 1.25;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Successful for stabilization (`updated-plan.md` §7.2): GOOD or NAILED,
 * as stats count correct answers.
 */
const isSuccess = isCorrect;

/** The earlier answers since the card entered its lifecycle state. */
function sinceLifecycleChange(
  progress: ScheduledProgress,
  earlier: ScheduledAnswer[],
) {
  const since = progress.lifecycleChangedAt;
  return since ? earlier.filter((a) => a.answeredAt >= since) : earlier;
}

/** The UTC day an answer was given on. */
function dayOf(answer: ScheduledAnswer) {
  return answer.answeredAt.toISOString().slice(0, 10);
}

/**
 * LEARNING → STABLE (`updated-plan.md` §7.2): 2 or more successes since the
 * card entered LEARNING, across 2 or more Study Sessions or days, the
 * latest of them this answer.
 */
function graduates(
  progress: ScheduledProgress,
  answer: ScheduledAnswer,
  earlier: ScheduledAnswer[],
) {
  if (!isSuccess(answer.recallGrade)) return false;
  const successes = [...sinceLifecycleChange(progress, earlier), answer].filter(
    (a) => isSuccess(a.recallGrade),
  );
  const distinct = (key: (a: ScheduledAnswer) => string) =>
    new Set(successes.map(key)).size;
  return (
    successes.length >= 2 &&
    (distinct((a) => a.studySessionId) >= 2 || distinct(dayOf) >= 2)
  );
}

/**
 * STABLE → LEARNING (`updated-plan.md` §7.3): a miss that makes 2 MISSED in
 * the card's last 3 answers since it became STABLE. A single miss is only
 * a lapse, whatever the card missed before it graduated.
 */
function lapsesBackToLearning(
  progress: ScheduledProgress,
  answer: ScheduledAnswer,
  earlier: ScheduledAnswer[],
) {
  const lastThree = [
    ...sinceLifecycleChange(progress, earlier).slice(-2),
    answer,
  ];
  return (
    answer.recallGrade === 'MISSED' &&
    lastThree.filter((a) => a.recallGrade === 'MISSED').length >= 2
  );
}

/** The card's lifecycle state after an answer, and since when it's held it. */
function nextLifecycle(
  progress: ScheduledProgress,
  answer: ScheduledAnswer,
  earlier: ScheduledAnswer[],
): Pick<ScheduledProgress, 'lifecycleState' | 'lifecycleChangedAt'> {
  const now = answer.answeredAt;
  const unchanged = {
    lifecycleState: progress.lifecycleState,
    lifecycleChangedAt: progress.lifecycleChangedAt,
  };
  switch (progress.lifecycleState) {
    case 'NEW':
      return { lifecycleState: 'LEARNING', lifecycleChangedAt: now };
    case 'LEARNING':
      return graduates(progress, answer, earlier)
        ? { lifecycleState: 'STABLE', lifecycleChangedAt: now }
        : unchanged;
    case 'STABLE':
      return lapsesBackToLearning(progress, answer, earlier)
        ? { lifecycleState: 'LEARNING', lifecycleChangedAt: now }
        : unchanged;
    default:
      // RETIRED cards stay so: retiring, and unretiring, are for later
      return unchanged;
  }
}

/**
 * A card's progress after `answer`, given the counted answers before it,
 * oldest first: only those since the card's last progress reset count
 * (ADR-0004), and the caller passes only those.
 */
export function applyAnswer(
  progress: ScheduledProgress,
  answer: ScheduledAnswer,
  earlier: ScheduledAnswer[],
): ScheduledProgress {
  const { recallGrade, answeredAt: now } = answer;
  const lifecycle = nextLifecycle(progress, answer, earlier);
  const intervalDays =
    lifecycle.lifecycleState === 'LEARNING'
      ? learningIntervalDays(progress, recallGrade)
      : // STABLE, and RETIRED as STABLE until its review mode comes
        stableIntervalDays(progress, answer);

  return {
    dueAt: new Date(now.getTime() + intervalDays * DAY_IN_MS),
    lastReviewedAt: now,
    markedKnownAt: progress.markedKnownAt,
    lastIntervalDays: intervalDays,
    ...lifecycle,
    lapseCount:
      progress.lifecycleState === 'STABLE' && recallGrade === 'MISSED'
        ? progress.lapseCount + 1
        : progress.lapseCount,
    masteryScore: Math.min(
      MAX_MASTERY,
      Math.max(
        MIN_MASTERY,
        progress.masteryScore +
          masteryChange(progress.masteryScore, recallGrade),
      ),
    ),
  };
}

function learningIntervalDays(
  progress: ScheduledProgress,
  recallGrade: RecallGrade,
) {
  // A first answer can't show a card is known well enough to wait 2 days
  // (`updated-plan.md` §8.3): NAILED keeps its grade, but not its interval
  const isFirstAnswer = progress.lifecycleState === 'NEW';
  return LEARNING_INTERVAL_DAYS[
    isFirstAnswer && recallGrade === 'NAILED' ? 'GOOD' : recallGrade
  ];
}

function stableIntervalDays(
  progress: ScheduledProgress,
  { recallGrade, answeredAt }: ScheduledAnswer,
) {
  // The band is the card's mastery as it came to this answer
  const base =
    STABLE_INTERVAL_DAYS[masteryBand(progress.masteryScore)][recallGrade];
  const { dueAt, lastIntervalDays } = progress;
  const overdueRatio =
    dueAt && lastIntervalDays
      ? (answeredAt.getTime() - dueAt.getTime()) / DAY_IN_MS / lastIntervalDays
      : 0;
  // Only a card already STABLE: lateness on the answer that graduates a
  // card is measured against its short LEARNING interval
  const bonus =
    progress.lifecycleState === 'STABLE' &&
    isSuccess(recallGrade) &&
    overdueRatio >= LATENESS_BONUS_FROM_OVERDUE_RATIO
      ? LATENESS_BONUS
      : 1;
  return Math.min(MAX_INTERVAL_DAYS, base * bonus);
}

/** The least mastery a card marked known has: two good answers' worth. */
const KNOWN_MIN_MASTERY = 3;

/**
 * Whether a card is known already, so marking it known would leave it as it
 * is (ADR-0009): STABLE or RETIRED.
 */
export function isKnown(lifecycleState: CardLifecycleState) {
  return lifecycleState === 'STABLE' || lifecycleState === 'RETIRED';
}

/**
 * A card's progress once the learner marks it known (ADR-0009): a timing
 * adjustment, not an answer. A NEW or LEARNING card becomes STABLE as if it
 * had just graduated, its mastery raised to at least 3, and is next due a
 * STABLE GOOD interval away for its band. Its last review and lapses stay.
 * Null for a card already STABLE or RETIRED, which is left as it is.
 */
export function markKnown(
  progress: ScheduledProgress,
  now: Date,
): ScheduledProgress | null {
  if (isKnown(progress.lifecycleState)) return null;
  const masteryScore = Math.max(progress.masteryScore, KNOWN_MIN_MASTERY);
  const intervalDays = STABLE_INTERVAL_DAYS[masteryBand(masteryScore)].GOOD;
  return {
    lifecycleState: 'STABLE',
    lifecycleChangedAt: now,
    masteryScore,
    dueAt: new Date(now.getTime() + intervalDays * DAY_IN_MS),
    lastIntervalDays: intervalDays,
    lastReviewedAt: progress.lastReviewedAt,
    lapseCount: progress.lapseCount,
    markedKnownAt: now,
  };
}

/** A card's progress before its first answer, and after a reset. */
export const NEW_PROGRESS: ScheduledProgress = {
  lifecycleState: 'NEW',
  masteryScore: MIN_MASTERY,
  dueAt: null,
  lastReviewedAt: null,
  lastIntervalDays: null,
  lapseCount: 0,
  lifecycleChangedAt: null,
  markedKnownAt: null,
};

/**
 * A card's progress rebuilt from its counted answers, oldest first,
 * starting from NEW (`updated-plan.md` §11.2): the progress `applyAnswer`
 * would have left had each been graded as it is now. A card marked known
 * since its last reset is marked again at that time, between the answers
 * given before and after it (ADR-0009).
 */
export function replayAnswers(
  answers: ScheduledAnswer[],
  markedKnownAt: Date | null = null,
): ScheduledProgress {
  const markIfDue = (progress: ScheduledProgress, before?: Date) =>
    markedKnownAt &&
    !progress.markedKnownAt &&
    (!before || markedKnownAt <= before)
      ? (markKnown(progress, markedKnownAt) ?? { ...progress, markedKnownAt })
      : progress;
  const replayed = answers.reduce(
    (progress, answer, i) =>
      applyAnswer(
        markIfDue(progress, answer.answeredAt),
        answer,
        answers.slice(0, i),
      ),
    NEW_PROGRESS,
  );
  return markIfDue(replayed);
}

function masteryChange(mastery: number, recallGrade: RecallGrade): number {
  switch (recallGrade) {
    case 'MISSED':
      return mastery >= 7 ? -2 : -3;
    case 'PARTIALLY_CORRECT':
      return mastery >= 7 ? -1 : -2;
    case 'GOOD':
      return mastery <= 3 ? 2 : 1;
    case 'NAILED':
      return mastery <= 6 ? 2 : 1;
  }
}
