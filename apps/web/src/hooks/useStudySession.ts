import { useCallback, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { type Flashcard } from '@/lib/cards';
import { type useCardQueue } from './useCardQueue';

type HistoryEntry = {
  card: Flashcard;
  result: 'correct' | 'incorrect';
  userAnswer: string;
};

type StudyState =
  | { phase: 'idle' }
  | { phase: 'answering' }
  | {
      phase: 'result';
      result: 'correct' | 'incorrect';
      userAnswer: string;
      showingBack: boolean;
    }
  | {
      phase: 'reviewing';
      reviewIndex: number;
      showingBack: boolean;
    }
  | { phase: 'complete' };

export function useStudySession(
  deckId: string | undefined,
  cardQueue: ReturnType<typeof useCardQueue>,
) {
  const [studyState, setStudyState] = useState<StudyState>({ phase: 'idle' });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [answerInput, setAnswerInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const startSession = trpc.study.startSession.useMutation({
    onSuccess: (session) => {
      setError(null);
      setSessionId(session.id);
      setAnswerInput('');
      setHistory([]);
      cardQueue.reset();
      setStudyState({ phase: 'answering' });
    },
    onError: () => {
      setError('Failed to start study session. Please try again.');
    },
  });

  const submitAttempt = trpc.study.submitAttempt.useMutation();
  const finishSession = trpc.study.finishSession.useMutation();

  function handleStart() {
    if (!deckId) return;
    startSession.mutate({ deckId });
  }

  async function handleSubmitAnswer() {
    if (studyState.phase !== 'answering' || !sessionId) return;
    if (!answerInput.trim()) return;

    try {
      setError(null);
      const card = cardQueue.currentCard;
      if (!card) return;

      const attempt = await submitAttempt.mutateAsync({
        studySessionId: sessionId,
        cardId: card.id,
        userAnswer: answerInput,
      });
      // The MVP study flow only grades NAILED (correct) or MISSED.
      const result = attempt.recallGrade === 'NAILED' ? 'correct' : 'incorrect';

      setHistory((prev) => [
        ...prev,
        { card, result, userAnswer: answerInput },
      ]);

      setStudyState({
        phase: 'result',
        result,
        userAnswer: answerInput,
        showingBack: true,
      });
    } catch {
      setError('Failed to submit answer. Please try again.');
    }
  }

  const advanceOrFinish = useCallback(
    async (requeue: boolean) => {
      const remainingAfterAdvance =
        cardQueue.queue.length - 1 + (requeue ? 1 : 0);

      if (remainingAfterAdvance === 0) {
        if (sessionId) {
          try {
            await finishSession.mutateAsync({ id: sessionId });
          } catch (err) {
            console.error('Failed to finish study session:', err);
          }
        }
        cardQueue.advance(requeue);
        setStudyState({ phase: 'complete' });
      } else {
        cardQueue.advance(requeue);
        setAnswerInput('');
        setStudyState({ phase: 'answering' });
      }
    },
    [sessionId, cardQueue, finishSession],
  );

  const handleNext = useCallback(async () => {
    if (studyState.phase !== 'result' || !sessionId) return;
    await advanceOrFinish(studyState.result === 'incorrect');
  }, [studyState, sessionId, advanceOrFinish]);

  const handleBack = useCallback(() => {
    if (studyState.phase === 'answering' && history.length > 0) {
      setStudyState({
        phase: 'reviewing',
        reviewIndex: history.length - 1,
        showingBack: true,
      });
    } else if (studyState.phase === 'answering' && history.length === 0) {
      setStudyState({ phase: 'idle' });
    } else if (studyState.phase === 'result' && history.length > 1) {
      setStudyState({
        phase: 'reviewing',
        reviewIndex: history.length - 2,
        showingBack: true,
      });
    } else if (studyState.phase === 'result' && history.length === 1) {
      setStudyState({ phase: 'reviewing', reviewIndex: -1, showingBack: true });
    } else if (studyState.phase === 'reviewing' && studyState.reviewIndex > 0) {
      setStudyState({
        phase: 'reviewing',
        reviewIndex: studyState.reviewIndex - 1,
        showingBack: true,
      });
    } else if (
      studyState.phase === 'reviewing' &&
      studyState.reviewIndex === 0
    ) {
      setStudyState({ phase: 'reviewing', reviewIndex: -1, showingBack: true });
    } else if (studyState.phase === 'complete' && history.length > 0) {
      setStudyState({
        phase: 'reviewing',
        reviewIndex: history.length - 1,
        showingBack: true,
      });
    }
  }, [studyState, history]);

  const handleForward = useCallback(async () => {
    if (studyState.phase !== 'reviewing') return;

    if (studyState.reviewIndex < history.length - 1) {
      setStudyState({
        phase: 'reviewing',
        reviewIndex: studyState.reviewIndex + 1,
        showingBack: true,
      });
    } else {
      // Return to current card (answering or result)
      const lastEntry = history[history.length - 1];
      const currentCard = cardQueue.currentCard;

      if (!currentCard) {
        // Queue exhausted — return to complete screen
        setStudyState({ phase: 'complete' });
        return;
      } else if (currentCard.id !== lastEntry?.card.id) {
        // We're on a new card that hasn't been answered yet
        setStudyState({ phase: 'answering' });
      } else if (lastEntry) {
        // Current card was already answered — advance past it
        await advanceOrFinish(lastEntry.result === 'incorrect');
      }
    }
  }, [studyState, history, cardQueue, advanceOrFinish]);

  const canGoBack =
    studyState.phase === 'answering' ||
    studyState.phase === 'result' ||
    studyState.phase === 'complete' ||
    (studyState.phase === 'reviewing' && studyState.reviewIndex >= 0);

  const reviewEntry =
    studyState.phase === 'reviewing'
      ? history[studyState.reviewIndex]
      : undefined;

  const isFlipped =
    (studyState.phase === 'result' || studyState.phase === 'reviewing') &&
    studyState.showingBack;

  const toggleFlip = useCallback(() => {
    setStudyState((prev) => {
      if (prev.phase === 'result' || prev.phase === 'reviewing') {
        return { ...prev, showingBack: !prev.showingBack };
      }
      return prev;
    });
  }, []);

  const resetToIdle = useCallback(() => {
    setStudyState({ phase: 'idle' });
  }, []);

  return {
    studyState,
    isFlipped,
    toggleFlip,
    answerInput,
    setAnswerInput,
    error,
    history,
    handleStart,
    handleSubmitAnswer,
    handleNext,
    handleBack,
    handleForward,
    canGoBack,
    reviewEntry,
    resetToIdle,
  };
}
