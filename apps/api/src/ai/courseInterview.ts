import { z } from 'zod';

/** Sonnet-class model for the Setup Interview (spec #63). */
export const INTERVIEW_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const INTERVIEW_PROMPT_VERSION = 'course-interview-v1';

/** The most rounds of questions a Setup Interview asks. */
export const MAX_INTERVIEW_ROUNDS = 3;

/** The depths a course can be pitched at, as the course form offers them. */
export const COURSE_DEPTHS = [
  'Light overview',
  'Balanced',
  'In depth',
] as const;

/** The session lengths the course form offers, in minutes. */
export const SESSION_LENGTHS = [15, 30, 45, 60, 90] as const;

const text = z.string().trim().min(1);

/**
 * One question of a round: single choice, answered with a chip, or free
 * text. Each comes with the answer the model suggests, which the page
 * starts selected or filled in.
 */
export const interviewQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SINGLE_CHOICE'),
    prompt: text.max(300),
    // Two to six from the model, and the suggested answer when they left
    // it out (withSuggestionOffered)
    options: z.array(text.max(100)).min(2).max(7),
    suggested: text.max(100),
  }),
  z.object({
    type: z.literal('FREE_TEXT'),
    prompt: text.max(300),
    suggested: z.string().trim().max(1000),
  }),
]);

export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

/**
 * The Course Setup as the interview has drafted it so far: blank, empty or
 * null where it doesn't know yet, for the learner to check on the course
 * form.
 */
const draftSetupSchema = z.object({
  title: z.string().trim(),
  topic: z.string().trim(),
  goal: z.string().trim(),
  priorKnowledge: z.string().trim(),
  canAlreadyDo: z.array(text),
  minutesPerWeek: z.number().int().positive().nullable(),
  // Any whole minutes, since structured output can't hold the model to the
  // form's lengths; snapped to the nearest of them (nearestSessionLength)
  sessionMinutes: z.number().int().positive().nullable(),
  /** A date with no time, "2027-06-01" */
  deadline: z.iso.date().nullable(),
  depth: z.enum(COURSE_DEPTHS),
  focus: z.string().trim(),
  skip: z.string().trim(),
  materials: z.string().trim(),
  notes: z.string().trim(),
});

export type DraftSetup = z.infer<typeof draftSetupSchema>;

export const interviewOutputSchema = z.object({
  draft: draftSetupSchema,
  /** True once nothing important is left to ask */
  ready: z.boolean(),
  /** The next round's questions, two to four; none once ready */
  questions: z.array(interviewQuestionSchema).max(4),
});

/** A round of questions with the learner's answer to each, in order. */
export const answeredRoundSchema = z
  .object({
    questions: z.array(interviewQuestionSchema).min(1).max(4),
    answers: z.array(z.string().trim().max(1000)),
  })
  .refine((round) => round.answers.length === round.questions.length, {
    message: 'Every question needs an answer',
  });

export type AnsweredRound = z.infer<typeof answeredRoundSchema>;

/**
 * The interview so far, as the page holds it: the server keeps no
 * interview state.
 */
export const interviewSchema = z.object({
  opening: z.string().trim().min(1).max(2000),
  rounds: z.array(answeredRoundSchema).max(MAX_INTERVIEW_ROUNDS),
});

export type Interview = z.infer<typeof interviewSchema>;

/**
 * An interview's transcript as course creation keeps it: with the model and
 * prompt version that asked its latest round, as the round returned them.
 */
export const transcriptSchema = interviewSchema.extend({
  model: z.string().max(100),
  promptVersion: z.string().max(100),
});

