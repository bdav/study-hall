import { z } from 'zod';

/** Sonnet-class model for generation (courses-plan.md, AI platform). */
export const SYLLABUS_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const SYLLABUS_PROMPT_VERSION = 'syllabus-v1';

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

/** Reads the lessons stored on a Syllabus Proposal. */
export function parseProposalLessons(lessons: unknown) {
  return syllabusOutputSchema.shape.lessons.parse(lessons);
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

Fit the number and size of lessons to the learner's goal, prior knowledge, available time and preferred depth. Skip material the learner already knows.`;

export function buildSyllabusPrompt(setup: CourseSetup): string {
  return [
    `Topic: ${setup.topic}`,
    `Goal or target level: ${setup.goal}`,
    `Prior knowledge: ${setup.priorKnowledge || 'None given'}`,
    `Time per week: ${setup.timePerWeek}`,
    `Preferred depth: ${setup.depth}`,
    `Notes: ${setup.notes || 'None'}`,
    '',
    'Propose a syllabus for this learner.',
  ].join('\n');
}
