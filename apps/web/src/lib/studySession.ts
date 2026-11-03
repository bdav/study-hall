import { type Flashcard } from '@/lib/cards';
import { type StudyDirection } from '@/lib/directions';
import { type Grade, type GradedAnswer } from '@/lib/recallGrades';

/**
 * The study screen's Study Session as a pure state machine (#102): each
 * event, a learner's intent or a server's result, gives the next state and
 * the server calls to make, its commands. `useStudySession` makes the
 * calls and feeds their results back in.
 */

/** An item's answer: its grade, and whether its card was edited since. */
export type ItemAnswer = GradedAnswer & { editedAfter: boolean };

/**
 * One item of a Study Session: a card, or a Retry of a missed one (#11),
 * with its deck and the Study Direction it's asked in, and its answer once
 * given.
 */
export type SessionItem = {
  itemId: string;
  card: Flashcard;
  deckId: string;
  direction: StudyDirection;
  isRetry: boolean;
  answer: ItemAnswer | null;
};

/** A started session's items, answered first, and the item in play. */
type Started = {
  id: string;
  items: SessionItem[];
  // Index of the item in play; the items before it are answered
  position: number;
};

type Session =
  | { status: 'not-started' }
  | { status: 'starting' }
  // The deck had no due or NEW cards, so no session started
  | { status: 'nothing-due' }
  | ({ status: 'in-progress' } & Started)
  // Finished on the server, its items all done with
  | ({ status: 'complete' } & Started);

/**
 * What's on screen: the title card, an answered item gone back to, by its
 * index, the item in play, or the summary.
 */
type View =
  | { at: 'title' }
  | { at: 'answered'; index: number }
  | { at: 'play' }
  | { at: 'summary' };

/** A server call that failed, leaving the session where it was. */
export type Failure = 'start' | 'answer' | 'finish' | 'accept';

export type StudySessionState = {
  session: Session;
  view: View;
  // Whether an answered card on screen shows its back
  flipped: boolean;
  // The answer being typed to the card in play
  answerInput: string;
  // Why the answer just typed to an item wasn't graded, the card staying in
  // play: a front already given for a card sharing its answer (#96)
  refusal: { itemId: string; message: string } | null;
  // The latest call to fail, until one succeeds or another is made
  failure: Failure | null;
};

export type StudySessionEvent =
  | { type: 'start' }
  // A new session, or an unfinished one resumed with its answers so far;
  // none when there's nothing to study
  | {
      type: 'started';
      session: { id: string; items: SessionItem[] } | null;
    }
  | { type: 'type'; text: string }
  | { type: 'submit' }
  | { type: 'dontKnow' }
  // An item's answer graded, with the Retry it queued if it was missed
  | {
      type: 'graded';
      itemId: string;
      answer: GradedAnswer;
      retryItemId: string | null;
    }
  | { type: 'next' }
  | { type: 'back' }
  // Turns an answered card on screen over
  | { type: 'flip' }
  // Ends the session early, its cards still to come skipped
  | { type: 'finish' }
  | { type: 'finished' }
  // A card of the session edited, its progress reset, so its answers so far
  // were graded for the card as it was
  | { type: 'cardEdited'; card: Flashcard }
  // A card's variants or primary answer changed, which resets nothing
  | { type: 'cardChanged'; card: Flashcard }
  // Back to the title card once a session is over, starting nothing, so
  // another can be chosen and started there (#93)
  | { type: 'startAnother' }
  // Ends the unfinished session the title card offers to resume
  | { type: 'abandon'; sessionId: string }
  // "My answer was correct", for an answer by its attempt, saying which
  // Canonical Answer it's another way of saying when the card has several
  | { type: 'accept'; attemptId: string; canonicalAnswerId?: string }
  // The answer accepted, graded again, its card with the new variant
  | { type: 'accepted'; attemptId: string; grade: Grade; card: Flashcard }
  // A card deleted from its deck, dropped from the session and its summary
  | { type: 'cardDeleted'; cardId: string }
  // Drops a card's items still to come, such as its Retry, keeping its
  // answers: a card marked known is done with in the session
  | { type: 'dropUnanswered'; cardId: string }
  // An answer not graded, the card staying in play
  | { type: 'refused'; itemId: string; message: string }
  | { type: 'failed'; of: Failure };

