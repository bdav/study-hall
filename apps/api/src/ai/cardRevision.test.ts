import { describe, it, expect } from 'vitest';
import { CARD_WRITING_RULES } from './cardProposal.js';
import {
  CARD_REVISION_SYSTEM_PROMPT,
  buildCardRevisionPrompt,
  cardRevisionOutputSchema,
} from './cardRevision.js';

const validOutput = {
  changes: [
    { action: 'EDIT', card: 1, front: "Italian for 'seven'" },
    { action: 'EDIT', card: 2, canonicalAnswer: 'Buongiorno' },
    {
      action: 'EDIT',
      card: 3,
      front: 'Informal Italian hello',
      canonicalAnswer: 'Ciao',
    },
    { action: 'DELETE', card: 4 },
  ],
};

describe('cardRevisionOutputSchema', () => {
  it('accepts edits to a front, an answer or both, and deletions', () => {
    expect(cardRevisionOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it('accepts no changes, for an instruction no card needs', () => {
    expect(cardRevisionOutputSchema.parse({ changes: [] })).toEqual({
      changes: [],
    });
  });

  it.each([
    ['a missing changes list', {}],
    ['a list instead of an object', validOutput.changes],
    ['a change without an action', { changes: [{ card: 1, front: 'Hi' }] }],
    ['an unknown action', { changes: [{ action: 'CREATE', card: 1 }] }],
    ['a change without its card', { changes: [{ action: 'DELETE' }] }],
    [
      'a card that is not a listed number',
      { changes: [{ action: 'DELETE', card: 0 }] },
    ],
    [
      'a card given by something other than its number',
      { changes: [{ action: 'DELETE', card: 'card-1' }] },
    ],
    [
      'an edit that changes nothing',
      { changes: [{ action: 'EDIT', card: 1 }] },
    ],
    ['a blank front', { changes: [{ action: 'EDIT', card: 1, front: '  ' }] }],
    [
      'a blank answer',
      { changes: [{ action: 'EDIT', card: 1, canonicalAnswer: '' }] },
    ],
  ])('rejects %s', (_, output) => {
    expect(cardRevisionOutputSchema.safeParse(output).success).toBe(false);
  });

  it('accepts a note to the learner, trimmed', () => {
    const parsed = cardRevisionOutputSchema.parse({
      changes: [],
      note: ' Revising can’t add cards. ',
    });

    expect(parsed.note).toBe('Revising can’t add cards.');
  });

  it('trims fronts and answers', () => {
    const parsed = cardRevisionOutputSchema.parse({
      changes: [
        {
          action: 'EDIT',
          card: 1,
          front: ' Hello ',
          canonicalAnswer: ' Ciao ',
        },
      ],
    });

    expect(parsed.changes[0]).toEqual({
      action: 'EDIT',
      card: 1,
      front: 'Hello',
      canonicalAnswer: 'Ciao',
    });
  });
});

describe('card revision prompt', () => {
  it('follows the card-writing rules', () => {
    expect(CARD_REVISION_SYSTEM_PROMPT).toContain(CARD_WRITING_RULES);
  });

  it("numbers the deck's cards and gives the learner's instruction", () => {
    const prompt = buildCardRevisionPrompt({
      instruction: 'Remove the hints from the fronts',
      cards: [
        {
          front: "Italian for 'seven' (double t)",
          canonicalAnswers: ['sette'],
        },
        { front: 'Hello (informal)', canonicalAnswers: ['Ciao', 'Salve'] },
      ],
    });

    expect(prompt).toContain('Remove the hints from the fronts');
    expect(prompt).toContain("1. Italian for 'seven' (double t) → sette");
    expect(prompt).toContain('2. Hello (informal) → Ciao');
    expect(prompt).toContain('Salve');
  });
});
