import { type Flashcard } from '@/lib/cards';
import { asDirected, type StudyDirection } from '@/lib/directions';
import {
  type Grade,
  type GradedAnswer,
  type RecallGrade,
} from '@/lib/recallGrades';
import { type StudyMode } from '@/lib/sessionChoices';

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

/**
 * A started session's items, answered first, the item in play, and the
 * Study Mode it was started in.
 */
type Started = {
  id: string;
  studyMode: StudyMode;
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

/** What marking a card known did, once done. */
export type KnownState = 'marked' | 'already';

/** A server call that failed, leaving the session where it was. */
export type Failure = 'start' | 'answer' | 'finish' | 'accept' | 'retire';

export type StudySessionState = {
  session: Session;
  view: View;
  // Whether an answered card on screen shows its back
  flipped: boolean;
  // The card on screen in edit mode, and whether its editor shows the back,
  // until it's done or another card comes on screen
  editing: { showsBack: boolean } | null;
  // The answer, by its attempt, whose "My answer was correct" is asking
  // which of its card's Canonical Answers it's another way of saying
  choosingAnswerFor: string | null;
  // Cards marked known in this session, and whether that changed them or
  // they were known already (ADR-0009)
  known: Record<string, KnownState>;
  // Cards retired from the study screen in this session (#86)
  retired: Record<string, true>;
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
      session: {
        id: string;
        items: SessionItem[];
        studyMode: StudyMode;
      } | null;
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
  // Turns the card on screen over: an answered one, or one being edited
  | { type: 'flip' }
  // Edit mode for the card on screen, opening on its back or front
  | { type: 'edit'; onBack?: boolean }
  | { type: 'stopEditing' }
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
  | { type: 'cancelChoosing' }
  // Marks the card on screen known in its direction, its Retry, if any,
  // skipped with it
  | { type: 'markKnown' }
  | { type: 'markedKnown'; cardId: string; changed: boolean }
  // Retires the card on screen (#86), its Retry, if any, skipped with it
  | { type: 'retire' }
  | { type: 'retired'; cardId: string }
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
  | { type: 'abandon'; sessionId: string }
  | { type: 'markKnown'; cardId: string; direction: StudyDirection }
  | { type: 'retire'; cardId: string };

export const initialState: StudySessionState = {
  session: { status: 'not-started' },
  view: { at: 'title' },
  flipped: false,
  editing: null,
  choosingAnswerFor: null,
  known: {},
  retired: {},
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

/** The item whose card is on screen, if a card is. */
function itemOnScreen({ session, view }: StudySessionState) {
  if (!isUnderWay(session)) return undefined;
  if (view.at === 'answered') return session.items[view.index];
  if (view.at === 'play') return session.items[session.position];
  return undefined;
}

/**
 * Which card is on screen, by its item, so a move to another can be told
 * apart, even one taking the place of a card dropped.
 */
function screenKey(state: StudySessionState) {
  const { session, view } = state;
  if (!isUnderWay(session)) return session.status;
  return `${view.at}:${itemOnScreen(state)?.itemId ?? ''}`;
}

/**
 * Whether "My answer was correct" first asks which answer it means: on a
 * card asking for one of several answers, as asked in its direction. In
 * Reverse it asks for its front alone (ADR-0011).
 */
function asksWhichAnswer(item: SessionItem) {
  return asDirected(item.card, item.direction).answers.length > 1;
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
  const next = step(state, event);
  // Next, Back and moving to another card leave edit mode
  const leaves =
    event.type === 'next' ||
    event.type === 'back' ||
    screenKey(next.state) !== screenKey(state);
  if (next.state.editing && leaves) {
    return { ...next, state: { ...next.state, editing: null } };
  }
  return next;
}

function step(
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
      const { id, items, studyMode } = event.session;
      const answered = answeredCount(items);
      if (answered === items.length) {
        // Every card answered, but not yet finished
        return {
          state: {
            ...state,
            session: {
              status: 'complete',
              id,
              studyMode,
              items,
              position: answered,
            },
            view: { at: 'summary' },
          },
          commands: [{ type: 'finish', sessionId: id }],
        };
      }
      return noCommands({
        ...state,
        session: {
          status: 'in-progress',
          id,
          studyMode,
          items,
          position: answered,
        },
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
      // The title card before a session starts one
      if (session.status === 'not-started')
        return step(state, { type: 'start' });
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
    case 'flip': {
      // An unanswered card has no back outside edit mode
      const { editing } = state;
      if (editing && !itemOnScreen(state)?.answer) {
        return noCommands({
          ...state,
          editing: { showsBack: !editing.showsBack },
        });
      }
      return noCommands({ ...state, flipped: !state.flipped });
    }
    case 'edit': {
      const onScreen = itemOnScreen(state);
      if (!onScreen) return noCommands(state);
      const showsBack = !!event.onBack;
      return noCommands({
        ...state,
        editing: { showsBack },
        // An answered card keeps the side it shows, so it turns to its back
        flipped: showsBack && onScreen.answer ? true : state.flipped,
      });
    }
    case 'stopEditing':
      return noCommands({ ...state, editing: null });
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
      const accepted = answeredItem(state, event.attemptId);
      // On a card with several answers it first asks which one is meant
      if (!event.canonicalAnswerId && accepted && asksWhichAnswer(accepted)) {
        return noCommands({ ...state, choosingAnswerFor: event.attemptId });
      }
      state = { ...state, choosingAnswerFor: null };
      // It wasn't missed after all, so its Retry is dropped at once, before
      // the learner can move on
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
    case 'markKnown': {
      const onScreen = itemOnScreen(state);
      if (!onScreen) return noCommands(state);
      const { card, direction } = onScreen;
      // Dropped at once, before the learner can move on
      const dropped = dropCard(state, card.id, { keepAnswered: true });
      return {
        state: dropped.state,
        commands: [
          { type: 'markKnown', cardId: card.id, direction },
          ...dropped.commands,
        ],
      };
    }
    case 'retire': {
      const onScreen = itemOnScreen(state);
      if (!onScreen) return noCommands(state);
      const { card } = onScreen;
      // Dropped at once, before the learner can move on
      const dropped = dropCard(state, card.id, { keepAnswered: true });
      return {
        state: { ...dropped.state, failure: null },
        commands: [{ type: 'retire', cardId: card.id }, ...dropped.commands],
      };
    }
    case 'retired':
      return noCommands({
        ...state,
        retired: { ...state.retired, [event.cardId]: true },
      });
    case 'markedKnown':
      return noCommands({
        ...state,
        known: {
          ...state.known,
          [event.cardId]: event.changed ? 'marked' : 'already',
        },
      });
    case 'cancelChoosing':
      return noCommands({ ...state, choosingAnswerFor: null });
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

/** The card on screen, and what's shown with it. */
export type CardScreen = {
  kind: 'card';
  // Waiting for its answer, graded in play, or an answered card gone back to
  stage: 'answering' | 'graded' | 'reviewing';
  item: SessionItem;
  answer: ItemAnswer | null;
  // "Card 7 of 20", then "Retry 2 of 3"; none on a card gone back to
  progress: string | undefined;
  // The items still to come, the card's own included, for the stack's depth
  remaining: number;
  flipped: boolean;
  editing: { showsBack: boolean } | null;
  // Whether "My answer was correct" first asks which answer is meant, and
  // whether it's asking now
  asksWhichAnswer: boolean;
  choosingAnswer: boolean;
  known: KnownState | undefined;
  // Whether it was retired from here this session (#86)
  retired: boolean;
  // Whether the card comes back later in the session, as a Retry
  retryWaiting: boolean;
  // Why the answer just typed wasn't graded, while it waits for another
  refusal: string | null;
};

export type StudyScreen =
  // Before a session, or gone back to within one, with its size
  | { kind: 'title'; sessionSize: number | null }
  | { kind: 'nothing-due' }
  | CardScreen
  // The session's summary, its cards counted by their first answers
  | {
      kind: 'summary';
      answered: number;
      size: number;
      grades: { grade: RecallGrade; count: number }[];
    }
  // No card left to show while the session finishes
  | { kind: 'empty' };

/** What the study screen shows, and which ways the learner can go. */
export type StudyView = {
  screen: StudyScreen;
  answerInput: string;
  failure: Failure | null;
  canStart: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

// The session summary lists grades best first.
const summaryGradeOrder: RecallGrade[] = [
  'NAILED',
  'GOOD',
  'PARTIALLY_CORRECT',
  'MISSED',
];

function screenOf(state: StudySessionState): StudyScreen {
  const { session, view } = state;
  if (session.status === 'nothing-due') return { kind: 'nothing-due' };
  if (!isUnderWay(session)) return { kind: 'title', sessionSize: null };
  const { items, position } = session;
  // Progress counts cards, then Retries, which come after them all
  const sessionSize = items.filter((item) => !item.isRetry).length;
  if (view.at === 'title') return { kind: 'title', sessionSize };
  if (view.at === 'summary') {
    // Each card by its first answer, which scheduled it; Retries didn't
    const firstAnswers = items.flatMap((item) =>
      item.answer && !item.isRetry ? [item.answer] : [],
    );
    return {
      kind: 'summary',
      answered: firstAnswers.length,
      size: sessionSize,
      grades: summaryGradeOrder
        .map((grade) => ({
          grade,
          count: firstAnswers.filter((a) => a.recallGrade === grade).length,
        }))
        .filter(({ count }) => count > 0),
    };
  }
  const item = itemOnScreen(state);
  if (!item) return { kind: 'empty' };
  const answered = answeredCount(items);
  const stage =
    view.at === 'answered' ? 'reviewing' : item.answer ? 'graded' : 'answering';
  const progress =
    stage === 'reviewing'
      ? undefined
      : item.isRetry
        ? `Retry ${position + 1 - sessionSize} of ${items.length - sessionSize}`
        : `Card ${Math.min(position + 1, sessionSize)} of ${sessionSize}`;
  return {
    kind: 'card',
    stage,
    item,
    answer: item.answer,
    progress,
    remaining: items.length - position,
    flipped: !!item.answer && state.flipped,
    editing: state.editing,
    asksWhichAnswer: asksWhichAnswer(item),
    choosingAnswer:
      !!item.answer && state.choosingAnswerFor === item.answer.attemptId,
    known: state.known[item.card.id],
    retired: !!state.retired[item.card.id],
    retryWaiting: items.some(
      (other, i) =>
        i >= answered && other.isRetry && other.card.id === item.card.id,
    ),
    refusal:
      stage === 'answering' && state.refusal?.itemId === item.itemId
        ? state.refusal.message
        : null,
  };
}

/** What the study screen shows, given what the title card's queries say. */
export function studyView(
  state: StudySessionState,
  title: TitleCardData,
): StudyView {
  return {
    screen: screenOf(state),
    answerInput: state.answerInput,
    failure: state.failure,
    canStart: canStart(state, title),
    canGoBack: canGoBack(state),
    canGoForward: canGoForward(state, title),
  };
}
