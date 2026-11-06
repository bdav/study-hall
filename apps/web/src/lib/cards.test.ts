import { describe, expect, it } from 'vitest';
// In this test alone, so the API's code stays out of what the web ships
import { matchAnswer } from '../../../api/src/services/answerGrader';
import { isSameAnswer } from './cards';

describe('isSameAnswer', () => {
  // If either rule changes alone, one of the two expectations fails
  it.each([
    ['case', 'Paris', 'paris', true],
    ['case in another alphabet', 'Москва', 'москва', true],
    ['punctuation', 'Paris!', 'Paris', true],
    ['punctuation inside a word', 'well-known', 'wellknown', true],
    ['an underscore', 'a_b', 'ab', true],
    ['extra whitespace', '  New   York ', 'New York', true],
    ['a tab between words', 'New\tYork', 'New York', true],
    ['digits', '42', '42!', true],
    ['the same accent', 'perché', 'Perché?', true],
    ['composed and decomposed accents', 'café', 'café', true],
    ['the same text in Japanese', '東京', '東京', true],
    ['the same text in Arabic', 'مصر', 'مصر!', true],
    ['a missing accent', 'e', 'è', false],
    ['a wrong accent', 'perchè', 'perché', false],
    ['a missing tilde', 'ano', 'año', false],
    ['a letter that only looks accented', 'Lodz', 'Łódź', false],
    ['spaces between words', 'por que', 'porque', false],
    ['a hyphen for a space', 'well-known', 'well known', false],
    ['another word', 'Lima', 'Paris', false],
    ['another word in Japanese', '大阪', '東京', false],
    ['no letters or digits', '?', '!', false],
    ['the same text with no letters or digits', '?!', '?!', false],
    ['nothing but whitespace', '  ', ' ', false],
    ['nothing at all', '', '', false],
  ])('agrees with matchAnswer on %s', (_rule, a, b, same) => {
    expect(matchAnswer(a, b) === 'exact').toBe(same);
    expect(isSameAnswer(a, b)).toBe(same);
  });
});
