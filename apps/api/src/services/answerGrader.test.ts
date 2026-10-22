import { describe, it, expect } from 'vitest';
import { gradeAnswer, normalizeAnswer } from './answerGrader.js';

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
    expect(gradeAnswer('Paris', 'Paris')).toBe('NAILED');
  });

  it('returns NAILED for case-insensitive match', () => {
    expect(gradeAnswer('paris', 'Paris')).toBe('NAILED');
  });

  it('returns NAILED when user answer has extra whitespace', () => {
    expect(gradeAnswer('  Paris  ', 'Paris')).toBe('NAILED');
  });

  it('returns NAILED when user answer has trailing punctuation', () => {
    expect(gradeAnswer('Paris.', 'Paris')).toBe('NAILED');
  });

  it('returns MISSED for wrong answer', () => {
    expect(gradeAnswer('London', 'Paris')).toBe('MISSED');
  });

  it('returns MISSED for empty answer', () => {
    expect(gradeAnswer('', 'Paris')).toBe('MISSED');
  });

  it('returns NAILED for matching answer with different punctuation', () => {
    expect(gradeAnswer("it's a test", "It's a test")).toBe('NAILED');
  });

  it('returns NAILED when canonical has punctuation too', () => {
    expect(gradeAnswer('brasilia', 'Brasília')).toBe('NAILED');
  });

  it('returns NAILED when the answer splits a word the canonical joins', () => {
    expect(
      gradeAnswer(
        'hyper text transfer protocol',
        'Hypertext Transfer Protocol',
      ),
    ).toBe('NAILED');
  });

  it('returns NAILED when the answer joins words the canonical splits', () => {
    expect(gradeAnswer('database', 'data base')).toBe('NAILED');
  });

  it('returns NAILED when a space is moved within the answer', () => {
    expect(gradeAnswer('ne wyork', 'New York')).toBe('NAILED');
  });

  it('returns NAILED when spacing, case, punctuation and surrounding whitespace all differ', () => {
    expect(gradeAnswer('  Data base! ', 'Database')).toBe('NAILED');
  });

  it('returns MISSED when the answer differs in more than spacing', () => {
    expect(gradeAnswer('hyper test', 'Hypertext')).toBe('MISSED');
  });

  it('returns MISSED for a whitespace-only answer', () => {
    expect(gradeAnswer('   ', 'Paris')).toBe('MISSED');
  });
});
