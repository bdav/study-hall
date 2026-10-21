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
 * Compares parsed CSV rows against existing cards in a deck.
 * Categorizes into: new (no front match), update (front match, back differs
 * from the canonical answer), duplicate (exact match), error (from parser).
 */
export function diffCsvRows(
  validRows: CsvRow[],
  existingCards: ExistingCard[],
  errorRows: CsvErrorRow[],
): CsvDiffResult {
  const existingByFront = new Map(
    existingCards.map((c) => [c.front.toLowerCase(), c]),
  );

  const newCards: NewCard[] = [];
  const updateCards: UpdateCard[] = [];
  const skippedRows: SkippedRow[] = [];

  for (const row of validRows) {
    const existing = existingByFront.get(row.front.toLowerCase());

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
