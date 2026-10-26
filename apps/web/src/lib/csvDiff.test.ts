import { describe, it, expect } from 'vitest';
import { diffCsvRows } from './csvDiff';
import type { CsvRow, CsvErrorRow } from './csvParser';

describe('csvDiff', () => {
  it('identifies new cards when no existing cards', () => {
    const csvRows: CsvRow[] = [
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ];

    const result = diffCsvRows(csvRows, [], []);

    expect(result.newCards).toEqual([
      { front: 'Q1', back: 'A1' },
      { front: 'Q2', back: 'A2' },
    ]);
    expect(result.updateCards).toEqual([]);
    expect(result.skippedRows).toEqual([]);
  });

  it('identifies updates when front matches but back differs', () => {
    const csvRows: CsvRow[] = [{ front: 'Capital of France', back: 'Paris' }];
    const existingCards = [
      { id: 'card-1', front: 'Capital of France', canonicalAnswer: 'Lyon' },
    ];

    const result = diffCsvRows(csvRows, existingCards, []);

    expect(result.newCards).toEqual([]);
    expect(result.updateCards).toEqual([
      {
        cardId: 'card-1',
        front: 'Capital of France',
        oldBack: 'Lyon',
        newBack: 'Paris',
        oldAnswers: [{ text: 'Lyon', variants: [] }],
      },
    ]);
    expect(result.skippedRows).toEqual([]);
  });

  it('identifies exact duplicates as skipped', () => {
    const csvRows: CsvRow[] = [{ front: 'Q1', back: 'A1' }];
    const existingCards = [
      { id: 'card-1', front: 'Q1', canonicalAnswer: 'A1' },
    ];

    const result = diffCsvRows(csvRows, existingCards, []);

    expect(result.newCards).toEqual([]);
    expect(result.updateCards).toEqual([]);
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].reason).toMatch(/duplicate/i);
  });

  it('includes error rows in skipped', () => {
    const errorRows: CsvErrorRow[] = [
      { front: 'Q1', back: '', reason: 'Missing back value' },
    ];

    const result = diffCsvRows([], [], errorRows);

    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].reason).toBe('Missing back value');
  });

  it('matches case-insensitively on front', () => {
    const csvRows: CsvRow[] = [{ front: 'hello', back: 'world' }];
    const existingCards = [
      { id: 'card-1', front: 'Hello', canonicalAnswer: 'world' },
    ];

    const result = diffCsvRows(csvRows, existingCards, []);

    expect(result.newCards).toEqual([]);
    expect(result.updateCards).toEqual([]);
    expect(result.skippedRows).toHaveLength(1);
  });

  it('handles mixed new, update, and duplicate in one call', () => {
    const csvRows: CsvRow[] = [
      { front: 'New Q', back: 'New A' },
      { front: 'Update Q', back: 'Updated A' },
      { front: 'Exact Q', back: 'Exact A' },
    ];
    const existingCards = [
      { id: 'card-1', front: 'Update Q', canonicalAnswer: 'Old A' },
      { id: 'card-2', front: 'Exact Q', canonicalAnswer: 'Exact A' },
    ];

    const result = diffCsvRows(csvRows, existingCards, []);

    expect(result.newCards).toHaveLength(1);
    expect(result.newCards[0].front).toBe('New Q');
    expect(result.updateCards).toHaveLength(1);
    expect(result.updateCards[0].cardId).toBe('card-1');
    expect(result.skippedRows).toHaveLength(1);
    expect(result.skippedRows[0].front).toBe('Exact Q');
  });

  describe('cards with several answers', () => {
    const primes = {
      id: 'card-1',
      front: 'A prime between 10 and 20',
      canonicalAnswer: '11',
      answers: [
        { text: '11', acceptedVariants: [{ id: 'v', text: 'eleven' }] },
        { text: '13', acceptedVariants: [] },
      ],
    };

    it('skips a row with the same answers, however they are spaced', () => {
      const result = diffCsvRows(
        [{ front: 'A prime between 10 and 20', back: '11||  13' }],
        [primes],
        [],
      );

      expect(result.updateCards).toEqual([]);
      expect(result.skippedRows).toHaveLength(1);
    });

    it('updates a card whose answers or primary differ', () => {
      const result = diffCsvRows(
        [{ front: 'A prime between 10 and 20', back: '13 || 11' }],
        [primes],
        [],
      );

      expect(result.updateCards).toEqual([
        {
          cardId: 'card-1',
          front: 'A prime between 10 and 20',
          oldBack: '11 || 13',
          newBack: '13 || 11',
          oldAnswers: [
            { text: '11', variants: ['eleven'] },
            { text: '13', variants: [] },
          ],
        },
      ]);
    });
  });
});
