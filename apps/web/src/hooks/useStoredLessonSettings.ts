import { PAGING_VIEW_VALUES, type PagingView } from '@/lib/lessonSteps';
import { useStoredChoice, useStoredFlag } from '@/hooks/useStoredChoice';

/**
 * One at a time or all, for Examples and Practice alike, remembered by the
 * browser: choosing it in either step applies to both.
 */
export function useStoredPagingView() {
  return useStoredChoice<PagingView>(
    'study-hall:paging-view',
    PAGING_VIEW_VALUES,
    'one',
  );
}

/** Practice's two toggles, remembered by the browser. */
export function useStoredPracticeToggles() {
  const [showMyAnswers, setShowMyAnswers] = useStoredFlag(
    'study-hall:practice-my-answers',
    true,
  );
  const [showAnswerKey, setShowAnswerKey] = useStoredFlag(
    'study-hall:practice-answer-key',
    false,
  );
  return { showMyAnswers, setShowMyAnswers, showAnswerKey, setShowAnswerKey };
}

export type PracticeToggles = ReturnType<typeof useStoredPracticeToggles>;
