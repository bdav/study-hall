/** The system's judgement of one answer to a card (`updated-plan.md` §5.1). */
export type RecallGrade = 'MISSED' | 'PARTIALLY_CORRECT' | 'GOOD' | 'NAILED';

/** How an answer was graded. */
export type Grade = {
  recallGrade: RecallGrade;
  // Right except for the accents: shown with the accented form (ADR-0002)
  accentMismatch: boolean;
  // The Canonical Answer the answer matched, itself or through a variant
  matchedAnswer: string | null;
  // The Accepted Variant the answer matched, if it matched one
  matchedVariant: string | null;
};

/** One graded answer, as the study screen shows it. */
export type GradedAnswer = Grade & {
  // The Card Attempt that recorded it
  attemptId: string;
  // null when the learner chose "I don't know"
  userAnswer: string | null;
};

/** The grade in a grading result, such as an answer's or a re-grade's. */
export function gradeOf({
  recallGrade,
  accentMismatch,
  matchedAnswer,
  matchedVariant,
}: Grade): Grade {
  return { recallGrade, accentMismatch, matchedAnswer, matchedVariant };
}

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
