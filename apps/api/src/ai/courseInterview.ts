import { z } from 'zod';

/** Sonnet-class model for the Setup Interview (spec #63). */
export const INTERVIEW_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt or output schema changes meaningfully. */
export const INTERVIEW_PROMPT_VERSION = 'course-interview-v3';

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

/** A date with no time, "2027-06-01", or blank for none. */
const dateOrNone = z.union([z.iso.date(), z.literal('')]);

const option = text.max(200);

/**
 * One question of a round: single or multiple choice, answered with chips
 * or in the learner's own words ("Something else…"), free text, a date,
 * answered with the course form's date picker, or the placement checklist.
 * Each but the checklist comes with the answer the model suggests, which
 * the page starts selected or filled in.
 */
export const interviewQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SINGLE_CHOICE'),
    prompt: text.max(300),
    // Two to six asked of the model, and the suggested answer when it left
    // it out (withSuggestionOffered); the bounds leave it room, so a round
    // isn't lost to an option too many
    options: z.array(option).min(2).max(12),
    suggested: option,
  }),
  z.object({
    type: z.literal('MULTIPLE_CHOICE'),
    prompt: text.max(300),
    // Two to eight asked of the model, and suggested answers it left out
    options: z.array(option).min(2).max(16),
    suggested: z.array(option).max(8),
  }),
  /**
   * "Which of these can you already do?": things the learner might already
   * be able to do, which start unticked, so they're never assumed to know
   * something. What they tick joins the draft's can already do list.
   */
  z.object({
    type: z.literal('PLACEMENT'),
    prompt: text.max(300),
    // Five to eight asked of the model
    options: z.array(option).min(2).max(12),
  }),
  z.object({
    type: z.literal('FREE_TEXT'),
    prompt: text.max(300),
    suggested: z.string().trim().max(1000),
  }),
  z.object({
    type: z.literal('DATE'),
    prompt: text.max(300),
    suggested: dateOrNone,
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
  canAlreadyDo: z.array(z.string().trim()),
  // 0 read as not given, as null is meant
  minutesPerWeek: z.number().int().nonnegative().nullable(),
  // Any whole minutes, since structured output can't hold the model to the
  // form's lengths; snapped to the nearest of them (nearestSessionLength)
  sessionMinutes: z.number().int().nonnegative().nullable(),
  /** A date with no time, "2027-06-01"; blank read as none, as null is meant */
  deadline: dateOrNone.nullable(),
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

/**
 * An answer: text, or the chips chosen or items ticked. A choice question
 * answered in the learner's own words ("Something else…") has text in place
 * of its chips.
 */
const answerSchema = z.union([
  z.string().trim().max(1000),
  z.array(option).max(16),
]);

type InterviewAnswer = z.infer<typeof answerSchema>;

/** Whether an answer fits its question's type and options. */
function fitsQuestion(question: InterviewQuestion, answer: InterviewAnswer) {
  switch (question.type) {
    case 'SINGLE_CHOICE':
    case 'FREE_TEXT':
      return typeof answer === 'string';
    case 'DATE':
      return dateOrNone.safeParse(answer).success;
    case 'MULTIPLE_CHOICE':
      return (
        typeof answer === 'string' ||
        answer.every((chosen) => question.options.includes(chosen))
      );
    case 'PLACEMENT':
      return (
        Array.isArray(answer) &&
        answer.every((ticked) => question.options.includes(ticked))
      );
  }
}

/** A round of questions with the learner's answer to each, in order. */
export const answeredRoundSchema = z
  .object({
    questions: z.array(interviewQuestionSchema).min(1).max(4),
    answers: z.array(answerSchema),
  })
  .refine((round) => round.answers.length === round.questions.length, {
    message: 'Every question needs an answer',
  })
  .refine(
    (round) =>
      round.questions.every((question, index) =>
        fitsQuestion(question, round.answers[index]),
      ),
    { message: "An answer doesn't fit its question" },
  );

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
- Every question comes with a suggested answer: the one most likely for this learner, given what they've said. For a SINGLE_CHOICE question, give two to six short options, and the suggested answer must be one of them. Use MULTIPLE_CHOICE when more than one answer can be true, with two to eight options and the suggested answers among them. The page adds "Something else…" to every choice question, for an answer of the learner's own, so never add an "Other" option. Use FREE_TEXT when no short list of options fits, with a suggested answer the learner can accept or edit. Ask for a date, such as a deadline, with a DATE question, suggesting a date as YYYY-MM-DD or a blank suggestion for none; the learner leaves it blank when there isn't one.
- Where the topic has skills a learner may or may not have, such as a language, an instrument or a programming language, ask a PLACEMENT question once: "Which of these can you already do?", with five to eight concrete things a learner might already be able to do, from easiest to hardest, and no suggested answer, since the learner is never assumed to know something. Put what they tick in the draft's canAlreadyDo. Don't ask it where the topic has no such ladder, such as a history course.
- Ask about what changes the course most first: the goal, time per week, session length and any deadline, then prior knowledge, focus, skip and materials.
- When the learner's words leave open a choice the whole course depends on, such as which variety of a language, which exam board or which version of a framework, ask it, suggesting the most common option, and record the answer in the draft's notes, so every lesson follows it.
- Don't ask about review days, how a study day is structured, or kinds of practice: the app schedules reviews and writes each lesson's exercises.
- Stop once nothing important is left to assume: set ready to true and give no questions. A short interview is a good one.

Every time, give the draft: the Course Setup as everything said so far settles it, your suggested answers included where the learner accepted them. Leave a field blank, empty or null where nothing settles it yet; don't invent a deadline, materials or prior knowledge.`;

const WEEKDAY = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  timeZone: 'UTC',
});

