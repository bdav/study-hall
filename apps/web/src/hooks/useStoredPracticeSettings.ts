import { PRACTICE_VIEWS, type PracticeView } from '@/lib/lessonSteps';
import { useStoredChoice, useStoredFlag } from '@/hooks/useStoredChoice';

/**
 * How the learner has Practice set up, remembered by the browser: the view
 * (shared with Examples, #55) and the two toggles.
 */
export function useStoredPracticeSettings() {
  const [view, setView] = useStoredChoice<PracticeView>(
    'study-hall:paging-view',
    PRACTICE_VIEWS.map((option) => option.value),
    'one',
  );
  const [showMyAnswers, setShowMyAnswers] = useStoredFlag(
    'study-hall:practice-my-answers',
    true,
  );
  const [showAnswerKey, setShowAnswerKey] = useStoredFlag(
    'study-hall:practice-answer-key',
    false,
  );
  return {
    view,
    setView,
    showMyAnswers,
    setShowMyAnswers,
    showAnswerKey,
    setShowAnswerKey,
  };
}

export type StoredPracticeSettings = ReturnType<
  typeof useStoredPracticeSettings
>;
