import { z } from 'zod';
import { type CourseSetup, formatCourseSetup } from './syllabus.js';

/** Sonnet-class model for generation (courses-plan.md, AI platform). */
export const LESSON_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const LESSON_PROMPT_VERSION = 'lesson-v2';

const text = z.string().trim().min(1);

/** How a fill-in-the-blank prompt marks its gap. */
export const BLANK = '___';

/** A gap as the page finds it: three or more underscores. */
const GAP = /_{3,}/g;

const exerciseSchema = z.discriminatedUnion('type', [
  /**
   * A short answer or translation, matched against expected answers. Open
   * when right answers can be phrased in ways no list covers (ADR-0005).
   */
  z.object({
    type: z.literal('SHORT_ANSWER'),
    prompt: text,
    expectedAnswers: z.array(text).min(1),
    open: z.boolean(),
  }),
  /** A prompt with a gap marked `___`, matched against expected answers. */
  z.object({
    type: z.literal('FILL_IN_THE_BLANK'),
    prompt: text.refine((prompt) => prompt.match(GAP)?.length === 1, {
      message: `A fill-in-the-blank prompt marks exactly one gap with ${BLANK}`,
    }),
    expectedAnswers: z.array(text).min(1),
  }),
  /** A free-form explanation, evaluated against the points it should make. */
  z.object({
    type: z.literal('FREE_FORM_EXPLANATION'),
    prompt: text,
    expectedPoints: z.array(text).min(1),
  }),
]);

export const lessonOutputSchema = z.object({
  content: z
    .array(z.object({ heading: text, paragraphs: z.array(text).min(1) }))
    .min(1),
  examples: z.array(z.object({ example: text, explanation: text })).min(1),
  exercises: z.array(exerciseSchema).min(1),
  summary: text,
});

export type LessonOutput = z.infer<typeof lessonOutputSchema>;

/** Reads the content blocks stored on a Lesson Version. */
export function parseLessonContent(content: unknown) {
  return lessonOutputSchema.shape.content.parse(content);
}

/** Reads the examples stored on a Lesson Version. */
export function parseLessonExamples(examples: unknown) {
  return lessonOutputSchema.shape.examples.parse(examples);
}

/**
 * What an exercise is evaluated against, and whether it is open, as stored
 * on an Exercise. Fill-in-the-blanks are always closed and free-form
 * explanations always open (ADR-0005).
 */
export function exerciseExpectations(
  exercise: LessonOutput['exercises'][number],
) {
  switch (exercise.type) {
    case 'SHORT_ANSWER':
      return {
        expectedAnswers: exercise.expectedAnswers,
        expectedPoints: [],
        open: exercise.open,
      };
    case 'FILL_IN_THE_BLANK':
      return {
        expectedAnswers: exercise.expectedAnswers,
        expectedPoints: [],
        open: false,
      };
    case 'FREE_FORM_EXPLANATION':
      return {
        expectedAnswers: [],
        expectedPoints: exercise.expectedPoints,
        open: true,
      };
  }
}

/** A lesson in the syllabus, with its current version's summary if it has one. */
export type SyllabusLesson = {
  id: string;
  title: string;
  objectives: string[];
  position: number;
  archivedAt: Date | null;
  summary: string | null;
};

type LessonOutline = { title: string; objectives: string[] };

export type LessonContext = {
  setup: CourseSetup;
  outline: LessonOutline[];
  earlierSummaries: { title: string; summary: string }[];
  lesson: LessonOutline;
};

/**
 * What generating a lesson builds on (courses-plan.md, Lesson generation
 * context). Only lessons earlier in syllabus order lend their summaries, so
 * the syllabus, not the order the learner opens lessons in, decides what a
 * lesson builds on. Archived lessons are no longer part of the syllabus.
 */
export function assembleLessonContext({
  setup,
  lessons,
  lessonId,
}: {
  setup: CourseSetup;
  lessons: SyllabusLesson[];
  lessonId: string;
}): LessonContext {
  const current = lessons.find((lesson) => lesson.id === lessonId);
  if (!current) throw new Error(`Lesson ${lessonId} is not in the syllabus`);

  const syllabus = lessons
    .filter((lesson) => lesson.archivedAt === null)
    .sort((a, b) => a.position - b.position);

  return {
    setup,
    outline: syllabus.map(({ title, objectives }) => ({ title, objectives })),
    earlierSummaries: syllabus.flatMap(({ title, position, summary }) =>
      position < current.position && summary !== null
        ? [{ title, summary }]
        : [],
    ),
    lesson: { title: current.title, objectives: current.objectives },
  };
}

export const LESSON_SYSTEM_PROMPT = `You write lessons for self-directed learners, one lesson of a course's syllabus at a time.

A lesson has:
- Content: a few short sections, each with a heading and one or more paragraphs, that teach the lesson's learning objectives.
- Examples that show the material in use, each with a short explanation.
- Exercises that practise the objectives:
  - SHORT_ANSWER: a short answer or translation, with every answer you would accept, marked closed or open:
    - Closed (open: false) when your expected answers are the complete list of right answers, such as a capital, a date, a number or a single word. An answer that matches none of them is marked wrong.
    - Open (open: true) when right answers can be phrased in ways no list covers, such as translating a sentence. An answer that matches none of them is judged by a reviewer.
  - FILL_IN_THE_BLANK: a prompt with exactly one gap, marked ${BLANK}, with every answer you would accept for the gap.
  - FREE_FORM_EXPLANATION: a question the learner answers in their own words, with the points a good answer makes.
- A Lesson Summary: a compact record of the rules, vocabulary and material this lesson introduced and practised, so later lessons can build on it. It records what was taught, not what the learner learned.

Teach only this lesson's objectives. Build on what earlier lessons taught, as their summaries describe, and leave material for later lessons in the syllabus to them. Fit the depth and tone to the learner's goal, prior knowledge and preferred depth.`;

export function buildLessonPrompt(context: LessonContext): string {
  const list = (items: string[]) => items.map((item) => `  - ${item}`);

  return [
    ...formatCourseSetup(context.setup),
    '',
    'Syllabus, in teaching order:',
    ...context.outline.flatMap((lesson, index) => [
      `${index + 1}. ${lesson.title}`,
      ...list(lesson.objectives),
    ]),
    '',
    'What earlier lessons taught:',
    ...(context.earlierSummaries.length > 0
      ? context.earlierSummaries.map(
          ({ title, summary }) => `- ${title}: ${summary}`,
        )
      : ['- Nothing yet: no earlier lesson has been written.']),
    '',
    `Write the lesson "${context.lesson.title}", with these learning objectives:`,
    ...list(context.lesson.objectives),
  ].join('\n');
}
