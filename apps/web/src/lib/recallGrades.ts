/** The system's judgement of one answer to a card (`updated-plan.md` §5.1). */
export type RecallGrade = 'MISSED' | 'PARTIALLY_CORRECT' | 'GOOD' | 'NAILED';

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
