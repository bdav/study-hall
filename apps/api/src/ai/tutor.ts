import { type AiChatRequest } from './provider.js';
import { type LessonOutput } from './lesson.js';
import { type CourseSetup, formatCourseSetup } from './syllabus.js';

/** Sonnet-class model for the tutor (courses-plan.md, AI platform). */
export const TUTOR_MODEL = 'claude-sonnet-5-5';

/** Bump whenever the prompt changes meaningfully. */
export const TUTOR_PROMPT_VERSION = 'tutor-v1';

/** Room for a reply and the model's thinking before it. */
const TUTOR_MAX_TOKENS = 8000;

/** One message in a Tutor Thread. */
export type TutorTurn = { role: 'LEARNER' | 'TUTOR'; content: string };

type LessonOutline = { title: string; objectives: string[] };

export type TutorContext = {
  setup: CourseSetup;
  outline: (LessonOutline & { current: boolean })[];
  lesson: LessonOutline & Pick<LessonOutput, 'content' | 'examples'>;
  history: TutorTurn[];
};

/**
 * What the tutor knows (courses-plan.md, Tutor): the course setup, the
 * active syllabus as an outline, the current Lesson Version's content and
 * examples, and the thread so far. Other lessons appear only in the
 * outline, so nothing from them reaches the tutor.
 */
export function assembleTutorContext({
  setup,
  lessons,
  lessonId,
  version,
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
    history,
  };
}

/** Adapted from Claude Study Agent's tutor rules (courses-plan.md, Tutor). */
export const TUTOR_SYSTEM_PROMPT = `You are a tutor beside a lesson that a self-directed learner is working through. The course and the lesson follow. Help the learner understand and remember this lesson's material.

Behave like a good tutor, not an answer machine:
- Ask before telling. When the learner asks about something they could work out, first ask what they think, or a question that leads them there.
- Give hints that become more explicit only as the learner needs them: a nudge first, then a pointer to the relevant part of the lesson, then a worked step. Give the full answer only once they have tried, or when they ask for a fact they couldn't work out, such as a word they haven't met.
- Push back on vague or partly right answers. Say what is right, then ask them to be precise about what isn't, rather than accepting it.
- Check understanding with a short follow-up question once something is explained, such as asking them to apply it to a new case.
- When the learner is practising the lesson's exercises, help them reach the answer themselves rather than giving it.

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
  ].join('\n');
}

/**
 * The request for the tutor's reply to a new message. The rules and the
 * lesson come first and are cached, since every message in the thread
 * repeats them.
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
      { role: 'user', content: message },
    ],
    maxTokens: TUTOR_MAX_TOKENS,
  };
}
