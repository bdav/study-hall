import { describe, it, expect } from 'vitest';
import { assembleLessonContext, lessonOutputSchema } from './lesson.js';

const validOutput = {
  content: [
    {
      heading: 'Saying hello',
      paragraphs: [
        'Italian has a formal and an informal hello.',
        'Use "buongiorno" with strangers until midday.',
      ],
    },
  ],
  examples: [
    { example: 'Ciao, Marco!', explanation: 'An informal hello to a friend.' },
  ],
  exercises: [
    {
      type: 'SHORT_ANSWER',
      prompt: 'Translate: Good morning',
      expectedAnswers: ['Buongiorno'],
    },
    {
      type: 'FILL_IN_THE_BLANK',
      prompt: '___, Marco! (informal hello)',
      expectedAnswers: ['Ciao'],
    },
    {
      type: 'FREE_FORM_EXPLANATION',
      prompt: 'When would you say "buonasera"?',
      expectedPoints: ['In the evening', 'As a greeting, not a goodbye'],
    },
  ],
  summary: 'Introduced ciao, buongiorno and buonasera, and when each fits.',
};

describe('lessonOutputSchema', () => {
  it('accepts content blocks, examples, exercises of each type and a summary', () => {
    expect(lessonOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it.each([
    ['no content blocks', { ...validOutput, content: [] }],
    [
      'a content block without paragraphs',
      { ...validOutput, content: [{ heading: 'Hello', paragraphs: [] }] },
    ],
    ['no examples', { ...validOutput, examples: [] }],
    ['no exercises', { ...validOutput, exercises: [] }],
    ['a blank summary', { ...validOutput, summary: '  ' }],
    [
      'an exercise of an unknown type',
      {
        ...validOutput,
        exercises: [
          { type: 'MULTIPLE_CHOICE', prompt: 'Pick one', expectedAnswers: [] },
        ],
      },
    ],
    [
      'a short answer without expected answers',
      {
        ...validOutput,
        exercises: [
          { type: 'SHORT_ANSWER', prompt: 'Say hi', expectedAnswers: [] },
        ],
      },
    ],
    [
      'a fill-in-the-blank prompt without a blank',
      {
        ...validOutput,
        exercises: [
          {
            type: 'FILL_IN_THE_BLANK',
            prompt: 'Marco! (informal hello)',
            expectedAnswers: ['Ciao'],
          },
        ],
      },
    ],
    [
      'a free-form explanation without expected points',
      {
        ...validOutput,
        exercises: [
          {
            type: 'FREE_FORM_EXPLANATION',
            prompt: 'Explain buonasera',
            expectedPoints: [],
          },
        ],
      },
    ],
    ['a missing summary', { ...validOutput, summary: undefined }],
  ])('rejects %s', (_, output) => {
    expect(lessonOutputSchema.safeParse(output).success).toBe(false);
  });

  it('trims text', () => {
    const parsed = lessonOutputSchema.parse({
      ...validOutput,
      summary: '  Introduced ciao. ',
      exercises: [
        {
          type: 'SHORT_ANSWER',
          prompt: ' Translate: Hello ',
          expectedAnswers: [' Ciao '],
        },
      ],
    });

    expect(parsed.summary).toBe('Introduced ciao.');
    expect(parsed.exercises[0]).toEqual({
      type: 'SHORT_ANSWER',
      prompt: 'Translate: Hello',
      expectedAnswers: ['Ciao'],
    });
  });
});

describe('assembleLessonContext', () => {
  const setup = {
    topic: 'Italian',
    goal: 'A2 by summer',
    priorKnowledge: 'Some Duolingo',
    timePerWeek: '3 hours',
    depth: 'Practical',
    notes: 'Trip to Rome in June',
  };

  /** A syllabus lesson; `summary` is its current version's Lesson Summary. */
  function lesson(
    position: number,
    {
      summary = null,
      archived = false,
    }: { summary?: string | null; archived?: boolean } = {},
  ) {
    return {
      id: `lesson-${position}`,
      title: `Lesson ${position}`,
      objectives: [`Objective ${position}`],
      position,
      archivedAt: archived ? new Date('2026-10-01') : null,
      summary,
    };
  }

  it('gives the setup answers, the outline and the current lesson objectives', () => {
    const context = assembleLessonContext({
      setup,
      lessons: [lesson(0), lesson(1), lesson(2)],
      lessonId: 'lesson-1',
    });

    expect(context.setup).toEqual(setup);
    expect(context.outline).toEqual([
      { title: 'Lesson 0', objectives: ['Objective 0'] },
      { title: 'Lesson 1', objectives: ['Objective 1'] },
      { title: 'Lesson 2', objectives: ['Objective 2'] },
    ]);
    expect(context.lesson).toEqual({
      title: 'Lesson 1',
      objectives: ['Objective 1'],
    });
  });

  it('includes summaries of generated lessons earlier in syllabus order, in that order', () => {
    const context = assembleLessonContext({
      setup,
      // Listed out of order: the syllabus position decides, not the list
      lessons: [
        lesson(3),
        lesson(2, { summary: 'Taught numbers' }),
        lesson(0, { summary: 'Taught greetings' }),
        lesson(1),
      ],
      lessonId: 'lesson-3',
    });

    expect(context.earlierSummaries).toEqual([
      { title: 'Lesson 0', summary: 'Taught greetings' },
      { title: 'Lesson 2', summary: 'Taught numbers' },
    ]);
  });

  it('never includes summaries of later lessons, even when they were generated first', () => {
    const context = assembleLessonContext({
      setup,
      lessons: [
        lesson(0, { summary: 'Taught greetings' }),
        lesson(1),
        lesson(2, { summary: 'Taught numbers' }),
      ],
      lessonId: 'lesson-1',
    });

    expect(context.earlierSummaries).toEqual([
      { title: 'Lesson 0', summary: 'Taught greetings' },
    ]);
  });

  it("leaves out the current lesson's own summary", () => {
    const context = assembleLessonContext({
      setup,
      lessons: [lesson(0, { summary: 'Taught greetings' })],
      lessonId: 'lesson-0',
    });

    expect(context.earlierSummaries).toEqual([]);
  });

  it('leaves archived lessons out of the outline and the summaries', () => {
    const context = assembleLessonContext({
      setup,
      lessons: [
        lesson(0, { summary: 'Taught greetings', archived: true }),
        lesson(1, { summary: 'Taught numbers' }),
        lesson(2, { archived: true }),
        lesson(3),
      ],
      lessonId: 'lesson-3',
    });

    expect(context.outline.map((l) => l.title)).toEqual([
      'Lesson 1',
      'Lesson 3',
    ]);
    expect(context.earlierSummaries).toEqual([
      { title: 'Lesson 1', summary: 'Taught numbers' },
    ]);
  });
});
