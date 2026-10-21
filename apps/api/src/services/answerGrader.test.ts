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
});
