/** An alternative phrasing accepted as equivalent to a Canonical Answer. */
export type AcceptedVariant = { id: string; text: string };

/** One of a card's Canonical Answers, with its Accepted Variants. */
export type CardAnswer = {
  id: string;
  text: string;
  acceptedVariants: AcceptedVariant[];
};

/**
 * A card as the flashcard UI shows it: its Canonical Answers, primary
 * first, and, for the places that show one answer, the primary's text.
 */
export type Flashcard = {
  id: string;
  front: string;
  answers: CardAnswer[];
  canonicalAnswer: string;
};

/** One of a card's Canonical Answers in an edit, as `card.update` takes it. */
export type AnswerEdit = { id?: string; text: string };

export function toFlashcard(card: {
  id: string;
  front: string;
  canonicalAnswers: {
    id: string;
    text: string;
    isPrimary: boolean;
    acceptedVariants: AcceptedVariant[];
  }[];
}): Flashcard {
  const primary =
    card.canonicalAnswers.find((a) => a.isPrimary) ?? card.canonicalAnswers[0];
  const others = card.canonicalAnswers.filter((a) => a !== primary);
  return {
    id: card.id,
    front: card.front,
    answers: (primary ? [primary, ...others] : others).map(
      ({ id, text, acceptedVariants }) => ({ id, text, acceptedVariants }),
    ),
    canonicalAnswer: primary?.text ?? '',
  };
}

/**
 * Whether two answers grade as the same, the way `matchAnswer` on the API
 * finds an exact match: case, punctuation and extra whitespace never matter,
 * accents and the spaces between words do. The API has the final say.
 */
export function isSameAnswer(a: string, b: string) {
  const form = (answer: string) =>
    answer
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  return form(a) !== '' && form(a) === form(b);
}

/**
 * The answers in a CSV's answer column: "a || b" is two (`updated-plan.md`
 * §17.10). Each is trimmed; empty ones and repeats are dropped. Typed answer
 * fields don't split: they take one answer each.
 */
export function splitAnswers(text: string): string[] {
  const answers: string[] = [];
  for (const part of text.split('||').map((p) => p.trim())) {
    if (part && !answers.some((answer) => isSameAnswer(answer, part))) {
      answers.push(part);
    }
  }
  return answers;
}

/**
 * A card's answers, as `card.update` takes them, with the primary retyped.
 * Another answer the primary now grades the same as is dropped.
 */
export function answersWithPrimary(
  card: Flashcard,
  text: string,
): AnswerEdit[] {
  const [primary, ...others] = card.answers;
  const first = text.trim();
  return [
    { id: primary?.id, text: first },
    ...others
      .filter((other) => !isSameAnswer(other.text, first))
      .map(({ id, text }) => ({ id, text })),
  ];
}
