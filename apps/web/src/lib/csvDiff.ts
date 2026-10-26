import type { CsvRow, CsvErrorRow } from './csvParser';
import { splitAnswers, type AcceptedVariant } from './cards';

export interface NewCard {
  front: string;
  back: string;
}

export interface UpdateCard {
  cardId: string;
  front: string;
  // The card's answers, as an answer column holds them
  oldBack: string;
  newBack: string;
  // The card's answers and their Accepted Variants' texts; an answer the
  // import drops takes its variants with it
  oldAnswers: { text: string; variants: string[] }[];
}

export interface SkippedRow {
  front: string;
  back: string;
  reason: string;
}

export interface CsvDiffResult {
  newCards: NewCard[];
  updateCards: UpdateCard[];
  skippedRows: SkippedRow[];
}

export interface ExistingCard {
  id: string;
  front: string;
  canonicalAnswer: string;
  // All its Canonical Answers, primary first, when known
  answers?: { text: string; acceptedVariants: AcceptedVariant[] }[];
}

/**
 * Looks up the existing card a new card's front duplicates: the same front,
 * ignoring case and surrounding spaces.
 */
export function duplicateFinder(existingCards: ExistingCard[]) {
  const key = (front: string) => front.trim().toLowerCase();
  const existingByFront = new Map(existingCards.map((c) => [key(c.front), c]));
  return (front: string) => existingByFront.get(key(front));
}

/**
 * Compares parsed CSV rows against existing cards in a deck.
 * Categorizes into: new (no front match), update (front match, answers
 * differ from the card's, split on "||", order included), duplicate (the
 * same answers), error (from parser).
 */
export function diffCsvRows(
  validRows: CsvRow[],
  existingCards: ExistingCard[],
  errorRows: CsvErrorRow[],
): CsvDiffResult {
  const findDuplicate = duplicateFinder(existingCards);

  const newCards: NewCard[] = [];
  const updateCards: UpdateCard[] = [];
  const skippedRows: SkippedRow[] = [];

  for (const row of validRows) {
    const existing = findDuplicate(row.front);

    const answers = existing?.answers ?? [
      { text: existing?.canonicalAnswer ?? '', acceptedVariants: [] },
    ];
    const oldBack = answers.map((answer) => answer.text).join(' || ');

    if (!existing) {
      newCards.push({ front: row.front, back: row.back });
    } else if (splitAnswers(row.back).join(' || ') !== oldBack) {
      updateCards.push({
        cardId: existing.id,
        front: row.front,
        oldBack,
        newBack: row.back,
        oldAnswers: answers.map((answer) => ({
          text: answer.text,
          variants: answer.acceptedVariants.map((variant) => variant.text),
        })),
      });
    } else {
      skippedRows.push({
        front: row.front,
        back: row.back,
        reason: 'Exact duplicate',
      });
    }
  }

  for (const err of errorRows) {
    skippedRows.push({
      front: err.front,
      back: err.back,
      reason: err.reason,
    });
  }

  return { newCards, updateCards, skippedRows };
}
