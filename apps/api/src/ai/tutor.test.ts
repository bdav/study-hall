import { describe, it, expect } from 'vitest';
import { assembleTutorContext, buildTutorRequest } from './tutor.js';

const setup = {
  topic: 'Italian',
  goal: 'A2 by summer',
  priorKnowledge: 'Some Duolingo',
  timePerWeek: '3 hours',
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

function context(history: { role: 'LEARNER' | 'TUTOR'; content: string }[]) {
  return assembleTutorContext({
    setup,
    lessons,
    lessonId: 'greetings',
    version,
    history,
  });
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
        history: [],
      }),
    ).toThrow();
  });
});

describe('buildTutorRequest', () => {
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

    expect(messages).toEqual([
      { role: 'user', content: 'What does ciao mean?' },
      { role: 'assistant', content: 'What do you think it means?' },
      { role: 'user', content: 'Hello?' },
    ]);
  });
});
