import type { CsvRow, CsvErrorRow } from './csvParser';

export interface NewCard {
  front: string;
  back: string;
}

export interface UpdateCard {
  cardId: string;
  front: string;
  oldBack: string;
  newBack: string;
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
 * Categorizes into: new (no front match), update (front match, back differs
 * from the canonical answer), duplicate (exact match), error (from parser).
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

    if (!existing) {
      newCards.push({ front: row.front, back: row.back });
    } else if (existing.canonicalAnswer !== row.back) {
      updateCards.push({
        cardId: existing.id,
        front: row.front,
        oldBack: existing.canonicalAnswer,
        newBack: row.back,
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
