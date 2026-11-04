import { describe, expect, it } from 'vitest';
import { type Flashcard } from './cards';
import {
  canGoBack,
  canGoForward,
  canStart,
  initialState,
  studyView,
  transition,
  type ItemAnswer,
  type SessionItem,
  type StudySessionEvent,
  type StudySessionState,
} from './studySession';

function card(id: string): Flashcard {
  return {
    id,
    front: `${id} front`,
    answers: [{ id: `${id}-a`, text: `${id} back`, acceptedVariants: [] }],
    canonicalAnswer: `${id} back`,
    reverseVariants: [],
  };
}

/** A card with two Canonical Answers, "four" primary, then "4". */
function cardWithTwoAnswers(id: string): Flashcard {
  return {
    ...card(id),
    answers: [
      { id: `${id}-1`, text: 'four', acceptedVariants: [] },
      { id: `${id}-2`, text: '4', acceptedVariants: [] },
    ],
  };
}

function item(cardId: string, overrides: Partial<SessionItem> = {}) {
  return {
    itemId: `item-${cardId}`,
    card: card(cardId),
    deckId: 'deck-1',
    direction: 'FORWARD',
    isRetry: false,
    answer: null,
    ...overrides,
  } satisfies SessionItem;
}

function answer(overrides: Partial<ItemAnswer> = {}) {
  return {
    attemptId: 'attempt-1',
    userAnswer: 'typed',
    recallGrade: 'GOOD',
    accentMismatch: false,
    matchedAnswer: null,
    matchedVariant: null,
    otherFront: null,
    editedAfter: false,
    ...overrides,
  } satisfies ItemAnswer;
}

/** Applies events in turn, from the title card unless given a state. */
function run(events: StudySessionEvent[], from = initialState) {
  let state: StudySessionState = from;
  let commands: unknown[] = [];
  for (const event of events) {
    ({ state, commands } = transition(state, event));
  }
  return { state, commands };
}

/** The server's grade for an item, without a Retry unless given one. */
function graded(
  itemId: string,
  overrides: Partial<ItemAnswer> = {},
  retryItemId: string | null = null,
): StudySessionEvent {
  return {
    type: 'graded',
    itemId,
    answer: answer({ attemptId: `attempt-${itemId}`, ...overrides }),
    retryItemId,
  };
}

const started = (...items: SessionItem[]): StudySessionEvent[] => [
  { type: 'start' },
  { type: 'started', session: { id: 'session-1', items, studyMode: 'STUDY' } },
];

