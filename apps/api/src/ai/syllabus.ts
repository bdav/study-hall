import { z } from 'zod';

/** Sonnet-class model for generation (courses-plan.md, AI platform). */
export const SYLLABUS_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const SYLLABUS_PROMPT_VERSION = 'syllabus-v5';

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
 * What a learner can ask of a regenerated Syllabus Proposal with a tap,
 * each reaching the model as a fixed instruction
 * (SYLLABUS_CHIP_INSTRUCTIONS).
 */
export const SYLLABUS_FEEDBACK_CHIPS = [
  'FEWER_LESSONS',
  'MORE_LESSONS',
  'START_EASIER',
  'START_FURTHER_ALONG',
  'MORE_PRACTICAL',
  'MORE_IN_DEPTH',
] as const;

export type SyllabusFeedbackChip = (typeof SYLLABUS_FEEDBACK_CHIPS)[number];

export const syllabusFeedbackChipSchema = z.enum(SYLLABUS_FEEDBACK_CHIPS);

/** Chips asking for opposite things: a learner picks one of each pair. */
export const OPPOSITE_SYLLABUS_CHIPS: [
  SyllabusFeedbackChip,
  SyllabusFeedbackChip,
][] = [
  ['FEWER_LESSONS', 'MORE_LESSONS'],
  ['START_EASIER', 'START_FURTHER_ALONG'],
];

const SYLLABUS_CHIP_INSTRUCTIONS: Record<SyllabusFeedbackChip, string> = {
  FEWER_LESSONS:
    'Fewer lessons: cover the goal in fewer, larger lessons, merging related ones and dropping the least essential.',
  MORE_LESSONS:
    'More lessons: split the material into more, smaller lessons, and add any the goal needs.',
  START_EASIER:
    'Start easier: assume less of what the learner already knows, and begin with the basics.',
  START_FURTHER_ALONG:
    'Start further along: assume more of what the learner already knows, and skip or compress the basics.',
  MORE_PRACTICAL:
    'More practical: aim the lessons at things the learner will do, with less theory for its own sake.',
  MORE_IN_DEPTH:
    'More in depth: go further into each topic, covering how and why as well as what.',
};

/**
 * One regeneration's feedback as stored: the chips chosen and the learner's
 * words. Regenerating asks for a chip or some words (the router checks it).
 * A chip no longer offered is passed over, so an old round still reads.
 */
const feedbackRoundSchema = z.object({
  chips: z
    .array(z.string())
    .transform((chips) =>
      chips.filter(
        (chip): chip is SyllabusFeedbackChip =>
          syllabusFeedbackChipSchema.safeParse(chip).success,
      ),
    ),
  text: z.string().nullable(),
});

export type FeedbackRound = z.infer<typeof feedbackRoundSchema>;

/** Reads the feedback rounds stored on a Syllabus Proposal, oldest first. */
export function parseFeedbackRounds(feedback: unknown): FeedbackRound[] {
  return z.array(feedbackRoundSchema).parse(feedback);
}

/**
 * The most lessons a proposal or Syllabus holds, since every lesson goes to
 * the model with each regeneration, lesson and tutor reply.
 */
export const MAX_LESSONS = 100;

/** A lesson's title and learning objectives as the learner edits them. */
export const lessonTitleSchema = text.max(200);
export const objectivesSchema = z.array(text.max(500)).max(20);

/**
 * The learner's edits to a proposal's lessons, bounded, since every lesson
 * is stored and sent to the model when the proposal is regenerated.
 */
export const proposalEditSchema = z
  .array(
    z.object({
      title: lessonTitleSchema,
      objectives: objectivesSchema,
    }),
  )
  .min(1)
  .max(MAX_LESSONS);

/** Reads the lessons stored on a Syllabus Proposal. */
export function parseProposalLessons(lessons: unknown) {
  return proposalLessonsSchema.parse(lessons);
}

const optionalText = z.string().trim().default('');

/** The most minutes in a week, bounding time per week and session length. */
const MINUTES_IN_A_WEEK = 7 * 24 * 60;

/**
 * A course's Course Setup as stored. Older courses may have no time per week
 * or session length, or a time per week read from free text past the bound
 * a new course's has, so stored amounts are read unbounded.
 */
export const courseSetupSchema = z.object({
  topic: text,
  goal: text,
  priorKnowledge: optionalText,
  minutesPerWeek: z.number().int().nullable(),
  sessionMinutes: z.number().int().nullable(),
  depth: text,
  notes: optionalText,
});

export type CourseSetup = z.infer<typeof courseSetupSchema>;

const minutes = z.number().int().positive().max(MINUTES_IN_A_WEEK);

/** A new course's Course Setup, from the course form. */
export const newCourseSetupSchema = courseSetupSchema.extend({
  minutesPerWeek: minutes,
  sessionMinutes: minutes,
});

export const SYLLABUS_SYSTEM_PROMPT = `You design syllabi for self-directed learners.

A syllabus is an ordered list of lessons. Its order is the teaching sequence: each lesson may build only on lessons that come before it.

For each lesson give a short title and two to five learning objectives. A learning objective is a short statement of what the lesson should enable the learner to do, starting with a verb, such as "Order food and drinks in a café".

Size each lesson to one session: a learner should be able to work through it, reading and practice included, in one sitting of their session length. Fit the number of lessons to the learner's goal, prior knowledge, time per week and preferred depth. Skip material the learner already knows.

Settle any choice the whole course depends on, such as which variety of a language or which version of a framework to learn: take it from what the learner said, or else choose the most common option, and name it in the first lesson's objectives, so every lesson follows it. Never make such a choice an objective for the learner to make: later lessons are written without knowing what they chose.`;

/**
 * An amount of time for a setup line, in hours and minutes ("1 hour 30
 * minutes"), or "Not given" for an older course without it.
 */
function formatMinutes(total: number | null): string {
  if (total === null) return 'Not given';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const plural = (count: number, unit: string) =>
    `${count} ${unit}${count === 1 ? '' : 's'}`;
  return [
    ...(hours > 0 ? [plural(hours, 'hour')] : []),
    ...(rest > 0 ? [plural(rest, 'minute')] : []),
  ].join(' ');
}

/** The Course Setup as prompt lines, for every course generation call. */
export function formatCourseSetup(setup: CourseSetup): string[] {
  return [
    `Topic: ${setup.topic}`,
    `Goal or target level: ${setup.goal}`,
    `Prior knowledge: ${setup.priorKnowledge || 'None given'}`,
    `Time per week: ${formatMinutes(setup.minutesPerWeek)}`,
    `Session length: ${formatMinutes(setup.sessionMinutes)}`,
    `Preferred depth: ${setup.depth}`,
    `Notes: ${setup.notes || 'None'}`,
  ];
}

/**
 * What regenerating a proposal builds on: the learner's feedback so far,
 * a round per regeneration, oldest first, and the proposal as they left it.
 */
export type Regeneration = {
  feedback: FeedbackRound[];
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
    "The learner's feedback, a round for each proposal they asked for again, oldest first:",
    ...regeneration.feedback.flatMap(({ chips, text }, index) => [
      `Round ${index + 1}:`,
      ...chips.map((chip) => `- ${SYLLABUS_CHIP_INSTRUCTIONS[chip]}`),
      ...(text ? [`- In their words: <feedback>${text}</feedback>`] : []),
    ]),
    '',
    "Propose the syllabus again, following the learner's feedback, the latest most of all. Keep what the feedback doesn't ask to change, including the learner's own edits to the last proposal.",
  ].join('\n');
}
