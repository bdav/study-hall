/** The system's judgement of one answer to a card (`updated-plan.md` §5.1). */
export type RecallGrade = 'MISSED' | 'PARTIALLY_CORRECT' | 'GOOD' | 'NAILED';

/** One graded answer, as the study screen shows it. */
export type GradedAnswer = {
  recallGrade: RecallGrade;
  // Right except for the accents: shown with the accented form (ADR-0002)
  accentMismatch: boolean;
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