describe('the Study Session machine', () => {
  it('starts a session from the title card', () => {
    const { state, commands } = transition(initialState, { type: 'start' });

    expect(state.session.status).toBe('starting');
    expect(commands).toEqual([{ type: 'start' }]);
  });

  it('starts a session with Next from the title card', () => {
    const { state, commands } = transition(initialState, { type: 'next' });

    expect(state.session.status).toBe('starting');
    expect(commands).toEqual([{ type: 'start' }]);
  });

  it("doesn't start a session already being started", () => {
    const { state, commands } = run([{ type: 'start' }, { type: 'start' }]);

    expect(state.session.status).toBe('starting');
    expect(commands).toEqual([]);
  });

  it('says nothing is due when the server starts no session', () => {
    const { state } = run([
      { type: 'start' },
      { type: 'started', session: null },
    ]);

    expect(state.session.status).toBe('nothing-due');
  });

  it('can start again after a start fails, which it records', () => {
    const failed = run([{ type: 'start' }, { type: 'failed', of: 'start' }]);

    expect(failed.state.session.status).toBe('not-started');
    expect(failed.state.failure).toBe('start');

    const retried = run(started(item('a')), failed.state);
    expect(retried.state.session.status).toBe('in-progress');
    expect(retried.state.failure).toBeNull();
  });

  it('keeps the Study Mode the session was started in', () => {
    const { state } = run([
      { type: 'start' },
      {
        type: 'started',
        session: { id: 'session-1', items: [item('a')], studyMode: 'CRAM' },
      },
    ]);

    expect(state.session).toMatchObject({ studyMode: 'CRAM' });
  });

  it("doesn't start again on Next while a start is under way", () => {
    const { state, commands } = run([{ type: 'next' }, { type: 'next' }]);

    expect(state.session.status).toBe('starting');
    expect(commands).toEqual([]);
  });

  it('puts the first card in play once the session has started', () => {
    const { state, commands } = run(started(item('a'), item('b')));

    expect(state.session).toMatchObject({
      status: 'in-progress',
      id: 'session-1',
      position: 0,
    });
    expect(state.view).toEqual({ at: 'play' });
    expect(commands).toEqual([]);
  });

  it('resumes an unfinished session at its next card', () => {
    const { state } = run(started(item('a', { answer: answer() }), item('b')));

    expect(state.session).toMatchObject({ status: 'in-progress', position: 1 });
    expect(state.view).toEqual({ at: 'play' });
  });

  it('submits the answer typed to the card in play, but not a blank one', () => {
    const blank = run([...started(item('a')), { type: 'type', text: '  ' }]);
    expect(transition(blank.state, { type: 'submit' }).commands).toEqual([]);

    const { state, commands } = run(
      [{ type: 'type', text: 'ciao' }, { type: 'submit' }],
      blank.state,
    );
    expect(state.answerInput).toBe('ciao');
    expect(commands).toEqual([
      { type: 'submit', itemId: 'item-a', userAnswer: 'ciao' },
    ]);
  });

  it('shows a graded answer on its card, the back in view', () => {
    const graded = answer({ attemptId: 'attempt-a', recallGrade: 'NAILED' });
    const { state } = run([
      ...started(item('a'), item('b')),
      { type: 'type', text: 'typed' },
      { type: 'submit' },
      { type: 'graded', itemId: 'item-a', answer: graded, retryItemId: null },
    ]);

    expect(state.session).toMatchObject({
      status: 'in-progress',
      position: 0,
      items: [{ itemId: 'item-a', answer: graded }, { answer: null }],
    });
    expect(state.view).toEqual({ at: 'play' });
    expect(state.flipped).toBe(true);
  });

  it("doesn't bring a missed card back when the server queues no Retry", () => {
    const { state } = run([
      ...started(item('a'), item('b')),
      graded('item-a', { recallGrade: 'MISSED' }),
    ]);

    expect(state.session).toMatchObject({
      items: [{ itemId: 'item-a' }, { itemId: 'item-b' }],
    });
  });

  it('brings a missed card back as a Retry at the end of the session', () => {
    const missed = answer({ recallGrade: 'MISSED' });
    const { state } = run([
      ...started(item('a'), item('b')),
      { type: 'dontKnow' },
      { type: 'graded', itemId: 'item-a', answer: missed, retryItemId: 'r1' },
    ]);

    expect(state.session).toMatchObject({
      items: [
        { itemId: 'item-a', isRetry: false },
        { itemId: 'item-b' },
        { itemId: 'r1', card: card('a'), isRetry: true, answer: null },
      ],
    });
  });

  it('records a refused answer on its item, until the next submit', () => {
    const refused = run([
      ...started(item('a')),
      { type: 'type', text: 'France' },
      { type: 'submit' },
      { type: 'refused', itemId: 'item-a', message: 'Already given' },
    ]);

    expect(refused.state.answerInput).toBe('');
    expect(refused.state.refusal).toEqual({
      itemId: 'item-a',
      message: 'Already given',
    });
    expect(refused.state.session).toMatchObject({ items: [{ answer: null }] });

    const resubmitted = run(
      [{ type: 'type', text: 'Spain' }, { type: 'submit' }],
      refused.state,
    );
    expect(resubmitted.state.refusal).toBeNull();
  });

  it('records a failed answer, cleared by the next submit', () => {
    const failed = run([
      ...started(item('a')),
      { type: 'dontKnow' },
      { type: 'failed', of: 'answer' },
    ]);
    expect(failed.state.failure).toBe('answer');
    expect(failed.state.view).toEqual({ at: 'play' });

    const retried = run([{ type: 'dontKnow' }], failed.state);
    expect(retried.state.failure).toBeNull();
    expect(retried.commands).toHaveLength(1);
  });

  it('moves on to the next card from a graded one, and only from one', () => {
    const unanswered = run([
      ...started(item('a'), item('b')),
      { type: 'next' },
    ]);
    expect(unanswered.state.session).toMatchObject({ position: 0 });

    const { state, commands } = run(
      [{ type: 'type', text: 'typed' }, graded('item-a'), { type: 'next' }],
      unanswered.state,
    );
    expect(state.session).toMatchObject({ position: 1 });
    expect(state.view).toEqual({ at: 'play' });
    expect(state.answerInput).toBe('');
    expect(commands).toEqual([]);
  });

  it('finishes the session on Next from its last card', () => {
    const finishing = run([
      ...started(item('a')),
      graded('item-a'),
      { type: 'next' },
    ]);
    expect(finishing.commands).toEqual([
      { type: 'finish', sessionId: 'session-1' },
    ]);
    expect(finishing.state.session.status).toBe('in-progress');

    const { state } = run([{ type: 'finished' }], finishing.state);
    expect(state.session).toMatchObject({ status: 'complete', position: 1 });
    expect(state.view).toEqual({ at: 'summary' });
  });

  it('stays on the last card when finishing fails, to try again', () => {
    const { state } = run([
      ...started(item('a')),
      graded('item-a'),
      { type: 'next' },
      { type: 'failed', of: 'finish' },
    ]);
    expect(state.failure).toBe('finish');
    expect(state.session.status).toBe('in-progress');

    const retried = run([{ type: 'next' }], state);
    expect(retried.commands).toEqual([
      { type: 'finish', sessionId: 'session-1' },
    ]);
    expect(retried.state.failure).toBeNull();
  });

  it('finishes early, its cards still to come skipped', () => {
    const finishing = run([
      ...started(item('a'), item('b')),
      graded('item-a'),
      { type: 'finish' },
    ]);
    expect(finishing.commands).toEqual([
      { type: 'finish', sessionId: 'session-1' },
    ]);

    const { state } = run([{ type: 'finished' }], finishing.state);
    expect(state.session).toMatchObject({ status: 'complete', position: 2 });
    expect(state.view).toEqual({ at: 'summary' });
  });

  it('says nothing when finishing a resumed, fully answered session fails', () => {
    const { state } = run([
      ...started(item('a', { answer: answer() })),
      { type: 'failed', of: 'finish' },
    ]);

    expect(state.failure).toBeNull();
    expect(state.view).toEqual({ at: 'summary' });
  });

  describe('going back', () => {
    // a and b answered, c in play
    const atC = run([
      ...started(item('a'), item('b'), item('c')),
      graded('item-a'),
      { type: 'next' },
      graded('item-b'),
      { type: 'next' },
    ]).state;

    it('goes back from the card in play to the last one answered', () => {
      const { state } = run([{ type: 'back' }], atC);

      expect(state.view).toEqual({ at: 'answered', index: 1 });
      expect(state.flipped).toBe(true);
    });

    it('goes back from a graded card to the one answered before it', () => {
      const { state } = run([graded('item-c'), { type: 'back' }], atC);

      expect(state.view).toEqual({ at: 'answered', index: 1 });
    });

    it('goes back through the answered cards to the title card, and stops', () => {
      const { state } = run(
        [
          { type: 'back' },
          { type: 'back' },
          { type: 'back' },
          { type: 'back' },
        ],
        atC,
      );

      expect(state.view).toEqual({ at: 'title' });
      expect(state.session.status).toBe('in-progress');
    });

    it('goes back from the first card, unanswered, to the title card', () => {
      const { state } = run([...started(item('a')), { type: 'back' }]);

      expect(state.view).toEqual({ at: 'title' });
    });

    it('goes back from the summary to the last card answered', () => {
      const { state } = run([
        ...started(item('a'), item('b')),
        graded('item-a'),
        { type: 'finish' },
        { type: 'finished' },
        { type: 'back' },
      ]);

      expect(state.view).toEqual({ at: 'answered', index: 0 });
    });

    it('stays on the summary of a session finished with nothing answered', () => {
      const { state } = run([
        ...started(item('a')),
        { type: 'finish' },
        { type: 'finished' },
        { type: 'back' },
      ]);

      expect(state.view).toEqual({ at: 'summary' });
    });

    it('shows the back of a card gone back to, though flipped before', () => {
      const { state } = run(
        [{ type: 'back' }, { type: 'flip' }, { type: 'back' }],
        atC,
      );

      expect(state.flipped).toBe(true);
    });
  });

  describe('going forward again', () => {
    // a answered, b in play
    const atB = run([
      ...started(item('a'), item('b')),
      graded('item-a'),
      { type: 'next' },
    ]).state;

    it('goes forward through the answered cards to the card in play', () => {
      const back = run([{ type: 'back' }, { type: 'back' }], atB).state;
      expect(back.view).toEqual({ at: 'title' });

      const once = run([{ type: 'next' }], back).state;
      expect(once.view).toEqual({ at: 'answered', index: 0 });
      const twice = run([{ type: 'next' }], once).state;
      expect(twice.view).toEqual({ at: 'play' });
      expect(twice.session).toMatchObject({ position: 1 });
    });

    it('resumes from the title card when nothing is answered yet', () => {
      const { state, commands } = run([
        ...started(item('a')),
        { type: 'back' },
        { type: 'next' },
      ]);

      expect(state.view).toEqual({ at: 'play' });
      expect(commands).toEqual([]);
    });

    it('moves past a graded card in play once gone back over', () => {
      const { state } = run(
        [graded('item-b'), { type: 'back' }, { type: 'next' }],
        atB,
      );
      expect(state.view).toEqual({ at: 'answered', index: 1 });

      const { commands } = run([{ type: 'next' }], state);
      expect(commands).toEqual([{ type: 'finish', sessionId: 'session-1' }]);
    });

    it('goes forward from the last card answered to the summary', () => {
      const { state, commands } = run(
        [
          graded('item-b'),
          { type: 'next' },
          { type: 'finished' },
          { type: 'back' },
          { type: 'next' },
        ],
        atB,
      );

      expect(state.view).toEqual({ at: 'summary' });
      expect(commands).toEqual([]);
    });
  });

  describe('edits to a card of the session', () => {
    const edited = { ...card('a'), front: 'a, edited' };
    // a missed, b in play, a's Retry to come
    const atB = run([
      ...started(item('a'), item('b')),
      graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
      { type: 'next' },
    ]).state;

    it('shows an edit wherever the card appears, its answers marked edited after', () => {
      const { state } = run([{ type: 'cardEdited', card: edited }], atB);

      expect(state.session).toMatchObject({
        items: [
          { card: edited, answer: { editedAfter: true } },
          { card: card('b') },
          { card: edited, answer: null },
        ],
      });
    });

    it('shows an edit to a card gone back to, keeping it in view', () => {
      const reviewing = run([{ type: 'back' }], atB).state;
      const { state } = run([{ type: 'cardEdited', card: edited }], reviewing);

      expect(state.view).toEqual({ at: 'answered', index: 0 });
      expect(state.session).toMatchObject({
        items: [{ card: edited, answer: { editedAfter: true } }, {}, {}],
      });
    });

    it("shows a change that resets nothing without marking the card's answers", () => {
      const { state } = run([{ type: 'cardChanged', card: edited }], atB);

      expect(state.session).toMatchObject({
        items: [
          { card: edited, answer: { editedAfter: false } },
          { card: card('b') },
          { card: edited },
        ],
      });
    });
  });

  describe('cards dropped from the session', () => {
    const itemIds = (state: StudySessionState) =>
      'items' in state.session ? state.session.items.map((i) => i.itemId) : [];

    // a missed, b in play, c to come, then a's Retry
    const atB = run([
      ...started(item('a'), item('b'), item('c')),
      graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
      { type: 'next' },
    ]).state;

    it('drops a deleted card in play and moves on, its answers gone too', () => {
      const { state } = run(
        [
          { type: 'type', text: 'half' },
          { type: 'cardDeleted', cardId: 'b' },
        ],
        atB,
      );

      expect(itemIds(state)).toEqual(['item-a', 'item-c', 'r1']);
      expect(state.session).toMatchObject({ position: 1 });
      expect(state.view).toEqual({ at: 'play' });
      expect(state.answerInput).toBe('');
    });

    it("drops a deleted card's answers and Retry, the card in play moving up", () => {
      const { state } = run([{ type: 'cardDeleted', cardId: 'a' }], atB);

      expect(itemIds(state)).toEqual(['item-b', 'item-c']);
      expect(state.session).toMatchObject({ position: 0 });
      expect(state.view).toEqual({ at: 'play' });
    });

    it('finishes the session when the card dropped was the last to come', () => {
      const { state, commands } = run(
        [{ type: 'cardDeleted', cardId: 'only' }],
        run(started(item('only'))).state,
      );

      expect(itemIds(state)).toEqual([]);
      expect(commands).toEqual([{ type: 'finish', sessionId: 'session-1' }]);
    });

    it('shows the answered card before when the one gone back to is deleted', () => {
      const reviewing = run(
        [graded('item-b'), { type: 'next' }, { type: 'back' }],
        atB,
      ).state;
      expect(reviewing.view).toEqual({ at: 'answered', index: 1 });

      const { state } = run([{ type: 'cardDeleted', cardId: 'b' }], reviewing);
      expect(state.view).toEqual({ at: 'answered', index: 0 });
      expect(state.flipped).toBe(true);

      const none = run([{ type: 'cardDeleted', cardId: 'a' }], state).state;
      expect(none.view).toEqual({ at: 'title' });
    });

    it('keeps the answers of a card done with, dropping only its Retry', () => {
      const { state } = run([{ type: 'dropUnanswered', cardId: 'a' }], atB);

      expect(itemIds(state)).toEqual(['item-a', 'item-b', 'item-c']);
      expect(state.session).toMatchObject({ position: 1 });
      expect(state.view).toEqual({ at: 'play' });
    });

    it('moves on from a card in play done with before it was answered', () => {
      const { state } = run([{ type: 'dropUnanswered', cardId: 'b' }], atB);

      expect(itemIds(state)).toEqual(['item-a', 'item-c', 'r1']);
      expect(state.view).toEqual({ at: 'play' });
      expect(state.session).toMatchObject({ position: 1 });
    });

    it('finishes going forward when the cards left were dropped while back', () => {
      const reviewing = run(
        [{ type: 'back' }],
        run(started(item('a', { answer: answer() }), item('b'))).state,
      ).state;
      const dropped = run(
        [{ type: 'cardDeleted', cardId: 'b' }],
        reviewing,
      ).state;
      expect(dropped.view).toEqual({ at: 'answered', index: 0 });

      const { commands } = run([{ type: 'next' }], dropped);
      expect(commands).toEqual([{ type: 'finish', sessionId: 'session-1' }]);
    });
  });

  describe('"My answer was correct"', () => {
    // a missed, its Retry waiting, b in play
    const atB = run([
      ...started(item('a'), item('b')),
      graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
      { type: 'next' },
    ]).state;

    it('drops the Retry of the answer accepted and asks the server to accept it', () => {
      const { state, commands } = run(
        [
          {
            type: 'accept',
            attemptId: 'attempt-item-a',
            canonicalAnswerId: 'x',
          },
        ],
        atB,
      );

      expect(state.session).toMatchObject({
        items: [{ itemId: 'item-a' }, { itemId: 'item-b' }],
      });
      expect(commands).toEqual([
        { type: 'accept', attemptId: 'attempt-item-a', canonicalAnswerId: 'x' },
      ]);
    });

    it('shows the answer graded again, and the card with its new variant', () => {
      const withVariant = {
        ...card('a'),
        answers: [
          {
            id: 'a-a',
            text: 'a back',
            acceptedVariants: [{ id: 'v', text: 'typed' }],
          },
        ],
      };
      const { state } = run(
        [
          { type: 'accept', attemptId: 'attempt-item-a' },
          {
            type: 'accepted',
            attemptId: 'attempt-item-a',
            grade: {
              recallGrade: 'GOOD',
              accentMismatch: false,
              matchedAnswer: 'a back',
              matchedVariant: 'typed',
            },
            card: withVariant,
          },
        ],
        atB,
      );

      expect(state.session).toMatchObject({
        items: [
          {
            card: withVariant,
            answer: {
              recallGrade: 'GOOD',
              matchedVariant: 'typed',
              editedAfter: false,
            },
          },
          { itemId: 'item-b' },
        ],
      });
    });

    it('first asks which answer it means, on a card with several', () => {
      const twoAnswers = cardWithTwoAnswers('a');
      const atA = run([
        ...started(item('a', { card: twoAnswers })),
        graded('item-a', { recallGrade: 'MISSED' }),
      ]).state;

      const choosing = run(
        [{ type: 'accept', attemptId: 'attempt-item-a' }],
        atA,
      );
      expect(choosing.state.choosingAnswerFor).toBe('attempt-item-a');
      expect(choosing.commands).toEqual([]);

      const cancelled = run([{ type: 'cancelChoosing' }], choosing.state);
      expect(cancelled.state.choosingAnswerFor).toBeNull();

      const chosen = run(
        [
          {
            type: 'accept',
            attemptId: 'attempt-item-a',
            canonicalAnswerId: 'a-2',
          },
        ],
        choosing.state,
      );
      expect(chosen.state.choosingAnswerFor).toBeNull();
      expect(chosen.commands).toEqual([
        {
          type: 'accept',
          attemptId: 'attempt-item-a',
          canonicalAnswerId: 'a-2',
        },
      ]);
    });

    it('finishes going forward once accepting an answer gone back to drops the last card to come', () => {
      // a's Retry in play, then back to a's miss
      const reviewing = run(
        [
          { type: 'type', text: 'x' },
          graded('item-b'),
          { type: 'next' },
          { type: 'back' },
          { type: 'back' },
        ],
        atB,
      ).state;
      expect(reviewing.view).toEqual({ at: 'answered', index: 0 });

      const accepted = run(
        [{ type: 'accept', attemptId: 'attempt-item-a' }, { type: 'next' }],
        reviewing,
      ).state;
      const { commands } = run([{ type: 'next' }], accepted);
      expect(commands).toEqual([{ type: 'finish', sessionId: 'session-1' }]);
    });

    it('asks no question in Reverse, where the answer asked for is the front', () => {
      const reverse = item('a', {
        card: cardWithTwoAnswers('a'),
        direction: 'REVERSE',
      });
      const graded_ = run([
        ...started(reverse),
        graded('item-a', { recallGrade: 'MISSED' }),
      ]).state;
      expect(studyView(graded_, { resumable: false }).screen).toMatchObject({
        asksWhichAnswer: false,
      });

      const { state, commands } = run(
        [{ type: 'accept', attemptId: 'attempt-item-a' }],
        graded_,
      );
      expect(state.choosingAnswerFor).toBeNull();
      expect(commands).toEqual([
        { type: 'accept', attemptId: 'attempt-item-a' },
      ]);
    });

    it('records a failure to accept, cleared by the next try', () => {
      const failed = run(
        [
          { type: 'accept', attemptId: 'attempt-item-a' },
          { type: 'failed', of: 'accept' },
        ],
        atB,
      ).state;
      expect(failed.failure).toBe('accept');

      const retried = run(
        [{ type: 'accept', attemptId: 'attempt-item-a' }],
        failed,
      );
      expect(retried.state.failure).toBeNull();
      expect(retried.commands).toHaveLength(1);
    });
  });

  it('goes back to the title card for another session, putting this one away', () => {
    const { state, commands } = run([
      ...started(item('a')),
      graded('item-a'),
      { type: 'next' },
      { type: 'finished' },
      { type: 'startAnother' },
    ]);

    expect(state).toEqual(initialState);
    expect(commands).toEqual([]);
  });

  it('abandons the unfinished session offered on the title card', () => {
    const { commands } = transition(initialState, {
      type: 'abandon',
      sessionId: 'old',
    });

    expect(commands).toEqual([{ type: 'abandon', sessionId: 'old' }]);
  });

  describe('which ways the learner can go', () => {
    const due = { resumable: false, sessionSize: 10 };

    it('starts from the title card when there is something to study', () => {
      expect(canStart(initialState, due)).toBe(true);
      expect(canGoForward(initialState, due)).toBe(true);
      expect(canGoBack(initialState)).toBe(false);
    });

    it("doesn't start when the mode chosen has nothing, unless resuming", () => {
      const nothing = { resumable: false, sessionSize: 0 };
      expect(canStart(initialState, nothing)).toBe(false);
      expect(canGoForward(initialState, nothing)).toBe(false);
      expect(canStart(initialState, { ...nothing, resumable: true })).toBe(
        true,
      );
      // Not yet known
      expect(canStart(initialState, { resumable: false })).toBe(true);
    });

    it('goes back but not forward from a card waiting for its answer', () => {
      const { state } = run(started(item('a')));
      expect(canStart(state, due)).toBe(false);
      expect(canGoBack(state)).toBe(true);
      expect(canGoForward(state, due)).toBe(false);
    });

    it('goes both ways from a graded card, and from cards gone back to', () => {
      const gradedCard = run([...started(item('a')), graded('item-a')]).state;
      expect(canGoBack(gradedCard)).toBe(true);
      expect(canGoForward(gradedCard, due)).toBe(true);

      const title = run([{ type: 'back' }], gradedCard).state;
      expect(canGoBack(title)).toBe(false);
      expect(canGoForward(title, due)).toBe(true);
    });

    it('only goes back from the summary', () => {
      const { state } = run([
        ...started(item('a')),
        graded('item-a'),
        { type: 'next' },
        { type: 'finished' },
      ]);
      expect(canGoBack(state)).toBe(true);
      expect(canGoForward(state, due)).toBe(false);
    });
  });

  describe('marking a card known', () => {
    // a missed, its Retry waiting, b in play
    const atB = run([
      ...started(item('a'), item('b', { direction: 'REVERSE' })),
      graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
      { type: 'next' },
    ]).state;

    it("drops its waiting Retry and asks the server to mark it, in the card's direction", () => {
      const { state, commands } = run(
        [{ type: 'back' }, { type: 'markKnown' }],
        atB,
      );

      expect(state.session).toMatchObject({
        items: [{ itemId: 'item-a' }, { itemId: 'item-b' }],
      });
      expect(commands).toEqual([
        { type: 'markKnown', cardId: 'a', direction: 'FORWARD' },
      ]);
    });

    it('keeps a graded card in play on screen, dropping its Retry', () => {
      const { state, commands } = run(
        [{ type: 'markKnown' }],
        run([
          ...started(item('a'), item('b')),
          graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
        ]).state,
      );

      expect(state.session).toMatchObject({
        position: 0,
        items: [{ itemId: 'item-a' }, { itemId: 'item-b' }],
      });
      expect(state.view).toEqual({ at: 'play' });
      expect(commands).toEqual([
        { type: 'markKnown', cardId: 'a', direction: 'FORWARD' },
      ]);
    });

    it('moves on from the card in play, marked before it was answered', () => {
      const { state, commands } = run([{ type: 'markKnown' }], atB);

      // a's Retry comes next
      expect(state.session).toMatchObject({
        position: 1,
        items: [{ itemId: 'item-a' }, { itemId: 'r1' }],
      });
      expect(commands).toEqual([
        { type: 'markKnown', cardId: 'b', direction: 'REVERSE' },
      ]);
    });

    it('says whether marking it changed anything, until another session', () => {
      const marked = run(
        [
          { type: 'back' },
          { type: 'markKnown' },
          { type: 'markedKnown', cardId: 'a', changed: true },
          { type: 'markedKnown', cardId: 'b', changed: false },
        ],
        atB,
      ).state;
      expect(marked.known).toEqual({ a: 'marked', b: 'already' });

      const another = run(
        [{ type: 'finish' }, { type: 'finished' }, { type: 'startAnother' }],
        marked,
      ).state;
      expect(another.known).toEqual({});
    });
  });

  describe('retiring a card (#86)', () => {
    // a missed, its Retry waiting, b in play
    const atB = run([
      ...started(item('a'), item('b')),
      graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
      { type: 'next' },
    ]).state;

    it('drops its waiting Retry and asks the server to retire it', () => {
      const { state, commands } = run(
        [{ type: 'back' }, { type: 'retire' }],
        atB,
      );

      expect(state.session).toMatchObject({
        items: [{ itemId: 'item-a' }, { itemId: 'item-b' }],
      });
      expect(commands).toEqual([{ type: 'retire', cardId: 'a' }]);
    });

    it('says the card is retired once it is, until another session', () => {
      const retired = run(
        [
          { type: 'back' },
          { type: 'retire' },
          { type: 'retired', cardId: 'a' },
        ],
        atB,
      ).state;
      expect(studyView(retired, { resumable: false }).screen).toMatchObject({
        retired: true,
      });

      const another = run(
        [{ type: 'finish' }, { type: 'finished' }, { type: 'startAnother' }],
        retired,
      ).state;
      expect(another.retired).toEqual({});
    });

    it('records a failure to retire', () => {
      const { state } = run(
        [
          { type: 'back' },
          { type: 'retire' },
          { type: 'failed', of: 'retire' },
        ],
        atB,
      );

      expect(state.failure).toBe('retire');
    });
  });

  describe('edit mode', () => {
    // a answered, b in play
    const atB = run([
      ...started(item('a'), item('b')),
      graded('item-a'),
      { type: 'next' },
    ]).state;

    it('edits the card in view until done', () => {
      const editing = run([{ type: 'edit' }], atB).state;
      expect(editing.editing).toEqual({ showsBack: false });

      const done = run([{ type: 'stopEditing' }], editing).state;
      expect(done.editing).toBeNull();
    });

    it("turns an unanswered card's editor over, not the card", () => {
      const { state } = run([{ type: 'edit' }, { type: 'flip' }], atB);

      expect(state.editing).toEqual({ showsBack: true });
    });

    it("opens on an answered card's back, turning the card over to it", () => {
      const reviewing = run([{ type: 'back' }, { type: 'flip' }], atB).state;
      expect(reviewing.flipped).toBe(false);

      const { state } = run([{ type: 'edit', onBack: true }], reviewing);
      expect(state.editing).toEqual({ showsBack: true });
      expect(state.flipped).toBe(true);
    });

    it('ends when the card in view changes', () => {
      const back = run([{ type: 'edit' }, { type: 'back' }], atB).state;
      expect(back.editing).toBeNull();

      const gradedB = run([graded('item-b')], atB).state;
      const next = run([{ type: 'edit' }, { type: 'next' }], gradedB).state;
      expect(next.session).toMatchObject({ position: 1 });
      expect(next.editing).toBeNull();
    });

    it('ends when the card being edited is deleted, the next taking its place', () => {
      const { state } = run(
        [{ type: 'edit' }, { type: 'cardDeleted', cardId: 'b' }],
        run([...started(item('a'), item('b'), item('c'))]).state,
      );
      expect(state.editing).toEqual({ showsBack: false });

      const deleted = run(
        [{ type: 'edit' }, { type: 'cardDeleted', cardId: 'a' }],
        run([...started(item('a'), item('b'))]).state,
      ).state;
      expect(deleted.session).toMatchObject({ position: 0 });
      expect(deleted.editing).toBeNull();
    });

    it('stays on while the card in view stays, as when it is answered', () => {
      const { state } = run([{ type: 'edit' }, graded('item-b')], atB);

      expect(state.editing).toEqual({ showsBack: false });
    });
  });

  it("submits I don't know as no answer", () => {
    const { commands } = run([...started(item('a')), { type: 'dontKnow' }]);

    expect(commands).toEqual([
      { type: 'submit', itemId: 'item-a', userAnswer: null },
    ]);
  });

  it('finishes a resumed session whose every card is answered', () => {
    const { state, commands } = run(
      started(item('a', { answer: answer() }), item('b', { answer: answer() })),
    );

    expect(state.session).toMatchObject({ status: 'complete', position: 2 });
    expect(state.view).toEqual({ at: 'summary' });
    expect(commands).toEqual([{ type: 'finish', sessionId: 'session-1' }]);
  });

  describe('the view: what the study screen shows', () => {
    const due = { resumable: false, sessionSize: 2 };

    it('shows the title card before a session, which starts one', () => {
      const view = studyView(initialState, due);

      expect(view.screen).toEqual({ kind: 'title', sessionSize: null });
      expect(view.canStart).toBe(true);
    });

    it("shows the session's size on the title card gone back to", () => {
      const { state } = run([
        ...started(item('a'), item('b')),
        { type: 'back' },
      ]);

      expect(studyView(state, due).screen).toEqual({
        kind: 'title',
        sessionSize: 2,
      });
    });

    it('shows the card in play waiting for its answer, counting the cards', () => {
      const { state } = run([
        ...started(item('a'), item('b')),
        { type: 'type', text: 'ci' },
      ]);

      expect(studyView(state, due)).toMatchObject({
        screen: {
          kind: 'card',
          stage: 'answering',
          item: { itemId: 'item-a' },
          answer: null,
          progress: 'Card 1 of 2',
          remaining: 2,
        },
        answerInput: 'ci',
        canGoForward: false,
      });
    });

    it('counts the Retries on their own, after the cards', () => {
      const { state } = run([
        ...started(item('a')),
        graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
        { type: 'next' },
      ]);

      expect(studyView(state, due).screen).toMatchObject({
        stage: 'answering',
        progress: 'Retry 1 of 1',
        remaining: 1,
      });
    });

    it('counts up the Retries as more are missed', () => {
      const missed = { recallGrade: 'MISSED' } as const;
      const first = run([
        ...started(item('a'), item('b')),
        graded('item-a', missed, 'r1'),
        { type: 'next' },
        graded('item-b', missed, 'r2'),
        { type: 'next' },
      ]).state;
      expect(studyView(first, due).screen).toMatchObject({
        progress: 'Retry 1 of 2',
      });

      // Missed again, so it comes back once more
      const again = run(
        [graded('r1', missed, 'r3'), { type: 'next' }],
        first,
      ).state;
      expect(studyView(again, due).screen).toMatchObject({
        progress: 'Retry 2 of 3',
      });
    });

    it('shows a graded card with its answer, and whether its Retry is to come', () => {
      const { state } = run([
        ...started(item('a'), item('b')),
        graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
      ]);

      expect(studyView(state, due).screen).toMatchObject({
        stage: 'graded',
        answer: { recallGrade: 'MISSED' },
        flipped: true,
        retryWaiting: true,
      });
    });

    it('shows a card gone back to without a progress line', () => {
      const { state } = run([
        ...started(item('a'), item('b')),
        graded('item-a'),
        { type: 'next' },
        { type: 'back' },
      ]);

      const { screen } = studyView(state, due);
      expect(screen).toMatchObject({
        stage: 'reviewing',
        item: { itemId: 'item-a' },
      });
      expect(screen).toHaveProperty('progress', undefined);
    });

    it('shows edit mode, choosing an answer and marked known on the card in view', () => {
      const twoAnswers = cardWithTwoAnswers('a');
      const { state } = run([
        ...started(item('a', { card: twoAnswers })),
        graded('item-a', { recallGrade: 'MISSED' }),
        { type: 'accept', attemptId: 'attempt-item-a' },
        { type: 'markKnown' },
        { type: 'markedKnown', cardId: 'a', changed: true },
        { type: 'edit' },
      ]);

      expect(studyView(state, due).screen).toMatchObject({
        editing: { showsBack: false },
        asksWhichAnswer: true,
        choosingAnswer: true,
        known: 'marked',
      });
    });

    it('shows a refusal while its card waits for an answer', () => {
      const { state } = run([
        ...started(item('a')),
        { type: 'dontKnow' },
        { type: 'refused', itemId: 'item-a', message: 'Already given' },
      ]);

      expect(studyView(state, due).screen).toMatchObject({
        refusal: 'Already given',
      });
    });

    it('sums up the session by first answers, best grade first', () => {
      const { state } = run([
        ...started(item('a'), item('b'), item('c')),
        graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
        { type: 'next' },
        graded('item-b', { recallGrade: 'NAILED' }),
        { type: 'next' },
        { type: 'finish' },
        { type: 'finished' },
      ]);

      expect(studyView(state, due).screen).toEqual({
        kind: 'summary',
        answered: 2,
        size: 3,
        grades: [
          { grade: 'NAILED', count: 1 },
          { grade: 'MISSED', count: 1 },
        ],
      });
    });

    it("leaves a Retry's answer out of the summary, counting its card once", () => {
      const { state } = run([
        ...started(item('a')),
        graded('item-a', { recallGrade: 'MISSED' }, 'r1'),
        { type: 'next' },
        graded('r1', { recallGrade: 'NAILED' }),
        { type: 'next' },
        { type: 'finished' },
      ]);

      expect(studyView(state, due).screen).toEqual({
        kind: 'summary',
        answered: 1,
        size: 1,
        grades: [{ grade: 'MISSED', count: 1 }],
      });
    });

    it('says when nothing is due', () => {
      const { state } = run([
        { type: 'start' },
        { type: 'started', session: null },
      ]);

      expect(studyView(state, due).screen).toEqual({ kind: 'nothing-due' });
    });
  });
});
