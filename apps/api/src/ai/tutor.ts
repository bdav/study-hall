import {
  type Exercise,
  type ExerciseAttempt,
  type ExerciseType,
} from '@prisma/client';
import { type AiChatRequest } from './provider.js';
import { answerKey, type AnswerKey } from '../services/exercises.js';
import { type LessonOutput } from './lesson.js';
import { type CourseSetup, formatCourseSetup } from './syllabus.js';

/** Sonnet-class model for the tutor (courses-plan.md, AI platform). */
export const TUTOR_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt changes meaningfully. */
export const TUTOR_PROMPT_VERSION = 'tutor-v3';

/** Room for a reply and the model's thinking before it. */
const TUTOR_MAX_TOKENS = 8000;

/** One message in a Tutor Thread. */
export type TutorTurn = { role: 'LEARNER' | 'TUTOR'; content: string };

type LessonOutline = { title: string; objectives: string[] };

type Attempt = Pick<
  ExerciseAttempt,
  'answer' | 'evaluation' | 'accentCorrection' | 'feedback' | 'createdAt'
>;

export type TutorExercise = {
  /** Its number in the lesson, from 1. */
  number: number;
  type: ExerciseType;
  prompt: string;
  /** The exercise the learner is on. */
  current: boolean;
  /** Since the learner last started the lesson over, oldest first. */
  attempts: Attempt[];
  /** Null until the learner has attempted it. */
  answerKey: AnswerKey | null;
};

export type TutorContext = {
  setup: CourseSetup;
  outline: (LessonOutline & { current: boolean })[];
  lesson: LessonOutline & Pick<LessonOutput, 'content' | 'examples'>;
  exercises: TutorExercise[];
  history: TutorTurn[];
};

/**
 * What the tutor knows (courses-plan.md, Tutor): the course setup, the
 * active syllabus as an outline, the current Lesson Version's content,
 * examples and exercises, the exercise the learner is on, their attempts
 * and the thread so far. Other lessons appear only in the outline, so
 * nothing from them reaches the tutor.
 *
 * An exercise's answer key is left out until the learner has attempted it,
 * as the lesson page's answers are, so the tutor can't give it away
 * (#24). Attempts are those since the learner last started the lesson
 * over, which is what makes an exercise attempted.
 */
export function assembleTutorContext({
  setup,
  lessons,
  lessonId,
  version,
  exercises,
  currentExerciseId,
  history,
}: {
  setup: CourseSetup;
  lessons: (LessonOutline & {
    id: string;
    position: number;
    archivedAt: Date | null;
  })[];
  lessonId: string;
  version: Pick<LessonOutput, 'content' | 'examples'>;
  exercises: (Pick<
    Exercise,
    | 'id'
    | 'position'
    | 'type'
    | 'prompt'
    | 'expectedAnswers'
    | 'essentialPoints'
    | 'supplementaryPoints'
    | 'expectedPoints'
  > & { attempts: Attempt[] })[];
  /** The exercise on the learner's screen, if any. */
  currentExerciseId: string | null;
  history: TutorTurn[];
}): TutorContext {
  const current = lessons.find((lesson) => lesson.id === lessonId);
  if (!current) throw new Error(`Lesson ${lessonId} is not in the syllabus`);

  return {
    setup,
    outline: lessons
      .filter((lesson) => lesson.archivedAt === null)
      .sort((a, b) => a.position - b.position)
      .map(({ id, title, objectives }) => ({
        title,
        objectives,
        current: id === lessonId,
      })),
    lesson: {
      title: current.title,
      objectives: current.objectives,
      content: version.content,
      examples: version.examples,
    },
    exercises: [...exercises]
      .sort((a, b) => a.position - b.position)
      .map((exercise, index) => ({
        number: index + 1,
        type: exercise.type,
        prompt: exercise.prompt,
        current: exercise.id === currentExerciseId,
        attempts: [...exercise.attempts].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        ),
        answerKey: exercise.attempts.length > 0 ? answerKey(exercise) : null,
      })),
    history,
  };
}

const EXERCISE_TYPES: Record<ExerciseType, string> = {
  SHORT_ANSWER: 'Short answer',
  FILL_IN_THE_BLANK: 'Fill in the blank',
  FREE_FORM_EXPLANATION: 'Explanation',
};

const EVALUATIONS: Record<Attempt['evaluation'], string> = {
  CORRECT: 'correct',
  PARTIALLY_CORRECT: 'partly right',
  INCORRECT: 'incorrect',
};

