import { type CardLifecycleState, type RecallGrade } from '@prisma/client';

/**
 * The scheduler's update of a card's progress after one finalized answer
 * (`updated-plan.md` §5.3, §7.1, §8.3). Pure: the caller persists the result.
 */

type ProgressState = {
  lifecycleState: CardLifecycleState;
  masteryScore: number;
};

const MIN_MASTERY = 0;
const MAX_MASTERY = 10;

const MINUTE_IN_DAYS = 1 / (24 * 60);

// Cards only reach LEARNING so far; the STABLE band table comes with the
// full lifecycle (#7).
const LEARNING_INTERVAL_DAYS: Record<RecallGrade, number> = {
  MISSED: 30 * MINUTE_IN_DAYS,
  PARTIALLY_CORRECT: 1,
  GOOD: 1,
  NAILED: 2,
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function applyAnswer(
  progress: ProgressState,
  recallGrade: RecallGrade,
  now: Date,
) {
  const intervalDays = LEARNING_INTERVAL_DAYS[recallGrade];

  return {
    dueAt: new Date(now.getTime() + intervalDays * DAY_IN_MS),
    lastReviewedAt: now,
    lastIntervalDays: intervalDays,
    lifecycleState:
      progress.lifecycleState === 'NEW' ? 'LEARNING' : progress.lifecycleState,
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
