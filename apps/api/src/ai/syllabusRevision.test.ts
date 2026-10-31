import { describe, it, expect } from 'vitest';
import { syllabusRevisionOutputSchema } from './syllabusRevision.js';

const validOutput = {
  changes: [
    { action: 'EDIT', lesson: 3, title: 'Numbers to a thousand' },
    { action: 'EDIT', lesson: 4, objectives: ['Ask the way'] },
    { action: 'ARCHIVE', lesson: 5 },
    {
      action: 'ADD',
      title: 'Telling the time',
      objectives: ['Say what time it is'],
      after: 0,
    },
  ],
  order: [1, 2, 4, 3],
  note: 'Directions moved later.',
};

describe('syllabusRevisionOutputSchema', () => {
  it('accepts edits, archives, additions, a new order and a note', () => {
    expect(syllabusRevisionOutputSchema.parse(validOutput)).toEqual(
      validOutput,
    );
  });

  it('accepts no changes, with or without a note', () => {
    expect(syllabusRevisionOutputSchema.parse({ changes: [] })).toEqual({
      changes: [],
    });
    expect(
      syllabusRevisionOutputSchema.parse({
        changes: [],
        note: 'Nothing needs changing.',
      }),
    ).toEqual({ changes: [], note: 'Nothing needs changing.' });
  });

  it.each([
    ['an edit that changes nothing', { action: 'EDIT', lesson: 3 }],
    ['a lesson numbered 0', { action: 'ARCHIVE', lesson: 0 }],
    [
      'a new lesson without objectives',
      { action: 'ADD', title: 'Time', objectives: [], after: 1 },
    ],
    [
      'a new lesson placed before the start',
      { action: 'ADD', title: 'Time', objectives: ['Tell it'], after: -1 },
    ],
    ['a blank title', { action: 'EDIT', lesson: 3, title: '  ' }],
    ['an unknown action', { action: 'DELETE', lesson: 3 }],
  ])('rejects %s', (_, change) => {
    expect(
      syllabusRevisionOutputSchema.safeParse({ changes: [change] }).success,
    ).toBe(false);
  });

  it('trims titles, objectives and the note', () => {
    const parsed = syllabusRevisionOutputSchema.parse({
      changes: [{ action: 'EDIT', lesson: 2, title: ' Numbers  ' }],
      note: ' Done. ',
    });

    expect(parsed).toEqual({
      changes: [{ action: 'EDIT', lesson: 2, title: 'Numbers' }],
      note: 'Done.',
    });
  });
});