/** Adapted from Claude Study Agent's tutor rules (courses-plan.md, Tutor). */
export const TUTOR_SYSTEM_PROMPT = `You are a tutor beside a lesson that a self-directed learner is working through. The course and the lesson follow. Help the learner understand and remember this lesson's material.

Behave like a good tutor, not an answer machine:
- Ask before telling. When the learner asks about something they could work out, first ask what they think, or a question that leads them there.
- Give hints that become more explicit only as the learner needs them: a nudge first, then a pointer to the relevant part of the lesson, then a worked step. Give the full answer only once they have tried, or when they ask for a fact they couldn't work out, such as a word they haven't met.
- Push back on vague or partly right answers. Say what is right, then ask them to be precise about what isn't, rather than accepting it.
- Check understanding with a short follow-up question once something is explained, such as asking them to apply it to a new case.
- When the learner is practising the lesson's exercises, help them reach the answer themselves rather than giving it.

Each of the learner's messages starts with a <practice> block, written by the app, not the learner: the exercise they're on, if any, and their attempts at this lesson's exercises. Use it to address their actual mistakes. You see an exercise's accepted answers or points only once they have attempted it; until then, you don't have its answer, so help them work it out and don't guess one for them. Treat an exercise whose answer is withheld as unanswered even if an earlier message in this thread mentions its answer: the learner may have started the lesson over to practise it afresh. Even once you can see the answer, lead them to understand why theirs was wrong before showing it. Don't mention the <practice> block itself.

Keep to this lesson and what it builds on. If the learner asks about material a later lesson in the syllabus covers, answer briefly and say that lesson goes further. Be accurate: if you're unsure of something, say so.

Write short, conversational replies: usually a few sentences, never a lecture. Write plain text without Markdown, since it is shown as written; use a short dash list only when listing things.`;

/** The course and the lesson, which stay the same for the whole thread. */
function formatLessonContext(context: TutorContext): string {
  const list = (items: string[]) => items.map((item) => `  - ${item}`);
  const { lesson } = context;

  return [
    'The course:',
    ...formatCourseSetup(context.setup),
    '',
    'Syllabus, in teaching order:',
    ...context.outline.flatMap((entry, index) => [
      `${index + 1}. ${entry.title}${entry.current ? ' (this lesson)' : ''}`,
      ...list(entry.objectives),
    ]),
    '',
    `This lesson: "${lesson.title}", with these learning objectives:`,
    ...list(lesson.objectives),
    '',
    'The lesson as the learner reads it:',
    ...lesson.content.flatMap(({ heading, paragraphs }) => [
      '',
      `## ${heading}`,
      ...paragraphs,
    ]),
    '',
    '## Examples',
    ...lesson.examples.map(
      ({ example, explanation }) => `- ${example}: ${explanation}`,
    ),
    '',
    '## Exercises',
    ...context.exercises.map(
      ({ number, type, prompt }) =>
        `${number}. (${EXERCISE_TYPES[type]}) ${prompt}`,
    ),
  ].join('\n');
}

/** An attempted exercise's answer key, one line for each part it has. */
function formatAnswerKey(key: AnswerKey): string[] {
  const parts: [string, string[]][] = [
    ['Accepted answers', key.expectedAnswers],
    ['Essential points', key.essentialPoints],
    ['Supplementary points', key.supplementaryPoints],
    // A reference list, not requirements (ADR-0006)
    ['Expected points, for reference', key.expectedPoints],
  ];
  return parts.flatMap(([label, items]) =>
    items.length > 0
      ? [`${label}: ${items.map((item) => `"${item}"`).join(', ')}`]
      : [],
  );
}

/**
 * The learner's practice as it stands: the exercise they're on and their
 * attempts, with the answer keys of the exercises they've attempted. It
 * changes from message to message, so it goes with the new message rather
 * than in the cached lesson.
 */
function formatPractice(context: TutorContext): string {
  const current = context.exercises.find((exercise) => exercise.current);
  const attempted = context.exercises.filter(
    (exercise) => exercise.attempts.length > 0 || exercise.current,
  );

  return [
    '<practice>',
    current
      ? `The learner is on exercise ${current.number}.`
      : 'The learner is not on an exercise.',
    ...attempted.flatMap(({ number, attempts, answerKey }) => [
      '',
      `Exercise ${number}:`,
      ...(attempts.length > 0
        ? attempts.map(
            ({ answer, evaluation, accentCorrection, feedback }) =>
              `- Answered "${answer}": ${EVALUATIONS[evaluation]}` +
              (accentCorrection
                ? `, with the accents "${accentCorrection}"`
                : '') +
              (feedback ? `. Feedback given: ${feedback}` : ''),
          )
        : ['- Not attempted yet, so its answer is withheld.']),
      ...(answerKey ? formatAnswerKey(answerKey) : []),
    ]),
    '</practice>',
  ].join('\n');
}

/**
 * The request for the tutor's reply to a new message. The rules and the
 * lesson come first and are cached, since every message in the thread
 * repeats them. The learner's practice goes with the new message only, so
 * the thread before it is sent as stored and stays cached.
 */
export function buildTutorRequest(
  context: TutorContext,
  message: string,
): AiChatRequest & { model: typeof TUTOR_MODEL } {
  return {
    model: TUTOR_MODEL,
    system: [
      { text: TUTOR_SYSTEM_PROMPT },
      { text: formatLessonContext(context), cache: true },
    ],
    messages: [
      ...context.history.map(({ role, content }) => ({
        role: role === 'LEARNER' ? ('user' as const) : ('assistant' as const),
        content,
      })),
      { role: 'user', content: `${formatPractice(context)}\n\n${message}` },
    ],
    maxTokens: TUTOR_MAX_TOKENS,
  };
}