export type StudySessionCommand =
  | { type: 'start' }
  // An answer to an item, none for "I don't know"
  | { type: 'submit'; itemId: string; userAnswer: string | null }
  | { type: 'accept'; attemptId: string; canonicalAnswerId?: string }
  | { type: 'finish'; sessionId: string }
  | { type: 'abandon'; sessionId: string };

export const initialState: StudySessionState = {
  session: { status: 'not-started' },
  view: { at: 'title' },
  flipped: false,
  answerInput: '',
  refusal: null,
  failure: null,
};

/** A session started, in progress or complete, with its items. */
function isUnderWay(
  session: Session,
): session is Extract<Session, { status: 'in-progress' | 'complete' }> {
  return session.status === 'in-progress' || session.status === 'complete';
}

/** The next state, with no server calls to make. */
function noCommands(state: StudySessionState) {
  return { state, commands: [] };
}

function failed(state: StudySessionState, of: Failure): StudySessionState {
  if (of === 'start') {
    return { ...state, session: { status: 'not-started' }, failure: of };
  }
  // Already complete, as a resumed session every card of which was
  // answered is, so there's nothing to try again
  if (of === 'finish' && state.session.status === 'complete') return state;
  return { ...state, failure: of };
}

/** The item in play while it's on screen to be answered, if it is. */
function itemToAnswer(state: StudySessionState) {
  const { session, view } = state;
  if (session.status !== 'in-progress' || view.at !== 'play') return null;
  const item = session.items[session.position];
  return item && !item.answer ? item : null;
}

/** Answers the item in play, none being "I don't know". */
function answer(state: StudySessionState, userAnswer: string | null) {
  const item = itemToAnswer(state);
  if (!item) return noCommands(state);
  return {
    state: { ...state, refusal: null, failure: null },
    commands: [{ type: 'submit' as const, itemId: item.itemId, userAnswer }],
  };
}

/** Ends the session on the server, at its last card or early. */
function finish(state: StudySessionState) {
  if (state.session.status !== 'in-progress') return noCommands(state);
  return {
    state: { ...state, failure: null },
    commands: [{ type: 'finish' as const, sessionId: state.session.id }],
  };
}

/** From a graded card in play, the next card, or the end of the session. */
function advance(state: StudySessionState) {
  const { session } = state;
  if (session.status !== 'in-progress') return noCommands(state);
  if (session.position + 1 >= session.items.length) return finish(state);
  return noCommands({
    ...state,
    session: { ...session, position: session.position + 1 },
    view: { at: 'play' },
    answerInput: '',
  });
}

/** How many of a session's items are answered: the first ones. */
function answeredCount(items: SessionItem[]) {
  return items.filter((item) => item.answer).length;
}

/** Where the card on screen falls among the items: the summary after them. */
function onScreenIndex(session: Started, view: View) {
  switch (view.at) {
    case 'title':
      return -1;
    case 'answered':
      return view.index;
    case 'play':
      return session.position;
    case 'summary':
      return answeredCount(session.items);
  }
}

/** Back to the answered card before the one on screen, or the title card. */
function back(state: StudySessionState): StudySessionState {
  const { session, view } = state;
  if (!isUnderWay(session)) return state;
  const onScreen = onScreenIndex(session, view);
  // Nothing before the title card, nor before a summary with no answers
  if (onScreen < 0 || (view.at === 'summary' && onScreen === 0)) return state;
  return {
    ...state,
    view:
      onScreen > 0 ? { at: 'answered', index: onScreen - 1 } : { at: 'title' },
    flipped: true,
  };
}

/**
 * Forward from the title card or an answered card gone back to: the next
 * answered card, then the card in play, moving past it if it's answered,
 * or the summary.
 */
function forward(state: StudySessionState, from: number) {
  const { session } = state;
  if (!isUnderWay(session)) return noCommands(state);
  if (from + 1 < answeredCount(session.items)) {
    return noCommands({
      ...state,
      view: { at: 'answered', index: from + 1 },
      flipped: true,
    });
  }
  const inPlay = session.items[session.position];
  if (!inPlay) {
    // No cards left: dropping those still to come may have left none
    if (session.status === 'complete') {
      return noCommands({ ...state, view: { at: 'summary' } });
    }
    return finish(state);
  }
  if (!inPlay.answer) return noCommands({ ...state, view: { at: 'play' } });
  return advance(state);
}

