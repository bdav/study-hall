import { describe, it, expect } from 'vitest';
import { syllabusOutputSchema } from './syllabus.js';

const validOutput = {
  lessons: [
    {
      title: 'Greetings and introductions',
      objectives: ['Greet someone formally and informally', 'Say your name'],
    },
    {
      title: 'Numbers 1–20',
      objectives: ['Count to twenty'],
    },
  ],
};

describe('syllabusOutputSchema', () => {
  it('accepts ordered lessons with titles and learning objectives', () => {
    expect(syllabusOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it.each([
    ['no lessons', { lessons: [] }],
    ['a missing lessons list', {}],
    [
      'a lesson without a title',
      { lessons: [{ title: '', objectives: ['Say your name'] }] },
    ],
    [
      'a lesson without objectives',
      { lessons: [{ title: 'Greetings', objectives: [] }] },
    ],
    [
      'a blank objective',
      { lessons: [{ title: 'Greetings', objectives: ['  '] }] },
    ],
    [
      'objectives that are not text',
      { lessons: [{ title: 'Greetings', objectives: [1, 2] }] },
    ],
    ['a list instead of an object', validOutput.lessons],
  ])('rejects %s', (_, output) => {
    expect(syllabusOutputSchema.safeParse(output).success).toBe(false);
  });

  it('trims titles and objectives', () => {
    const parsed = syllabusOutputSchema.parse({
      lessons: [{ title: '  Greetings ', objectives: [' Say hello  '] }],
    });

    expect(parsed.lessons[0]).toEqual({
      title: 'Greetings',
      objectives: ['Say hello'],
    });
  });
});
