/** An alternative phrasing accepted as equivalent to a Canonical Answer. */
export type AcceptedVariant = { id: string; text: string };

/**
 * A card as the flashcard UI shows it, with its primary canonical answer and
 * that answer's Accepted Variants.
 */
export type Flashcard = {
  id: string;
  front: string;
  canonicalAnswer: string;
  // null only for a card with no canonical answer
  canonicalAnswerId: string | null;
  acceptedVariants: AcceptedVariant[];
};

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
  return {
    id: card.id,
    front: card.front,
    canonicalAnswer: primary?.text ?? '',
    canonicalAnswerId: primary?.id ?? null,
    acceptedVariants: primary?.acceptedVariants ?? [],
  };
}