/**
 * Shows a card of the session as it now is, wherever it appears, marking
 * its answers so far edited after when the change reset its progress.
 */
function showCard(
  state: StudySessionState,
  card: Flashcard,
  { resetsProgress }: { resetsProgress: boolean },
): StudySessionState {
  const { session } = state;
  if (!isUnderWay(session)) return state;
  const items = session.items.map((item) =>
    item.card.id !== card.id
      ? item
      : {
          ...item,
          card,
          answer:
            item.answer && resetsProgress
              ? { ...item.answer, editedAfter: true }
              : item.answer,
        },
  );
  return { ...state, session: { ...session, items } };
}

/**
 * Drops a card's items from the session: every one, its answers with them,
 * or only those not yet answered. Dropping the card in play moves on to the
 * next card or the end of the session; dropping one gone back to shows the
 * answered card before it, or the title card when none are left, and going
 * forward carries on.
 */
function dropCard(
  state: StudySessionState,
  cardId: string,
  { keepAnswered }: { keepAnswered: boolean },
) {
  const { session, view } = state;
  if (!isUnderWay(session)) return noCommands(state);
  const isDropped = (item: SessionItem | undefined) =>
    item?.card.id === cardId && !(keepAnswered && item.answer);
  const { items, position } = session;
  const remaining = items.filter((item) => !isDropped(item));
  if (remaining.length === items.length) return noCommands(state);
  // The items after it move up in the queue
  const nextPosition =
    position - items.slice(0, position).filter(isDropped).length;
  const dropped: StudySessionState = {
    ...state,
    session: { ...session, items: remaining, position: nextPosition },
  };

  if (view.at === 'title' || view.at === 'answered') {
    const index = Math.min(
      view.at === 'answered' ? view.index : -1,
      answeredCount(remaining) - 1,
    );
    return noCommands({
      ...dropped,
      view: index >= 0 ? { at: 'answered', index } : { at: 'title' },
      flipped: true,
    });
  }
  if (view.at !== 'play' || !isDropped(items[position])) {
    return noCommands(dropped);
  }
  const movedOn = { ...dropped, answerInput: '' };
  if (nextPosition >= remaining.length) return finish(movedOn);
  return noCommands(movedOn);
}

/** The item an answer was given to, by its attempt. */
function answeredItem(state: StudySessionState, attemptId: string) {
  const { session } = state;
  if (!isUnderWay(session)) return undefined;
  return session.items.find((item) => item.answer?.attemptId === attemptId);
}

