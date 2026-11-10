import { useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { TRPCClientError } from '@trpc/client';
import { STEADY_QUERY } from '@/lib/steady';
import { trpc } from '@/lib/trpc';
import { type SessionChoice } from '@/lib/sessionChoices';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { gradeOf } from '@/lib/recallGrades';
import {
  initialState,
  studyView,
  transition,
  type SessionItem,
  type StudySessionCommand,
  type StudySessionEvent,
} from '@/lib/studySession';

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
function toItems(session: ServerSession): SessionItem[] {
  return itemsInPlay(session).map((item) => {
    const answer = item.attempts[0];
    return {
      itemId: item.id,
      card: toFlashcard(item.card),
      deckId: item.card.deckId,
      // Each item asks its card its own way (#136)
      direction: item.direction,
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

/**
 * The study page's Study Session: the machine in `lib/studySession.ts`,
 * whose commands this makes through tRPC, feeding their results back in,
 * and the title card's queries. It gives what's on screen (`view`) and the
 * learner's intents (`act`).
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
  // What a session started now would hold, in the options chosen
  const queuePreview = trpc.study.queuePreview.useQuery(
    { deckId: deckId ?? '', ...choice },
    {
      enabled: !!deckId,
      // With nothing to study the title card starts nothing, so look again
      // now and then for cards come due
      refetchInterval: (query) =>
        query.state.data?.sessionSize === 0 ? 60_000 : false,
      ...STEADY_QUERY,
    },
  );
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
          studyMode: started.studyMode,
          items: toItems(started),
        },
      });
    },
    onError: () => {
      send({ type: 'failed', of: 'start' });
    },
  });
  // The Cram Date, kept on the deck, which the title card then counts by
  // (#87)
  const setCramDate = trpc.deck.update.useMutation({
    onSuccess: () => {
      utils.deck.getById.invalidate({ id: deckId });
      utils.study.queuePreview.invalidate({ deckId });
    },
  });
  const submitAnswer = trpc.study.submitAnswer.useMutation();
  const dontKnow = trpc.study.dontKnow.useMutation();
  const finishSession = trpc.study.finishSession.useMutation();
  const acceptAnswer = trpc.study.acceptAnswer.useMutation();
  // Abandoning the unfinished session offers a new one in its place
  const abandonSession = trpc.study.abandonSession.useMutation({
    onSuccess: () => {
      utils.study.activeSession.invalidate({ deckId });
      utils.study.queuePreview.invalidate({ deckId });
    },
  });
  const markKnown = trpc.card.markKnown.useMutation({
    onSuccess: ({ markedCount }, { cardIds }) => {
      for (const cardId of cardIds) {
        send({ type: 'markedKnown', cardId, changed: markedCount > 0 });
        utils.card.history.invalidate({ cardId });
      }
    },
  });

  const retireCard = trpc.card.retire.useMutation();
  const unretireCards = trpc.card.unretire.useMutation();
  const undoRetire = trpc.card.undoRetire.useMutation();

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
        // Graded again, so the card's history shows its new grade
        utils.card.history.invalidate({ cardId: accepted.card.id });
        return;
      }
      case 'abandon':
        abandonSession.mutate({ id: command.sessionId });
        return;
      case 'retire':
        try {
          await retireCard.mutateAsync({ cardIds: [command.cardId] });
        } catch {
          await send({ type: 'failed', of: 'retire' });
          return;
        }
        await send({ type: 'retired', cardId: command.cardId });
        utils.card.history.invalidate({ cardId: command.cardId });
        // The deck's retired count, which offers Review retired, has grown
        utils.deck.getById.invalidate({ id: deckId });
        return;
      case 'undoRetire':
        try {
          // As if it was never retired, so it can be retired again
          await undoRetire.mutateAsync({ cardIds: [command.cardId] });
        } catch {
          await send({ type: 'failed', of: 'unretire' });
          return;
        }
        await send({ type: 'retireUndone', cardId: command.cardId });
        utils.card.history.invalidate({ cardId: command.cardId });
        utils.deck.getById.invalidate({ id: deckId });
        return;
      case 'unretire':
        try {
          await unretireCards.mutateAsync({ cardIds: command.cardIds });
        } catch {
          await send({ type: 'failed', of: 'unretire' });
          return;
        }
        await send({ type: 'unretired', cardIds: command.cardIds });
        // The deck's retired count, and its cards, have changed
        utils.deck.getById.invalidate({ id: deckId });
        utils.card.listByDeck.invalidate({ deckId });
        return;
      case 'markKnown':
        markKnown.mutate({
          cardIds: [command.cardId],
          directions: [command.direction],
        });
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
  const preview = queuePreview.data;
  const isPreviewKept = queuePreview.isPlaceholderData;

  return {
    view: studyView(machine, {
      resumable: !!resumable,
      // A preview kept from other options is only to show: they may have had
      // nothing to study when the ones chosen do
      sessionSize: isPreviewKept ? undefined : preview?.sessionSize,
    }),
    // What a session started now would hold, and the unfinished one, which
    // starting resumes (#10)
    preview,
    isPreviewKept,
    resumable,
    isAcceptingAnswer: acceptAnswer.isPending,
    isUnretiring: unretireCards.isPending,
    cramDateFailed: setCramDate.isError,
    act: {
      /** Sets the deck's Cram Date, or clears it with none. */
      setCramDate: (cramUntil: string | null) => {
        if (deckId) setCramDate.mutate({ id: deckId, cramUntil });
      },
      /** Next: starts a session from the title card, or moves on. */
      next: () => {
        if (deckId) send({ type: 'next' });
      },
      back: () => send({ type: 'back' }),
      flip: () => send({ type: 'flip' }),
      type: (text: string) => send({ type: 'type', text }),
      submit: () => send({ type: 'submit' }),
      dontKnow: () => send({ type: 'dontKnow' }),
      /**
       * "My answer was correct": the answer becomes an Accepted Variant and
       * is graded again; on a card with several answers, it first asks
       * which one is meant.
       */
      accept: (attemptId: string, canonicalAnswerId?: string) =>
        send({ type: 'accept', attemptId, canonicalAnswerId }),
      cancelChoosing: () => send({ type: 'cancelChoosing' }),
      /** Marks the card on screen known, its Retry skipped with it. */
      markKnown: () => send({ type: 'markKnown' }),
      /** "Retire this card?" asks in place, until confirmed or kept (#86). */
      askRetire: () => send({ type: 'askRetire' }),
      keep: () => send({ type: 'keep' }),
      /** Retires the card on screen (#86), its Retry skipped with it. */
      retire: () => send({ type: 'retire' }),
      /** Takes back retiring the card from here, as if it never happened. */
      undoRetire: () => send({ type: 'undoRetire' }),
      /** From a Review retired session's summary, the missed cards chosen. */
      unretire: (cardIds: string[]) => send({ type: 'unretire', cardIds }),
      edit: (onBack = false) => send({ type: 'edit', onBack }),
      stopEditing: () => send({ type: 'stopEditing' }),
      /** Ends the session; unanswered cards are skipped. */
      finish: () => send({ type: 'finish' }),
      /** Abandons the deck's unfinished session, rather than resuming it. */
      abandon: () => {
        if (resumable) send({ type: 'abandon', sessionId: resumable.id });
      },
      /**
       * Back to the title card once a session is over, starting nothing, so
       * another can be chosen and started there (#93): the finished session
       * isn't offered to resume, and what a new one would hold is looked at
       * again.
       */
      startAnother: () => {
        send({ type: 'startAnother' });
        utils.study.activeSession.setData({ deckId: deckId ?? '' }, null);
        utils.study.queuePreview.invalidate({ deckId });
      },
      /** An edit to a card of the session that reset its progress. */
      cardEdited: (card: Flashcard) => send({ type: 'cardEdited', card }),
      /** A change to a card's variants or primary answer, resetting nothing. */
      cardChanged: (card: Flashcard) => send({ type: 'cardChanged', card }),
      cardDeleted: (cardId: string) => send({ type: 'cardDeleted', cardId }),
      /** A card marked known in its editor: its Retry is skipped. */
      dropUnanswered: (cardId: string) =>
        send({ type: 'dropUnanswered', cardId }),
    },
  };
}
