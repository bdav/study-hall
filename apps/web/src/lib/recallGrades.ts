/** The system's judgement of one answer to a card (`updated-plan.md` §5.1). */
export type RecallGrade = 'MISSED' | 'PARTIALLY_CORRECT' | 'GOOD' | 'NAILED';

/** One graded answer, as the study screen shows it. */
export type GradedAnswer = {
  // The Card Attempt that recorded it
  attemptId: string;
  recallGrade: RecallGrade;
  // Right except for the accents: shown with the accented form (ADR-0002)
  accentMismatch: boolean;
  // The Accepted Variant the answer matched, or null when it matched the
  // Canonical Answer or nothing
  matchedVariant: string | null;
  // null when the learner chose "I don't know"
  userAnswer: string | null;
};

export const recallGradeLabels: Record<RecallGrade, string> = {
  MISSED: 'Needs review',
  PARTIALLY_CORRECT: 'Partially correct',
  GOOD: 'Good',
  NAILED: 'Nailed it',
};

export const recallGradeColors: Record<RecallGrade, string> = {
  MISSED: 'bg-red-400',
  PARTIALLY_CORRECT: 'bg-amber-500',
  GOOD: 'bg-green-500',
  NAILED: 'bg-green-500',
};