export function transition(
  state: StudySessionState,
  event: StudySessionEvent,
): { state: StudySessionState; commands: StudySessionCommand[] } {
  switch (event.type) {
    case 'start':
      // Once, from the title card, however often it's pressed (#81)
      if (state.session.status !== 'not-started') return noCommands(state);
      return {
        state: { ...state, session: { status: 'starting' } },
        commands: [{ type: 'start' }],
      };
    case 'started': {
      state = { ...state, failure: null };
      if (!event.session) {
        return noCommands({ ...state, session: { status: 'nothing-due' } });
      }
      const { id, items } = event.session;
      const answered = answeredCount(items);
      if (answered === items.length) {
        // Every card answered, but not yet finished
        return {
          state: {
            ...state,
            session: { status: 'complete', id, items, position: answered },
            view: { at: 'summary' },
          },
          commands: [{ type: 'finish', sessionId: id }],
        };
      }
      return noCommands({
        ...state,
        session: { status: 'in-progress', id, items, position: answered },
        view: { at: 'play' },
      });
    }
    case 'type':
      return noCommands({ ...state, answerInput: event.text });
    case 'submit':
      if (!state.answerInput.trim()) return noCommands(state);
      return answer(state, state.answerInput);
    case 'dontKnow':
      return answer(state, null);
    case 'graded': {
      const { session } = state;
      if (session.status !== 'in-progress') return noCommands(state);
      const answered = session.items.find(
        (item) => item.itemId === event.itemId,
      );
      if (!answered || answered.answer) return noCommands(state);
      const items = session.items.map((item) =>
        item === answered
          ? { ...item, answer: { ...event.answer, editedAfter: false } }
          : item,
      );
      if (event.retryItemId) {
        // At the end of the session, as the server queued it
        items.push({
          ...answered,
          itemId: event.retryItemId,
          isRetry: true,
          answer: null,
        });
      }
      return noCommands({
        ...state,
        session: { ...session, items },
        flipped: true,
      });
    }
    case 'next': {
      const { session, view } = state;
      if (view.at === 'title') return forward(state, -1);
      if (view.at === 'answered') return forward(state, view.index);
      if (session.status !== 'in-progress' || view.at !== 'play') {
        return noCommands(state);
      }
      if (!session.items[session.position]?.answer) return noCommands(state);
      return advance(state);
    }
    case 'back':
      return noCommands(back(state));
    case 'flip':
      return noCommands({ ...state, flipped: !state.flipped });
    case 'finish':
      return finish(state);
    case 'finished': {
      const { session } = state;
      if (session.status !== 'in-progress') return noCommands(state);
      return noCommands({
        ...state,
        session: {
          ...session,
          status: 'complete',
          position: session.items.length,
        },
        view: { at: 'summary' },
      });
    }
    case 'cardEdited':
      return noCommands(showCard(state, event.card, { resetsProgress: true }));
    case 'cardChanged':
      return noCommands(showCard(state, event.card, { resetsProgress: false }));
    case 'cardDeleted':
      return dropCard(state, event.cardId, { keepAnswered: false });
    case 'dropUnanswered':
      return dropCard(state, event.cardId, { keepAnswered: true });
    case 'startAnother':
      return noCommands(initialState);
    case 'abandon':
      return {
        state,
        commands: [{ type: 'abandon', sessionId: event.sessionId }],
      };
    case 'accept': {
      // It wasn't missed after all, so its Retry is dropped at once, before
      // the learner can move on
      const accepted = answeredItem(state, event.attemptId);
      const dropped = accepted
        ? dropCard(state, accepted.card.id, { keepAnswered: true })
        : noCommands(state);
      return {
        state: { ...dropped.state, failure: null },
        commands: [
          ...dropped.commands,
          {
            type: 'accept',
            attemptId: event.attemptId,
            canonicalAnswerId: event.canonicalAnswerId,
          },
        ],
      };
    }
    case 'accepted': {
      const { session } = state;
      if (!isUnderWay(session)) return noCommands(state);
      const items = session.items.map((item) =>
        item.answer?.attemptId === event.attemptId
          ? { ...item, answer: { ...item.answer, ...event.grade } }
          : item,
      );
      // A new variant isn't an edit of the card
      return noCommands(
        showCard({ ...state, session: { ...session, items } }, event.card, {
          resetsProgress: false,
        }),
      );
    }
    case 'refused':
      return noCommands({
        ...state,
        answerInput: '',
        refusal: { itemId: event.itemId, message: event.message },
      });
    case 'failed':
      return noCommands(failed(state, event.of));
  }
}

/**
 * What the title card's queries say: whether there's an unfinished session
 * to resume, and how many cards a new one would hold, once known.
 */
export type TitleCardData = { resumable: boolean; sessionSize?: number };

/**
 * Whether the title card starts a session: before one, unless the mode
 * chosen has nothing to study and there's none to resume, when another
 * mode or length can be chosen.
 */
export function canStart(state: StudySessionState, title: TitleCardData) {
  const { status } = state.session;
  if (status !== 'not-started' && status !== 'starting') return false;
  return title.resumable || title.sessionSize !== 0;
}

/** Whether Previous goes back: from anything but the title card. */
export function canGoBack(state: StudySessionState) {
  const { session, view } = state;
  if (!isUnderWay(session)) return false;
  return view.at !== 'title';
}

/**
 * Whether Next goes forward: on the title card, as it starts a session or
 * goes back into one, and on an answered card; never on a card waiting for
 * its answer or the summary.
 */
export function canGoForward(state: StudySessionState, title: TitleCardData) {
  const { session, view } = state;
  if (session.status === 'not-started' || session.status === 'starting') {
    return canStart(state, title);
  }
  if (session.status === 'nothing-due') return false;
  if (view.at === 'summary') return false;
  if (view.at === 'play') return !!session.items[session.position]?.answer;
  return true;
}
