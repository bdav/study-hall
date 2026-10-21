/** A card as the flashcard UI shows it, with its primary canonical answer. */
export type Flashcard = { id: string; front: string; canonicalAnswer: string };

export function toFlashcard(card: {
  id: string;
  front: string;
  canonicalAnswers: { text: string; isPrimary: boolean }[];
}): Flashcard {
  const primary =
    card.canonicalAnswers.find((a) => a.isPrimary) ?? card.canonicalAnswers[0];
  return {
    id: card.id,
    front: card.front,
    canonicalAnswer: primary?.text ?? '',
  };
}