/** A question's answer as the model reads it back. */
function describeAnswer(
  question: InterviewQuestion,
  answer: InterviewAnswer,
): string {
  if (Array.isArray(answer)) {
    const label = question.type === 'PLACEMENT' ? 'Ticked' : 'Chosen';
    return `  ${label}: <answer>${answer.join('; ') || 'none'}</answer>`;
  }
  const ownWords =
    (question.type === 'SINGLE_CHOICE' && !question.options.includes(answer)) ||
    question.type === 'MULTIPLE_CHOICE';
  if (ownWords) {
    return `  Answer, in their own words rather than an option: <answer>${answer}</answer>`;
  }
  return `  Answer: <answer>${answer || (question.type === 'DATE' ? 'No date' : '(left blank)')}</answer>`;
}

/** A round as the model reads it back: each question with its answer. */
function describeRound({ questions, answers }: AnsweredRound): string[] {
  return questions.flatMap((question, index) => [
    `- Question: ${question.prompt}`,
    ...('options' in question
      ? [`  Options: ${question.options.join(' / ')}`]
      : []),
    describeAnswer(question, answers[index]),
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
 * The model's round as the page shows it: suggested answers the options
 * leave out are offered first, so they can start selected.
 */
export function withSuggestionOffered(
  question: InterviewQuestion,
): InterviewQuestion {
  switch (question.type) {
    case 'SINGLE_CHOICE':
      return question.options.includes(question.suggested)
        ? question
        : { ...question, options: [question.suggested, ...question.options] };
    case 'MULTIPLE_CHOICE': {
      const missing = question.suggested.filter(
        (suggested) => !question.options.includes(suggested),
      );
      return { ...question, options: [...missing, ...question.options] };
    }
    default:
      return question;
  }
}

/**
 * What the learner can already do as the draft gives it, as their placement
 * checklists settle it: every item they ticked, which the model may have
 * left out, and none they left unticked, so they're never assumed to know
 * something they didn't claim.
 */
function withPlacement(
  canAlreadyDo: string[],
  rounds: AnsweredRound[],
): string[] {
  const ticked = new Set<string>();
  const unticked = new Set<string>();
  for (const { questions, answers } of rounds) {
    questions.forEach((question, index) => {
      if (question.type !== 'PLACEMENT') return;
      const answer = answers[index];
      for (const item of question.options) {
        (answer.includes(item) ? ticked : unticked).add(item);
      }
    });
  }
  return [
    ...new Set([
      ...canAlreadyDo.filter((item) => !unticked.has(item) || ticked.has(item)),
      ...ticked,
    ]),
  ];
}

/**
 * The draft as the course form takes it: what the model gave as blank or
 * zero for not known read as not given, the session length snapped to one
 * the form offers, and every placement item ticked so far in can already
 * do.
 */
export function formDraft(draft: DraftSetup, rounds: AnsweredRound[]) {
  return {
    ...draft,
    minutesPerWeek: draft.minutesPerWeek || null,
    sessionMinutes: draft.sessionMinutes
      ? nearestSessionLength(draft.sessionMinutes)
      : null,
    deadline: draft.deadline || null,
    canAlreadyDo: withPlacement(draft.canAlreadyDo.filter(Boolean), rounds),
  };
}

/** The session length the form offers nearest to the minutes given. */
function nearestSessionLength(minutes: number): number {
  return SESSION_LENGTHS.reduce((nearest, length) =>
    Math.abs(length - minutes) < Math.abs(nearest - minutes) ? length : nearest,
  );
}
