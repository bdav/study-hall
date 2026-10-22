import { describe, it, expect } from 'vitest';
import { gradeAnswer, matchAnswer, normalizeAnswer } from './answerGrader.js';

describe('matchAnswer', () => {
  it('reports an Accent Mismatch when only the accents differ', () => {
    expect(matchAnswer('Brasilia', 'Brasília')).toBe('accent-mismatch');
  });

  it.each([
    ['perchè', 'perché', 'a wrong accent'],
    ['è', 'e', 'an extra accent'],
    ['ano', 'año', 'a missing tilde'],
  ])('reports an Accent Mismatch for %s against %s (%s)', (answer, correct) => {
    expect(matchAnswer(answer, correct)).toBe('accent-mismatch');
  });

  it('is exact when the accents are right, whatever the case, punctuation and spacing', () => {
    expect(matchAnswer('  per ché? ', 'Perché')).toBe('exact');
  });

  it('is no match when the answer differs in more than accents', () => {
    expect(matchAnswer('Lima', 'Brasília')).toBe('no-match');
  });

  it.each([
    ['paris', 'Paris', 'case'],
    ['Paris!', 'Paris', 'punctuation'],
    ['New  York ', 'New York', 'whitespace'],
  ])('is exact when %s and %s differ only in %s', (answer, correct) => {
    expect(matchAnswer(answer, correct)).toBe('exact');
  });

  it('compares letters without accent marks as letters, not accents', () => {
    expect(matchAnswer('大阪 Tokyo', '東京 Tokyo')).toBe('no-match');
    expect(matchAnswer('東京', '東京')).toBe('exact');
    // ł is its own letter, not l with an accent mark
    expect(matchAnswer('Lodz', 'Łódź')).toBe('no-match');
  });

  it('never matches an answer with no letters or digits', () => {
    expect(matchAnswer('?', '!')).toBe('no-match');
  });
});

describe('normalizeAnswer', () => {
  it('lowercases the input', () => {
    expect(normalizeAnswer('Paris')).toBe('paris');
  });

  it('trims whitespace', () => {
    expect(normalizeAnswer('  Paris  ')).toBe('paris');
  });

  it('strips punctuation', () => {
    expect(normalizeAnswer('Paris.')).toBe('paris');
    expect(normalizeAnswer('Paris!')).toBe('paris');
    expect(normalizeAnswer("it's")).toBe('its');
  });

  it('normalizes internal whitespace', () => {
    expect(normalizeAnswer('New   York')).toBe('new york');
  });

  it('handles empty string', () => {
    expect(normalizeAnswer('')).toBe('');
  });

  it('handles string with only punctuation and spaces', () => {
    expect(normalizeAnswer('...  !!! ')).toBe('');
  });
});

describe('gradeAnswer', () => {
  it('returns NAILED for exact match', () => {
    expect(gradeAnswer('Paris', 'Paris').recallGrade).toBe('NAILED');
  });

  it('returns NAILED for case-insensitive match', () => {
    expect(gradeAnswer('paris', 'Paris').recallGrade).toBe('NAILED');
  });

  it('returns NAILED when user answer has extra whitespace', () => {
    expect(gradeAnswer('  Paris  ', 'Paris').recallGrade).toBe('NAILED');
  });

  it('returns NAILED when user answer has trailing punctuation', () => {
    expect(gradeAnswer('Paris.', 'Paris').recallGrade).toBe('NAILED');
  });

  it('returns MISSED for wrong answer', () => {
    expect(gradeAnswer('London', 'Paris').recallGrade).toBe('MISSED');
  });

  it('returns MISSED for empty answer', () => {
    expect(gradeAnswer('', 'Paris').recallGrade).toBe('MISSED');
  });

  it('returns NAILED for matching answer with different punctuation', () => {
    expect(gradeAnswer("it's a test", "It's a test").recallGrade).toBe(
      'NAILED',
    );
  });

  it('grades an Accent Mismatch GOOD and reports it', () => {
    expect(gradeAnswer('brasilia', 'Brasília')).toEqual({
      recallGrade: 'GOOD',
      accentMismatch: true,
    });
  });

  it('returns NAILED when the answer splits a word the canonical joins', () => {
    expect(
      gradeAnswer('hyper text transfer protocol', 'Hypertext Transfer Protocol')
        .recallGrade,
    ).toBe('NAILED');
  });

  it('returns NAILED when the answer joins words the canonical splits', () => {
    expect(gradeAnswer('database', 'data base').recallGrade).toBe('NAILED');
  });

  it('returns NAILED when a space is moved within the answer', () => {
    expect(gradeAnswer('ne wyork', 'New York').recallGrade).toBe('NAILED');
  });

  it('returns NAILED when spacing, case, punctuation and surrounding whitespace all differ', () => {
    expect(gradeAnswer('  Data base! ', 'Database').recallGrade).toBe('NAILED');
  });

  it('returns MISSED when the answer differs in more than spacing', () => {
    expect(gradeAnswer('hyper test', 'Hypertext').recallGrade).toBe('MISSED');
  });

  it('returns MISSED for a whitespace-only answer', () => {
    expect(gradeAnswer('   ', 'Paris').recallGrade).toBe('MISSED');
  });
});
