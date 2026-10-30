import { z } from 'zod';
import { type ExerciseEvaluation } from '@prisma/client';
import { type CourseSetup, formatCourseSetup } from './syllabus.js';

/** Sonnet-class model for generation (courses-plan.md, AI platform). */
export const LESSON_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const LESSON_PROMPT_VERSION = 'lesson-v9';

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
  /**
   * A free-form explanation, judged on the Essential Points its question
   * asks for; Supplementary Points never decide it (ADR-0006).
   */
  z.object({
    type: z.literal('FREE_FORM_EXPLANATION'),
    prompt: text,
    essentialPoints: z.array(text).min(1).max(3),
    supplementaryPoints: z.array(text),
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

/** Every list an Exercise stores, empty, so no row leaves one unset. */
const NO_EXPECTATIONS = {
  expectedAnswers: [],
  essentialPoints: [],
  supplementaryPoints: [],
  // Only explanations generated before essential points (ADR-0006)
  expectedPoints: [],
};

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
        ...NO_EXPECTATIONS,
        expectedAnswers: exercise.expectedAnswers,
        open: exercise.open,
      };
    case 'FILL_IN_THE_BLANK':
      return {
        ...NO_EXPECTATIONS,
        expectedAnswers: exercise.expectedAnswers,
        open: false,
      };
    case 'FREE_FORM_EXPLANATION':
      return {
        ...NO_EXPECTATIONS,
        essentialPoints: exercise.essentialPoints,
        supplementaryPoints: exercise.supplementaryPoints,
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
  - FREE_FORM_EXPLANATION: a question the learner answers in their own words, with a rubric:
    - Essential points (one to three): what the question explicitly asks for, so an answer without one hasn't answered the question. Each must follow from the question's wording; if a detail matters enough to require, ask for it in the question. Describe each as an idea, not a phrasing the learner must reproduce.
    - Supplementary points (none or more): related details worth knowing that the question doesn't ask for. They never make an answer wrong.
    For example, "What does a hash table give up compared with a sorted array?" has the essential point "Keys have no order, so it can't list or search ranges in order", and might have the supplementary point "Lookups slow down when many keys collide". "Why did the printing press speed up the Reformation?" has the essential point "Printed pamphlets spread reformers' arguments faster and further than the Church could answer them", and might have the supplementary point "Luther wrote in German, so ordinary readers could follow".
    Include only points you're sure are accurate, with their conditions. Leave a supplementary point out rather than state an oversimplified rule.
- A Lesson Summary: a compact record of the rules, vocabulary and material this lesson introduced and practised, so later lessons can build on it. It records what was taught, not what the learner learned.

Teach only this lesson's objectives. Build on what earlier lessons taught, as their summaries describe, and leave material for later lessons in the syllabus to them. Fit the depth and tone to the learner's goal, prior knowledge and preferred depth. Size the lesson to one session: the learner should be able to read it and do its exercises in one sitting of their session length.`;

/**
 * What a learner can ask of a regeneration with a tap, each reaching the
 * model as a fixed instruction (CHIP_INSTRUCTIONS).
 */
export const LESSON_FEEDBACK_CHIPS = [
  'TOO_EASY',
  'TOO_HARD',
  'SHORTER',
  'LONGER',
  'MORE_EXAMPLES',
  'MORE_PRACTICE',
  'EXPLAIN_DIFFERENTLY',
  'MORE_REAL_WORLD',
  'FRESH_TAKE',
] as const;

export type LessonFeedbackChip = (typeof LESSON_FEEDBACK_CHIPS)[number];

export const lessonFeedbackChipSchema = z.enum(LESSON_FEEDBACK_CHIPS);

/** Chips asking for opposite things: a learner picks one of each pair. */
export const OPPOSITE_CHIPS: [LessonFeedbackChip, LessonFeedbackChip][] = [
  ['TOO_EASY', 'TOO_HARD'],
  ['SHORTER', 'LONGER'],
];

const CHIP_INSTRUCTIONS: Record<LessonFeedbackChip, string> = {
  TOO_EASY:
    'Make it harder: assume more of what earlier lessons taught, go further into the objectives, and make the exercises demand more, such as recall rather than recognition.',
  TOO_HARD:
    'Make it easier: explain each idea in smaller steps, assume less, and start the exercises gently.',
  SHORTER:
    'Make it shorter: fewer, tighter sections, keeping what the objectives need.',
  LONGER: 'Make it longer: more depth in each section, and more of each part.',
  MORE_EXAMPLES:
    'More examples: show each idea in use more often, each with its explanation.',
  MORE_PRACTICE: 'More practice: more exercises, covering every objective.',
  EXPLAIN_DIFFERENTLY:
    'Explain it differently: a new way into the same ideas, with other explanations and comparisons.',
  MORE_REAL_WORLD:
    'More real-world use: tie the ideas to situations the learner will meet, in the examples and the exercises.',
  FRESH_TAKE:
    'Write it again afresh: in other words, with other examples and exercises, teaching the same objectives.',
};

/** How each Exercise Attempt evaluation reads to the model. */
const RESULTS: Record<ExerciseEvaluation, string> = {
  CORRECT: 'right',
  PARTIALLY_CORRECT: 'partly right',
  INCORRECT: 'wrong',
};

/**
 * A regeneration of a written lesson: the version it replaces, with the
 * learner's latest result on each exercise since any Start over, and what
 * they asked for, by chip and in their own words.
 */
export type LessonRegeneration = {
  replacing: {
    content: LessonOutput['content'];
    examples: LessonOutput['examples'];
    exercises: {
      type: string;
      prompt: string;
      expected: string[];
      result: ExerciseEvaluation | null;
    }[];
  };
  chips: LessonFeedbackChip[];
  feedback: string | null;
};

export function buildLessonPrompt(
  context: LessonContext,
  regeneration?: LessonRegeneration,
): string {
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
    // A lesson the learner added by its title alone has no objectives yet
    ...(context.lesson.objectives.length > 0
      ? [
          `Write the lesson "${context.lesson.title}", with these learning objectives:`,
          ...list(context.lesson.objectives),
        ]
      : [
          `Write the lesson "${context.lesson.title}". It has no learning objectives yet: choose two to five that fit its title and its place in the syllabus, and teach those.`,
        ]),
    ...(regeneration ? describeRegeneration(regeneration) : []),
  ].join('\n');
}

/** The version a regeneration replaces, and what the learner asked for. */
function describeRegeneration({
  replacing,
  chips,
  feedback,
}: LessonRegeneration): string[] {
  return [
    '',
    'The learner has read this lesson and asked for it to be written again. The version they read, with how their latest answer to each exercise went:',
    '<replaced_version>',
    ...replacing.content.flatMap(({ heading, paragraphs }) => [
      `## ${heading}`,
      ...paragraphs,
    ]),
    '## Examples',
    ...replacing.examples.flatMap(({ example, explanation }) => [
      `- Example: ${example}`,
      `  Explanation: ${explanation}`,
    ]),
    '## Exercises',
    ...replacing.exercises.flatMap(({ type, prompt, expected, result }) => [
      `- ${type}: ${prompt}`,
      `  Expected: ${expected.length > 0 ? expected.join(' / ') : 'none recorded'}`,
      `  Learner's latest result: ${result ? RESULTS[result] : 'not tried'}`,
    ]),
    '</replaced_version>',
    '',
    ...(chips.length > 0
      ? [
          'What the learner asked for:',
          ...chips.map((chip) => `- ${CHIP_INSTRUCTIONS[chip]}`),
        ]
      : []),
    ...(feedback
      ? ['In their words:', `<feedback>${feedback}</feedback>`]
      : []),
    // A fresh take keeps nothing on purpose; anything else is a correction
    chips.includes('FRESH_TAKE')
      ? 'Write the lesson again, following what they asked for and weighing it against their results, and write new exercises.'
      : "Write the lesson again, following what they asked for and weighing it against their results. Keep what they didn't ask to change, and write new exercises.",
  ];
}
