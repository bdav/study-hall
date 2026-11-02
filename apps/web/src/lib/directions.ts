import { isSameAnswer, type Flashcard } from '@/lib/cards';

/**
 * Which way a card is asked (ADR-0011): Forward, its front prompting its
 * canonical answer, or Reverse, its primary answer prompting its front.
 */
export type StudyDirection = 'FORWARD' | 'REVERSE';

export const STUDY_DIRECTIONS: readonly StudyDirection[] = [
  'FORWARD',
  'REVERSE',
];

/** The most a Direction Label holds (`MAX_DIRECTION_LABEL_LENGTH` in the API). */
export const MAX_DIRECTION_LABEL_LENGTH = 40;

/** What stands in for a Direction Label a deck has none for. */
export const DEFAULT_DIRECTION_LABELS: Record<StudyDirection, string> = {
  FORWARD: 'Forward',
  REVERSE: 'Reverse',
};

/** A deck's Reversible Deck settings, as the API returns a deck. */
export type DirectedDeck = {
  reversible: boolean;
  forwardLabel: string | null;
  reverseLabel: string | null;
};

/** What a deck calls each Study Direction: its Direction Labels, or stand-ins. */
export function directionLabels(
  deck: DirectedDeck,
): Record<StudyDirection, string> {
  return {
    FORWARD: deck.forwardLabel || DEFAULT_DIRECTION_LABELS.FORWARD,
    REVERSE: deck.reverseLabel || DEFAULT_DIRECTION_LABELS.REVERSE,
  };
}

/**
 * Whether a deck has a Direction Label the AI may suggest (#83): one that's
 * blank or its own earlier suggestion, not one the learner typed.
 */
export function hasLabelToSuggest(
  deck: DirectedDeck & {
    forwardLabelSuggested?: boolean;
    reverseLabelSuggested?: boolean;
  },
) {
  return (
    !deck.forwardLabel ||
    !!deck.forwardLabelSuggested ||
    !deck.reverseLabel ||
    !!deck.reverseLabelSuggested
  );
}

/** The Study Directions a deck is studied in: Reverse only when reversible. */
export function directionsOf(deck: DirectedDeck): StudyDirection[] {
  return deck.reversible ? [...STUDY_DIRECTIONS] : ['FORWARD'];
}

/**
 * What a card asks in a Study Direction, and the answer it's after: its
 * front and primary answer Forward, the other way round in Reverse.
 */
export function askedIn(card: Flashcard, direction: StudyDirection) {
  return direction === 'FORWARD'
    ? { prompt: card.front, answer: card.canonicalAnswer }
    : { prompt: card.canonicalAnswer, answer: card.front };
}

/**
 * The cards Reverse can't tell apart: groups of two or more, in deck order,
 * sharing a primary answer as grading compares answers.
 */
export function cardsSharingAnswers(cards: Flashcard[]): Flashcard[][] {
  const groups: Flashcard[][] = [];
  for (const card of cards) {
    const group = groups.find((g) =>
      isSameAnswer(g[0].canonicalAnswer, card.canonicalAnswer),
    );
    if (group) group.push(card);
    else groups.push([card]);
  }
  return groups.filter((group) => group.length > 1);
}

/**
 * A card as it's studied in a Study Direction: as it is Forward; in
 * Reverse, its primary answer as the front and its front as the one answer,
 * with the front's Reverse Variants as that answer's variants. For showing
 * the card in a Study Session; edits go to the card itself.
 */
export function asDirected(
  card: Flashcard,
  direction: StudyDirection,
): Flashcard {
  if (direction !== 'REVERSE') return card;
  return {
    ...card,
    front: card.canonicalAnswer,
    canonicalAnswer: card.front,
    answers: [
      { id: card.id, text: card.front, acceptedVariants: card.reverseVariants },
    ],
  };
}
