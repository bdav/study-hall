import { useCallback, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { type GradedAnswer } from '@/lib/recallGrades';

type HistoryEntry = GradedAnswer & { card: Flashcard };

/** A Study Session's queue, in the order the server built it. */
type StudySessionQueue = {
  id: string;
  items: { itemId: string; card: Flashcard }[];
};

type StudyState =
  | { phase: 'idle' }
  // The deck has no due or NEW cards, so no session started
  | { phase: 'nothing-due' }
  | { phase: 'answering' }
  | ({ phase: 'result'; showingBack: boolean } & GradedAnswer)
  | {
      phase: 'reviewing';
      reviewIndex: number;
      showingBack: boolean;
    }
  | { phase: 'complete' };

export function useStudySession(deckId: string | undefined) {
  const [studyState, setStudyState] = useState<StudyState>({ phase: 'idle' });
  const [studySession, setStudySession] = useState<StudySessionQueue | null>(
    null,
  );
  // Index of the current item in the session's queue
  const [position, setPosition] = useState(0);
  const [answerInput, setAnswerInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Cards edited after they were answered, whose shown grade is for the
  // card as it was
  const [editedAfterAnswer, setEditedAfterAnswer] = useState<
    ReadonlySet<string>
  >(new Set());

  const startSession = trpc.study.startSession.useMutation({
    onSuccess: (started) => {
      setError(null);
      if (!started) {
        setStudyState({ phase: 'nothing-due' });
        return;
      }
      setStudySession({
        id: started.id,
        items: started.items.map((item) => ({
          itemId: item.id,
          card: toFlashcard(item.card),
        })),
      });
      setPosition(0);
      setAnswerInput('');
      setHistory([]);
      setStudyState({ phase: 'answering' });
    },
    onError: () => {
      setError('Failed to start study session. Please try again.');
    },
  });

  const submitAnswer = trpc.study.submitAnswer.useMutation();
  const dontKnow = trpc.study.dontKnow.useMutation();
  const finishSession = trpc.study.finishSession.useMutation();

  const items = studySession?.items ?? [];
  const currentItem = items[position] ?? null;
  const currentCard = currentItem?.card ?? null;
  const remainingCount = items.length - position;

  function handleStart() {
    if (!deckId) return;
    startSession.mutate({ deckId });
  }

  /** Saves the current card's answer and shows its result. */
  async function answerCurrentCard(userAnswer: string | null) {
    if (studyState.phase !== 'answering' || !currentItem) return;

    try {
      setError(null);
      const { itemId, card } = currentItem;
      const { recallGrade, accentMismatch } =
        userAnswer === null
          ? await dontKnow.mutateAsync({ itemId })
          : await submitAnswer.mutateAsync({ itemId, userAnswer });

      setHistory((prev) => [
        ...prev,
        { card, recallGrade, accentMismatch, userAnswer },
      ]);

      setStudyState({
        phase: 'result',
        recallGrade,
        accentMismatch,
        userAnswer,
        showingBack: true,
      });
    } catch {
      setError('Failed to submit answer. Please try again.');
    }
  }

  async function handleSubmitAnswer() {
    if (!answerInput.trim()) return;
    await answerCurrentCard(answerInput);
  }

  async function handleDontKnow() {
    await answerCurrentCard(null);
  }

  /**
   * Ends the session; unanswered cards are skipped. Takes the queue's
   * length, which deleting a card changes before the state catches up.
   */
  const endSession = useCallback(
    async (queueLength: number) => {
      if (studySession) {
        try {
          setError(null);
          await finishSession.mutateAsync({ id: studySession.id });
        } catch {
          setError('Failed to finish study session. Please try again.');
          return;
        }
      }
      setPosition(queueLength);
      setStudyState({ phase: 'complete' });
    },
    [studySession, finishSession],
  );

  /** Ends the session, at its last card or early. */
  const finish = useCallback(
    () => endSession(items.length),
    [endSession, items.length],
  );

  /** Shows an edit to the current card for the rest of the session. */
  const replaceCurrentCard = useCallback(
    (card: Flashcard) => {
      if (history.some((entry) => entry.card.id === card.id)) {
        setEditedAfterAnswer((prev) => new Set(prev).add(card.id));
      }
      setStudySession(
        (prev) =>
          prev && {
            ...prev,
            items: prev.items.map((item) =>
              item.card.id === card.id ? { ...item, card } : item,
            ),
          },
      );
    },
    [history],
  );

  /**
   * Drops the current card, deleted from its deck, from the session and its
   * summary, and moves on to the next card or the end of the session.
   */
  const removeCurrentCard = useCallback(async () => {
    if (!studySession || !currentItem) return;
    const remaining = studySession.items.filter(
      (item) => item.itemId !== currentItem.itemId,
    );
    setStudySession({ ...studySession, items: remaining });
    setHistory((prev) =>
      prev.filter((entry) => entry.card.id !== currentItem.card.id),
    );
    setAnswerInput('');
    if (position >= remaining.length) {
      await endSession(remaining.length);
    } else {
      setStudyState({ phase: 'answering' });
    }
  }, [studySession, currentItem, position, endSession]);

  const advanceOrFinish = useCallback(async () => {
    if (position + 1 >= items.length) {
      await finish();
    } else {
      setPosition(position + 1);
      setAnswerInput('');
      setStudyState({ phase: 'answering' });
    }
  }, [position, items.length, finish]);

  const handleNext = useCallback(async () => {
    if (studyState.phase !== 'result') return;
    await advanceOrFinish();
  }, [studyState, advanceOrFinish]);

  const handleBack = useCallback(() => {
    if (studyState.phase === 'answering' && history.length > 0) {
      setStudyState({
        phase: 'reviewing',
        reviewIndex: history.length - 1,
        showingBack: true,
      });
    } else if (studyState.phase === 'answering' && history.length === 0) {
      // Back to the title card, still inside this session: going forward
      // resumes it rather than starting another
      setStudyState({ phase: 'reviewing', reviewIndex: -1, showingBack: true });
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
    } else if (!currentCard) {
      // Queue exhausted — return to complete screen
      setStudyState({ phase: 'complete' });
    } else if (history.length <= position) {
      // We're on a card that hasn't been answered yet
      setStudyState({ phase: 'answering' });
    } else {
      // Current card was already answered — advance past it
      await advanceOrFinish();
    }
  }, [studyState, history, currentCard, position, advanceOrFinish]);

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

  return {
    studyState,
    currentCard,
    position,
    sessionSize: items.length,
    remainingCount,
    isFlipped,
    toggleFlip,
    answerInput,
    setAnswerInput,
    error,
    history,
    handleStart,
    handleSubmitAnswer,
    handleDontKnow,
    handleFinish: finish,
    replaceCurrentCard,
    removeCurrentCard,
    editedAfterAnswer,
    handleNext,
    handleBack,
    handleForward,
    canGoBack,
    reviewEntry,
  };
}
