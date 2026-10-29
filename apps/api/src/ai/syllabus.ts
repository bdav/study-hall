import { z } from 'zod';

/** Sonnet-class model for generation (courses-plan.md, AI platform). */
export const SYLLABUS_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const SYLLABUS_PROMPT_VERSION = 'syllabus-v3';

const text = z.string().trim().min(1);

export const syllabusOutputSchema = z.object({
  lessons: z
    .array(
      z.object({
        title: text,
        objectives: z.array(text).min(1),
      }),
    )
    .min(1),
});

export type SyllabusOutput = z.infer<typeof syllabusOutputSchema>;

/**
 * A Syllabus Proposal's lessons as stored. The model always gives
 * objectives, but a lesson the learner added by its title may have none yet.
 */
export const proposalLessonsSchema = z
  .array(z.object({ title: text, objectives: z.array(text) }))
  .min(1);

/**
 * The learner's edits to a proposal's lessons, bounded, since every lesson
 * is stored and sent to the model when the proposal is regenerated.
 */
export const proposalEditSchema = z
  .array(
    z.object({
      title: text.max(200),
      objectives: z.array(text.max(500)).max(20),
    }),
  )
  .min(1)
  .max(100);

/** Reads the lessons stored on a Syllabus Proposal. */
export function parseProposalLessons(lessons: unknown) {
  return proposalLessonsSchema.parse(lessons);
}

const optionalText = z.string().trim().default('');

/** The learner's setup answers from the course form. */
export const courseSetupSchema = z.object({
  topic: text,
  goal: text,
  priorKnowledge: optionalText,
  timePerWeek: text,
  depth: text,
  notes: optionalText,
});

export type CourseSetup = z.infer<typeof courseSetupSchema>;

export const SYLLABUS_SYSTEM_PROMPT = `You design syllabi for self-directed learners.

A syllabus is an ordered list of lessons. Its order is the teaching sequence: each lesson may build only on lessons that come before it.

For each lesson give a short title and two to five learning objectives. A learning objective is a short statement of what the lesson should enable the learner to do, starting with a verb, such as "Order food and drinks in a café".

Fit the number and size of lessons to the learner's goal, prior knowledge, available time and preferred depth. Skip material the learner already knows.

Settle any choice the whole course depends on, such as which variety of a language or which version of a framework to learn: take it from what the learner said, or else choose the most common option, and name it in the first lesson's objectives, so every lesson follows it. Never make such a choice an objective for the learner to make: later lessons are written without knowing what they chose.`;

/** The setup answers as prompt lines, for every course generation call. */
export function formatCourseSetup(setup: CourseSetup): string[] {
  return [
    `Topic: ${setup.topic}`,
    `Goal or target level: ${setup.goal}`,
    `Prior knowledge: ${setup.priorKnowledge || 'None given'}`,
    `Time per week: ${setup.timePerWeek}`,
    `Preferred depth: ${setup.depth}`,
    `Notes: ${setup.notes || 'None'}`,
  ];
}

/**
 * What regenerating a proposal builds on: the learner's feedback so far,
 * oldest first, and the proposal as they left it.
 */
export type Regeneration = {
  feedback: string[];
  lessons: z.infer<typeof proposalLessonsSchema>;
};

export function buildSyllabusPrompt(
  setup: CourseSetup,
  regeneration?: Regeneration,
): string {
  if (!regeneration) {
    return [
      ...formatCourseSetup(setup),
      '',
      'Propose a syllabus for this learner.',
    ].join('\n');
  }

  return [
    ...formatCourseSetup(setup),
    '',
    'Your last proposal, as the learner left it:',
    ...regeneration.lessons.flatMap(({ title, objectives }, index) => [
      `${index + 1}. ${title}`,
      ...(objectives.length > 0
        ? objectives.map((objective) => `  - ${objective}`)
        : ['  (no learning objectives yet)']),
    ]),
    '',
    "The learner's feedback, oldest first:",
    ...regeneration.feedback.map((item, index) => `${index + 1}. ${item}`),
    '',
    "Propose the syllabus again, following the learner's feedback, the latest most of all. Keep what the feedback doesn't ask to change, including the learner's own edits to the last proposal.",
  ].join('\n');
}
