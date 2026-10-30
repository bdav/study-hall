import { describe, it, expect } from 'vitest';
import { assembleTutorContext, buildTutorRequest } from './tutor.js';

const setup = {
  topic: 'Italian',
  goal: 'A2 by summer',
  priorKnowledge: 'Some Duolingo',
  minutesPerWeek: 180,
  sessionMinutes: 30,
  deadline: null,
  depth: 'Practical',
  notes: '',
};

const lessons = [
  {
    id: 'cafe',
    title: 'At the café',
    objectives: ['Order food and drinks'],
    position: 1,
    archivedAt: null,
  },
  {
    id: 'greetings',
    title: 'Greetings',
    objectives: ['Greet someone formally'],
    position: 0,
    archivedAt: null,
  },
  {
    id: 'dropped',
    title: 'Dialects',
    objectives: ['Recognise Neapolitan'],
    position: 2,
    archivedAt: new Date('2026-10-01'),
  },
];

const version = {
  content: [
    {
      heading: 'Saying hello',
      paragraphs: ['Italian has a formal and an informal hello.'],
    },
  ],
  examples: [{ example: 'Ciao, Marco!', explanation: 'An informal hello.' }],
};

const noAnswerKey = {
  expectedAnswers: [],
  essentialPoints: [],
  supplementaryPoints: [],
  expectedPoints: [],
};

/** The version's exercises, with attempts made since any Start over. */
const exercises = [
  {
    id: 'translate',
    position: 0,
    type: 'SHORT_ANSWER' as const,
    prompt: 'Translate: Good morning',
    ...noAnswerKey,
    expectedAnswers: ['Buongiorno'],
    attempts: [
      {
        answer: 'Buonasera',
        evaluation: 'INCORRECT' as const,
        accentCorrection: null,
        feedback: null,
        createdAt: new Date('2026-10-28T10:05:00Z'),
      },
      {
        answer: 'Buon giorno',
        evaluation: 'INCORRECT' as const,
        accentCorrection: null,
        feedback: null,
        createdAt: new Date('2026-10-28T10:01:00Z'),
      },
    ],
  },
  {
    id: 'gap',
    position: 1,
    type: 'FILL_IN_THE_BLANK' as const,
    prompt: '___, Marco!',
    ...noAnswerKey,
    expectedAnswers: ['Salve'],
    attempts: [],
  },
  {
    id: 'explain',
    position: 2,
    type: 'FREE_FORM_EXPLANATION' as const,
    prompt: 'When would you say buonasera?',
    ...noAnswerKey,
    essentialPoints: ['It greets someone in the evening'],
    supplementaryPoints: ['Buonanotte is for parting at night'],
    attempts: [
      {
        answer: 'At night',
        evaluation: 'PARTIALLY_CORRECT' as const,
        accentCorrection: null,
        feedback: 'Close: it greets, from late afternoon on.',
        createdAt: new Date('2026-10-28T10:10:00Z'),
      },
    ],
  },
];

function context(
  history: { role: 'LEARNER' | 'TUTOR'; content: string }[],
  currentExerciseId: string | null = null,
) {
  return assembleTutorContext({
    setup,
    lessons,
    lessonId: 'greetings',
    version,
    exercises,
    currentExerciseId,
    history,
  });
}

/** Every word a tutor request sends to the model. */
function sentText(request: ReturnType<typeof buildTutorRequest>) {
  return JSON.stringify(request);
}

