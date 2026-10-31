import { useCallback, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { gradeOf, type GradedAnswer } from '@/lib/recallGrades';

/** One item of a Study Session: a card, or a Retry of a missed one (#11). */
type QueueItem = { itemId: string; card: Flashcard; isRetry: boolean };

/** An answered item, in the order answered: the queue's first items. */
type HistoryEntry = GradedAnswer & { card: Flashcard; isRetry: boolean };

/** A Study Session's queue, in the order the server keeps it. */
type StudySessionQueue = { id: string; items: QueueItem[] };

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
  // Whether the session has been finished on the server
  const [finished, setFinished] = useState(false);
  const [answerInput, setAnswerInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Answers to cards edited since, whose shown grade is for the card as it
  // was, by attempt
  const [editedAfterAnswer, setEditedAfterAnswer] = useState<
    ReadonlySet<string>
  >(new Set());

  // A start under way, set at once so a second press in the same moment
  // sees it, as the mutation's own pending state wouldn't yet
  const startInFlight = useRef(false);
  const startSession = trpc.study.startSession.useMutation({
    onSuccess: (started) => {
      startInFlight.current = false;
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
          isRetry: item.isRetry,
        })),
      });
      setPosition(0);
      setFinished(false);
      setAnswerInput('');
      setHistory([]);
      setStudyState({ phase: 'answering' });
    },
    onError: () => {
      startInFlight.current = false;
      setError('Failed to start study session. Please try again.');
    },
  });

  const submitAnswer = trpc.study.submitAnswer.useMutation();
  const dontKnow = trpc.study.dontKnow.useMutation();
  const finishSession = trpc.study.finishSession.useMutation();
  const acceptAnswer = trpc.study.acceptAnswer.useMutation();

  const items = studySession?.items ?? [];
  const currentItem = items[position] ?? null;
  const currentCard = currentItem?.card ?? null;
  const remainingCount = items.length - position;
  // Progress counts cards, then Retries, which come after them all
  const sessionSize = items.filter((item) => !item.isRetry).length;
  const cardNumber = Math.min(position + 1, sessionSize);
  const retryCount = items.length - sessionSize;
  const retryNumber = position + 1 - sessionSize;
  // Whether a card has a Retry still to come in the session
  const hasRetryWaiting = (cardId: string) =>
    items.some(
      (item, i) =>
        i >= history.length && item.isRetry && item.card.id === cardId,
    );

  /** Starts a Study Session, unless one is already being started. */
  function handleStart() {
    if (!deckId || startInFlight.current) return;
    startInFlight.current = true;
    startSession.mutate({ deckId });
  }

  /** Saves the current card's answer and shows its result. */
  async function answerCurrentCard(userAnswer: string | null) {
    if (studyState.phase !== 'answering' || !currentItem) return;

    try {
      setError(null);
      const { itemId, card, isRetry } = currentItem;
      const attempt =
        userAnswer === null
          ? await dontKnow.mutateAsync({ itemId })
          : await submitAnswer.mutateAsync({ itemId, userAnswer });
      const answered = {
        attemptId: attempt.id,
        userAnswer,
        ...gradeOf(attempt),
      };

      const { retryItem } = attempt;
      if (retryItem) {
        // At the end of the session, as the server queued it
        setStudySession(
          (prev) =>
            prev && {
              ...prev,
              items: [
                ...prev.items,
                { itemId: retryItem.id, card, isRetry: true },
              ],
            },
        );
      }
      setHistory((prev) => [...prev, { card, isRetry, ...answered }]);
      setStudyState({ phase: 'result', ...answered, showingBack: true });
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
      setFinished(true);
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

  /** Shows a card of the session as it now is, wherever it appears. */
  const showCard = useCallback((card: Flashcard) => {
    setStudySession(
      (prev) =>
        prev && {
          ...prev,
          items: prev.items.map((item) =>
            item.card.id === card.id ? { ...item, card } : item,
          ),
        },
    );
    setHistory((prev) =>
      prev.map((entry) =>
        entry.card.id === card.id ? { ...entry, card } : entry,
      ),
    );
  }, []);

  /**
   * "My answer was correct": the answer becomes an Accepted Variant and is
   * graded again, here and in the session's summary.
   */
  async function handleAcceptAnswer(
    attemptId: string,
    canonicalAnswerId?: string,
  ) {
    // It wasn't missed after all, so its Retry is dropped at once, before
    // the learner can move on and leave this render's queue behind
    const answered = history.find((entry) => entry.attemptId === attemptId);
    if (answered) await dropUnanswered(answered.card.id);
    try {
      setError(null);
      const accepted = await acceptAnswer.mutateAsync({
        attemptId,
        canonicalAnswerId,
      });
      const grade = gradeOf(accepted);
      setHistory((prev) =>
        prev.map((entry) =>
          entry.attemptId === attemptId ? { ...entry, ...grade } : entry,
        ),
      );
      setStudyState((prev) =>
        prev.phase === 'result' && prev.attemptId === attemptId
          ? { ...prev, ...grade }
          : prev,
      );
      // A new variant isn't an edit of the card
      showCard(toFlashcard(accepted.card));
    } catch {
      setError("Couldn't accept your answer. Please try again.");
    }
  }

  /**
   * Shows an edit to a card of the session, the one in play or one answered
   * earlier, wherever it appears from now on.
   */
  const replaceCard = useCallback(
    (card: Flashcard) => {
      const answers = history.filter((entry) => entry.card.id === card.id);
      if (answers.length > 0) {
        setEditedAfterAnswer((prev) => {
          const next = new Set(prev);
          for (const entry of answers) next.add(entry.attemptId);
          return next;
        });
      }
      showCard(card);
    },
    [history, showCard],
  );

  /**
   * Drops a card's items from the session: every one, and its answers from
   * the summary, or only those not yet answered. Dropping the card in play
   * moves on to the next card or the end of the session; dropping one being
   * reviewed shows the next answered card, or the title card when none are
   * left, and going forward carries on.
   */
  const dropCard = useCallback(
    async (cardId: string, { keepAnswered }: { keepAnswered: boolean }) => {
      if (!studySession) return;
      // The queue's first items are the answered ones, in the summary's order
      const isDropped = (item: QueueItem | undefined, index: number) =>
        item?.card.id === cardId && !(keepAnswered && index < history.length);
      const { items } = studySession;
      const remaining = items.filter((item, i) => !isDropped(item, i));
      if (remaining.length === items.length) return;
      const answered = keepAnswered
        ? history
        : history.filter((entry) => entry.card.id !== cardId);
      // The items after it move up in the queue
      const nextPosition =
        position -
        items.filter((item, i) => i < position && isDropped(item, i)).length;
      setStudySession({ ...studySession, items: remaining });
      setHistory(answered);
      setPosition(nextPosition);

      if (studyState.phase === 'reviewing') {
        setStudyState({
          phase: 'reviewing',
          reviewIndex: Math.min(studyState.reviewIndex, answered.length - 1),
          showingBack: true,
        });
        return;
      }
      if (!isDropped(items[position], position)) return;

      setAnswerInput('');
      if (nextPosition >= remaining.length) {
        await endSession(remaining.length);
      } else {
        setStudyState({ phase: 'answering' });
      }
    },
    [studySession, history, studyState, position, endSession],
  );

  /** Drops a card deleted from its deck from the session and its summary. */
  const removeCard = useCallback(
    (cardId: string) => dropCard(cardId, { keepAnswered: false }),
    [dropCard],
  );

  /**
   * Drops a card's items not yet answered, such as its Retry once its
   * missed answer is accepted, or once it's marked known; its answers stay.
   */
  const dropUnanswered = useCallback(
    (cardId: string) => dropCard(cardId, { keepAnswered: true }),
    [dropCard],
  );

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
      // Queue exhausted — return to complete screen, finishing the session
      // if dropping the cards left while reviewing emptied it
      if (finished) setStudyState({ phase: 'complete' });
      else await endSession(items.length);
    } else if (history.length <= position) {
      // We're on a card that hasn't been answered yet
      setStudyState({ phase: 'answering' });
    } else {
      // Current card was already answered — advance past it
      await advanceOrFinish();
    }
  }, [
    studyState,
    history,
    currentCard,
    position,
    advanceOrFinish,
    finished,
    endSession,
    items.length,
  ]);

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
    cardNumber,
    sessionSize,
    isRetry: currentItem?.isRetry ?? false,
    retryNumber,
    retryCount,
    hasRetryWaiting,
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
    handleAcceptAnswer,
    isAcceptingAnswer: acceptAnswer.isPending,
    handleFinish: finish,
    replaceCard,
    // A change to a card's variants or primary answer resets nothing, so
    // the card wasn't edited after its answer
    showUnresetChange: showCard,
    removeCard,
    dropUnanswered,
    editedAfterAnswer,
    handleNext,
    handleBack,
    handleForward,
    canGoBack,
    reviewEntry,
  };
}
