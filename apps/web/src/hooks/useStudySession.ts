import { useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { TRPCClientError } from '@trpc/client';
import { trpc } from '@/lib/trpc';
import { type SessionChoice } from '@/lib/sessionChoices';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { gradeOf, type GradedAnswer } from '@/lib/recallGrades';
import {
  canGoBack,
  initialState,
  transition,
  type Failure,
  type SessionItem,
  type StudySessionCommand,
  type StudySessionEvent,
  type StudySessionState,
} from '@/lib/studySession';

/** An answered item, in the order answered: the session's first items. */
type HistoryEntry = GradedAnswer & { card: Flashcard; isRetry: boolean };

/** A Study Session as the server returns it, new or unfinished. */
type ServerSession = NonNullable<
  inferRouterOutputs<AppRouter>['study']['activeSession']
>;

/**
 * A session's items still in play: those answered, then those to come;
 * items skipped, such as a card marked known, are done with.
 */
function itemsInPlay(session: ServerSession) {
  return session.items.filter(
    (item) =>
      item.status === 'PENDING' ||
      (item.status === 'COMPLETED' && item.attempts.length > 0),
  );
}

/**
 * The items of a session the server returns, a new one or one being
 * resumed, with its deck and Study Direction. An answer is shown with its
 * grade; how it matched isn't kept, so isn't shown.
 */
function toItems(session: ServerSession, deckId: string): SessionItem[] {
  return itemsInPlay(session).map((item) => {
    const answer = item.attempts[0];
    return {
      itemId: item.id,
      card: toFlashcard(item.card),
      deckId,
      direction: session.direction,
      isRetry: item.isRetry,
      answer: answer
        ? {
            attemptId: answer.id,
            userAnswer: answer.userAnswer,
            recallGrade: answer.recallGrade,
            accentMismatch: false,
            matchedAnswer: null,
            matchedVariant: null,
            otherFront: null,
            editedAfter: false,
          }
        : null,
    };
  });
}

/** How far an unfinished session got: its cards answered of its size. */
function progressOf(session: ServerSession) {
  const cards = itemsInPlay(session).filter((item) => !item.isRetry);
  return {
    answered: cards.filter((item) => item.status === 'COMPLETED').length,
    size: cards.length,
  };
}

const failureMessages: Record<Failure, string> = {
  start: 'Failed to start study session. Please try again.',
  answer: 'Failed to submit answer. Please try again.',
  finish: 'Failed to finish study session. Please try again.',
  accept: "Couldn't accept your answer. Please try again.",
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

/** The machine's state as the study page reads it. */
function toStudyState({
  session,
  view,
  flipped,
}: StudySessionState): StudyState {
  if (session.status === 'not-started' || session.status === 'starting') {
    return { phase: 'idle' };
  }
  if (session.status === 'nothing-due') return { phase: 'nothing-due' };
  switch (view.at) {
    case 'summary':
      return { phase: 'complete' };
    case 'title':
      // Back to the title card, still inside this session: going forward
      // resumes it rather than starting another
      return { phase: 'reviewing', reviewIndex: -1, showingBack: flipped };
    case 'answered':
      return {
        phase: 'reviewing',
        reviewIndex: view.index,
        showingBack: flipped,
      };
    case 'play': {
      const answer = session.items[session.position]?.answer;
      return answer
        ? { phase: 'result', ...answer, showingBack: flipped }
        : { phase: 'answering' };
    }
  }
}

/**
 * The study page's Study Session: the machine in `lib/studySession.ts`,
 * whose commands this makes through tRPC, feeding their results back in.
 */
export function useStudySession(
  deckId: string | undefined,
  choice: SessionChoice,
) {
  const [machine, setMachine] = useState(initialState);
  // The machine as of the latest event, so events in the same moment, such
  // as a second press of Start, each see the one before
  const latest = useRef(initialState);

  const utils = trpc.useUtils();
  const finishSession = trpc.study.finishSession.useMutation();
  // The deck's unfinished session, which starting resumes; not kept once
  // off screen, so a session finished since isn't offered meanwhile
  const activeSession = trpc.study.activeSession.useQuery(
    { deckId: deckId ?? '' },
    { enabled: !!deckId, gcTime: 0 },
  );
  const startSession = trpc.study.startSession.useMutation({
    onSuccess: (started) => {
      send({
        type: 'started',
        session: started && {
          id: started.id,
          items: toItems(started, deckId ?? ''),
        },
      });
    },
    onError: () => {
      send({ type: 'failed', of: 'start' });
    },
  });
  const submitAnswer = trpc.study.submitAnswer.useMutation();
  const dontKnow = trpc.study.dontKnow.useMutation();
  const acceptAnswer = trpc.study.acceptAnswer.useMutation();
  // Abandoning the unfinished session offers a new one in its place
  const abandonSession = trpc.study.abandonSession.useMutation({
    onSuccess: () => {
      utils.study.activeSession.invalidate({ deckId });
      utils.study.queuePreview.invalidate({ deckId });
    },
  });

  /** Moves the machine on, making the server calls it asks for. */
  async function send(event: StudySessionEvent) {
    const { state, commands } = transition(latest.current, event);
    latest.current = state;
    setMachine(state);
    await Promise.all(commands.map(run));
  }

  async function run(command: StudySessionCommand) {
    switch (command.type) {
      case 'start':
        if (deckId) startSession.mutate({ deckId, ...choice });
        return;
      case 'submit': {
        const { itemId, userAnswer } = command;
        let attempt;
        try {
          attempt =
            userAnswer === null
              ? await dontKnow.mutateAsync({ itemId })
              : await submitAnswer.mutateAsync({ itemId, userAnswer });
        } catch (err) {
          // Answering a card refuses only this with PRECONDITION_FAILED
          if (
            err instanceof TRPCClientError &&
            err.data?.code === 'PRECONDITION_FAILED'
          ) {
            await send({ type: 'refused', itemId, message: err.message });
          } else {
            await send({ type: 'failed', of: 'answer' });
          }
          return;
        }
        await send({
          type: 'graded',
          itemId,
          answer: {
            attemptId: attempt.id,
            userAnswer,
            ...gradeOf(attempt),
            otherFront: attempt.otherFront ?? null,
          },
          retryItemId: attempt.retryItem?.id ?? null,
        });
        return;
      }
      case 'finish':
        // A session resumed with every card answered is complete already;
        // the server only needs telling
        if (latest.current.session.status === 'complete') {
          finishSession.mutate({ id: command.sessionId });
          return;
        }
        try {
          await finishSession.mutateAsync({ id: command.sessionId });
        } catch {
          await send({ type: 'failed', of: 'finish' });
          return;
        }
        await send({ type: 'finished' });
        return;
      case 'accept': {
        const { attemptId, canonicalAnswerId } = command;
        let accepted;
        try {
          accepted = await acceptAnswer.mutateAsync({
            attemptId,
            canonicalAnswerId,
          });
        } catch {
          await send({ type: 'failed', of: 'accept' });
          return;
        }
        await send({
          type: 'accepted',
          attemptId,
          grade: gradeOf(accepted),
          card: toFlashcard(accepted.card),
        });
        return;
      }
      case 'abandon':
        abandonSession.mutate({ id: command.sessionId });
        return;
    }
  }

  const resumable = activeSession.data
    ? {
        id: activeSession.data.id,
        direction: activeSession.data.direction,
        ...progressOf(activeSession.data),
      }
    : null;

  const studyState = toStudyState(machine);
  const { session } = machine;
  const items = 'items' in session ? session.items : [];
  const position = 'position' in session ? session.position : 0;
  const history: HistoryEntry[] = items.flatMap(({ card, isRetry, answer }) =>
    answer ? [{ card, isRetry, ...answer }] : [],
  );
  const currentItem = items[position] ?? null;
  // Progress counts cards, then Retries, which come after them all
  const sessionSize = items.filter((item) => !item.isRetry).length;
  const retryCount = items.length - sessionSize;
  // Whether a card has a Retry still to come in the session
  const hasRetryWaiting = (cardId: string) =>
    items.some(
      (item, i) =>
        i >= history.length && item.isRetry && item.card.id === cardId,
    );

  return {
    studyState,
    // The session's own direction, once one has started or resumed
    direction: items[0]?.direction ?? choice.direction,
    resumable,
    /** Abandons the deck's unfinished session, rather than resuming it. */
    handleAbandon: () => {
      if (resumable) send({ type: 'abandon', sessionId: resumable.id });
    },
    currentCard: currentItem?.card ?? null,
    cardNumber: Math.min(position + 1, sessionSize),
    sessionSize,
    isRetry: currentItem?.isRetry ?? false,
    retryNumber: position + 1 - sessionSize,
    retryCount,
    hasRetryWaiting,
    remainingCount: items.length - position,
    isFlipped:
      (studyState.phase === 'result' || studyState.phase === 'reviewing') &&
      studyState.showingBack,
    toggleFlip: () => send({ type: 'flip' }),
    answerInput: machine.answerInput,
    setAnswerInput: (text: string) => send({ type: 'type', text }),
    error: machine.failure && failureMessages[machine.failure],
    // Shown only while the item refused is the one to answer
    refusal:
      machine.refusal && machine.refusal.itemId === currentItem?.itemId
        ? machine.refusal.message
        : null,
    history,
    /**
     * Starts a Study Session, or resumes the deck's unfinished one, unless
     * one is already being started.
     */
    handleStart: () => {
      if (deckId) send({ type: 'start' });
    },
    handleSubmitAnswer: () => send({ type: 'submit' }),
    handleDontKnow: () => send({ type: 'dontKnow' }),
    /**
     * "My answer was correct": the answer becomes an Accepted Variant and is
     * graded again, here and in the session's summary.
     */
    handleAcceptAnswer: (attemptId: string, canonicalAnswerId?: string) =>
      send({ type: 'accept', attemptId, canonicalAnswerId }),
    isAcceptingAnswer: acceptAnswer.isPending,
    /** Ends the session; unanswered cards are skipped. */
    handleFinish: () => send({ type: 'finish' }),
    /**
     * Back to the title card once a session is over, starting nothing, so
     * another can be chosen and started there (#93): the finished session
     * isn't offered to resume, and what a new one would hold is looked at
     * again.
     */
    returnToTitle: () => {
      send({ type: 'startAnother' });
      utils.study.activeSession.setData({ deckId: deckId ?? '' }, null);
      utils.study.queuePreview.invalidate({ deckId });
    },
    /**
     * Shows an edit to a card of the session, the one in play or one
     * answered earlier, wherever it appears from now on.
     */
    replaceCard: (card: Flashcard) => send({ type: 'cardEdited', card }),
    // A change to a card's variants or primary answer resets nothing, so
    // the card wasn't edited after its answer
    showUnresetChange: (card: Flashcard) => send({ type: 'cardChanged', card }),
    /** Drops a card deleted from its deck from the session and its summary. */
    removeCard: (cardId: string) => send({ type: 'cardDeleted', cardId }),
    /**
     * Drops a card's items not yet answered, such as its Retry once its
     * missed answer is accepted, or once it's marked known; its answers stay.
     */
    dropUnanswered: (cardId: string) =>
      send({ type: 'dropUnanswered', cardId }),
    // Answers to cards edited since, whose shown grade is for the card as it
    // was, by attempt
    editedAfterAnswer: new Set(
      items.flatMap(({ answer }) =>
        answer?.editedAfter ? [answer.attemptId] : [],
      ),
    ) as ReadonlySet<string>,
    handleNext: () => send({ type: 'next' }),
    handleBack: () => send({ type: 'back' }),
    handleForward: () => send({ type: 'next' }),
    canGoBack: canGoBack(machine),
    reviewEntry:
      studyState.phase === 'reviewing'
        ? history[studyState.reviewIndex]
        : undefined,
  };
}