describe('assembleTutorContext', () => {
  it('outlines the active syllabus in order, marking the current lesson', () => {
    expect(context([]).outline).toEqual([
      {
        title: 'Greetings',
        objectives: ['Greet someone formally'],
        current: true,
      },
      {
        title: 'At the café',
        objectives: ['Order food and drinks'],
        current: false,
      },
    ]);
  });

  it("holds the current lesson and its version's content and examples", () => {
    expect(context([]).lesson).toEqual({
      title: 'Greetings',
      objectives: ['Greet someone formally'],
      ...version,
    });
  });

  it('throws for a lesson not in the syllabus', () => {
    expect(() =>
      assembleTutorContext({
        setup,
        lessons,
        lessonId: 'missing',
        version,
        exercises,
        currentExerciseId: null,
        history: [],
      }),
    ).toThrow();
  });

  it('numbers the exercises in order and marks the one the learner is on', () => {
    expect(
      context([], 'gap').exercises.map(({ number, current }) => ({
        number,
        current,
      })),
    ).toEqual([
      { number: 1, current: false },
      { number: 2, current: true },
      { number: 3, current: false },
    ]);
  });

  it('marks no exercise when the learner is on none, or on one the version lacks', () => {
    expect(context([]).exercises.some(({ current }) => current)).toBe(false);
    expect(
      context([], 'elsewhere').exercises.some(({ current }) => current),
    ).toBe(false);
  });

  it("gives each exercise the learner's attempts, oldest first", () => {
    const [translate, gap, explain] = context([]).exercises;

    expect(translate.attempts.map(({ answer }) => answer)).toEqual([
      'Buon giorno',
      'Buonasera',
    ]);
    expect(gap.attempts).toEqual([]);
    expect(explain.attempts).toEqual([
      expect.objectContaining({
        answer: 'At night',
        evaluation: 'PARTIALLY_CORRECT',
        feedback: 'Close: it greets, from late afternoon on.',
      }),
    ]);
  });

  it('withholds the answer key of an exercise the learner has not attempted', () => {
    const [translate, gap, explain] = context([], 'gap').exercises;

    expect(gap.answerKey).toBeNull();
    expect(translate.answerKey).toEqual({
      expectedAnswers: ['Buongiorno'],
      essentialPoints: [],
      supplementaryPoints: [],
      expectedPoints: [],
    });
    expect(explain.answerKey).toEqual({
      expectedAnswers: [],
      essentialPoints: ['It greets someone in the evening'],
      supplementaryPoints: ['Buonanotte is for parting at night'],
      expectedPoints: [],
    });
  });
});

describe('buildTutorRequest', () => {
  it("lists the exercises' prompts in the cached lesson, without answers", () => {
    const { system } = buildTutorRequest(context([]), 'Hi');
    const lesson = system.find((block) => block.cache);

    expect(lesson?.text).toContain('Translate: Good morning');
    expect(lesson?.text).toContain('___, Marco!');
    expect(lesson?.text).not.toContain('Buongiorno');
    expect(lesson?.text).not.toContain('Buonasera');
  });

  it('never sends the answer of an exercise the learner has not attempted', () => {
    const request = buildTutorRequest(context([], 'gap'), 'What goes here?');

    expect(sentText(request)).not.toContain('Salve');
  });

  it('sends the practice so far with the new message, after the cached prefix', () => {
    const { messages } = buildTutorRequest(
      context(
        [
          { role: 'LEARNER', content: 'Hi' },
          { role: 'TUTOR', content: 'Ciao!' },
        ],
        'translate',
      ),
      'Why was mine wrong?',
    );

    // Earlier messages go as they were stored
    expect(messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Ciao!' },
    ]);
    const latest = messages[2].content;
    expect(latest).toMatch(/^<practice>/);
    expect(latest).toMatch(/on exercise 1/i);
    expect(latest).toContain('Buon giorno');
    expect(latest).toContain('Buonasera');
    expect(latest).toContain('Buongiorno');
    expect(latest).toContain('It greets someone in the evening');
    expect(latest).toContain('Close: it greets, from late afternoon on.');
    expect(latest.endsWith('Why was mine wrong?')).toBe(true);
  });

  it("says when the learner isn't on an exercise", () => {
    const { messages } = buildTutorRequest(context([]), 'Hi');

    expect(messages.at(-1)?.content).toMatch(/not on an exercise/i);
  });

  it('gives the tutor its rules, then the course and lesson, the lesson cached', () => {
    const { system } = buildTutorRequest(context([]), 'What does ciao mean?');

    expect(system).toHaveLength(2);
    const [rules, lesson] = system;
    expect(rules.cache).toBeFalsy();
    expect(rules.text).toMatch(/ask/i);
    expect(lesson.cache).toBe(true);
    expect(lesson.text).toContain('Goal or target level: A2 by summer');
    expect(lesson.text).toContain('Greetings');
    expect(lesson.text).toContain('At the café');
    expect(lesson.text).toContain(
      'Italian has a formal and an informal hello.',
    );
    expect(lesson.text).toContain('Ciao, Marco!');
    expect(lesson.text).toContain('An informal hello.');
  });

  it('leaves archived lessons out of the syllabus it shows', () => {
    const { system } = buildTutorRequest(context([]), 'Hi');

    expect(system.map((block) => block.text).join('\n')).not.toContain(
      'Dialects',
    );
  });

  it('sends the thread so far, then the new message', () => {
    const { messages } = buildTutorRequest(
      context([
        { role: 'LEARNER', content: 'What does ciao mean?' },
        { role: 'TUTOR', content: 'What do you think it means?' },
      ]),
      'Hello?',
    );

    expect(messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'What does ciao mean?' },
      { role: 'assistant', content: 'What do you think it means?' },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[2].role).toBe('user');
    expect(messages[2].content.endsWith('Hello?')).toBe(true);
  });
});