/** "a, b or c" */
function listed(items: readonly (string | number)[]): string {
  return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

/**
 * Adapts Claude Study Agent's /generate-plan coverage (what to find out) and
 * the grilling skill's rules (how to ask).
 */
export const INTERVIEW_SYSTEM_PROMPT = `You interview a learner who is starting a self-directed course, to draft its Course Setup: the brief a syllabus, its lessons and a tutor are all written from. The learner has said in their own words what they want to learn and why. You ask only what that leaves open, in short rounds, then stop.

What the Course Setup covers:
- title: a short name that tells this course apart from others on the same topic, such as "Italian for a trip to Rome"
- topic, and goal or target level
- prior knowledge, in the learner's words, and canAlreadyDo: specific things they can already do, so the syllabus leaves them out
- minutesPerWeek: the time they can give it each week, in minutes
- sessionMinutes: how long one sitting is, one of ${listed(SESSION_LENGTHS)}; each lesson is sized to one
- deadline: a date they need to be ready by, such as an exam or a trip, as YYYY-MM-DD. Turn relative timing ("in about two months", "by the summer") into a date from today's date
- depth: ${listed(COURSE_DEPTHS)}
- focus and skip: what to weight the course toward, and what to leave out
- materials: a textbook, course or other resource they're following
- notes: anything else the course should know

How to ask:
- Ask only what is unsettled. Never ask something the learner has already said, in their opening words or an earlier answer.
- A round has two to four questions, on one screen, so ask together what goes together.
- Every question comes with a suggested answer: the one most likely for this learner, given what they've said. For a SINGLE_CHOICE question, give two to six short options, and the suggested answer must be one of them. Use FREE_TEXT when no short list of options fits, with a suggested answer the learner can accept or edit.
- Ask about what changes the course most first: the goal, time per week, session length and any deadline, then prior knowledge, focus, skip and materials.
- When the learner's words leave open a choice the whole course depends on, such as which variety of a language, which exam board or which version of a framework, ask it, suggesting the most common option, and record the answer in the draft's notes, so every lesson follows it.
- Don't ask about review days, how a study day is structured, or kinds of practice: the app schedules reviews and writes each lesson's exercises.
- Stop once nothing important is left to assume: set ready to true and give no questions. A short interview is a good one.

Every time, give the draft: the Course Setup as everything said so far settles it, your suggested answers included where the learner accepted them. Leave a field blank, empty or null where nothing settles it yet; don't invent a deadline, materials or prior knowledge.`;

const WEEKDAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  timeZone: 'UTC',
});

/** A round as the model reads it back: each question with its answer. */
function describeRound({ questions, answers }: AnsweredRound): string[] {
  return questions.flatMap((question, index) => [
    `- Question: ${question.prompt}`,
    ...(question.type === 'SINGLE_CHOICE'
      ? [`  Options: ${question.options.join(' / ')}`]
      : []),
    `  Answer: <answer>${answers[index] || '(left blank)'}</answer>`,
  ]);
}

export function buildInterviewPrompt(
  { opening, rounds }: Interview,
  now: Date,
): string {
  const today = now.toISOString().slice(0, 10);
  const roundsLeft = MAX_INTERVIEW_ROUNDS - rounds.length;

  return [
    `Today is ${WEEKDAY.format(now)} ${today}.`,
    '',
    'What the learner wants to learn, and why, in their words:',
    `<opening>${opening}</opening>`,
    '',
    ...(rounds.length > 0
      ? [
          'Rounds so far, oldest first:',
          ...rounds.flatMap((round, index) => [
            `Round ${index + 1}:`,
            ...describeRound(round),
          ]),
        ]
      : ['No questions have been asked yet.']),
    '',
    roundsLeft > 0
      ? `Give your draft, and ask the next round unless nothing important is left to ask. ${roundsLeft === 1 ? 'This is the last round you can ask.' : `You can ask at most ${roundsLeft} more rounds.`}`
      : 'No rounds are left to ask: set ready to true, and give your final draft.',
  ].join('\n');
}

/**
 * The model's round as the page shows it: a suggested answer the options
 * leave out is offered first, so it can start selected.
 */
export function withSuggestionOffered(
  question: InterviewQuestion,
): InterviewQuestion {
  if (
    question.type !== 'SINGLE_CHOICE' ||
    question.options.includes(question.suggested)
  ) {
    return question;
  }
  return { ...question, options: [question.suggested, ...question.options] };
}

/** The session length the form offers nearest to the minutes given. */
export function nearestSessionLength(minutes: number): number {
  return SESSION_LENGTHS.reduce((nearest, length) =>
    Math.abs(length - minutes) < Math.abs(nearest - minutes) ? length : nearest,
  );
}
