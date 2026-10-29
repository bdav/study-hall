import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import { type PrismaClient } from '@prisma/client';
import { createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

let userId: string;
let otherUserId: string;

const ai = createFakeAiProvider();

const courseForm = {
  topic: 'Italian',
  goal: 'A2 by summer',
  priorKnowledge: 'Some Duolingo',
  timePerWeek: '3 hours',
  depth: 'Practical',
  notes: 'I travel to Rome in June',
};

const syllabus = {
  lessons: [
    { title: 'Greetings', objectives: ['Greet someone formally'] },
    { title: 'At the café', objectives: ['Order food and drinks'] },
    { title: 'Numbers', objectives: ['Count to one hundred'] },
  ],
};

/** A generated lesson, as the model returns it. */
function lessonOutput(summary = 'Taught ciao and buongiorno.') {
  return {
    content: [
      {
        heading: 'Saying hello',
        paragraphs: ['Italian has a formal and an informal hello.'],
      },
    ],
    examples: [{ example: 'Ciao, Marco!', explanation: 'An informal hello.' }],
    exercises: [
      {
        type: 'SHORT_ANSWER',
        prompt: 'Translate: Good morning',
        expectedAnswers: ['Buongiorno'],
        open: false,
      },
      {
        type: 'SHORT_ANSWER',
        prompt: 'Translate: Good morning, how are you?',
        expectedAnswers: ['Buongiorno, come stai?'],
        open: true,
      },
      {
        type: 'FILL_IN_THE_BLANK',
        prompt: '___, Marco!',
        expectedAnswers: ['Ciao'],
      },
      {
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        essentialPoints: ['It greets someone in the evening'],
        supplementaryPoints: ['Buonanotte is for parting at night'],
      },
    ],
    summary,
  };
}

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'lesson-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-lesson@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  await prisma.course.deleteMany({});
  await prisma.deck.deleteMany({});
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.stubEnv(
    'AI_ALLOWED_EMAILS',
    'lesson-test@example.com, other-lesson@example.com',
  );
  vi.stubEnv('AI_MONTHLY_CAP_USD', '100');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

function createCaller(overrideUserId?: string) {
  return appRouter.createCaller({
    prisma,
    userId: overrideUserId ?? userId,
    sessionToken: null,
    ai,
  });
}

/**
 * Creates a course with an accepted syllabus through the router, and
 * returns its lessons in syllabus order.
 */
async function createCourseWithLessons() {
  const caller = createCaller();
  ai.respondWith(syllabus);
  const { id } = await caller.course.create(courseForm);
  await caller.course.acceptProposal({ courseId: id });
  const course = await caller.course.getById({ id });
  ai.reset();
  return course.lessons;
}

describe('lessonRouter', () => {
  describe('generate', () => {
    it('generates a Lesson Version that opening the lesson then shows', async () => {
      const [lesson] = await createCourseWithLessons();
      const caller = createCaller();

      ai.respondWith(lessonOutput());
      await caller.lesson.generate({ id: lesson.id });
      const opened = await caller.lesson.getById({ id: lesson.id });

      expect(opened).toMatchObject({
        id: lesson.id,
        title: 'Greetings',
        objectives: ['Greet someone formally'],
      });
      expect(opened.version).toMatchObject({
        content: lessonOutput().content,
        examples: lessonOutput().examples,
        exercises: [
          { type: 'SHORT_ANSWER', prompt: 'Translate: Good morning' },
          {
            type: 'SHORT_ANSWER',
            prompt: 'Translate: Good morning, how are you?',
          },
          { type: 'FILL_IN_THE_BLANK', prompt: '___, Marco!' },
          {
            type: 'FREE_FORM_EXPLANATION',
            prompt: 'When would you say buonasera?',
          },
        ],
      });
    });

    it('stores expected answers, essential and supplementary points, whether each exercise is open, and the model and prompt version', async () => {
      const [lesson] = await createCourseWithLessons();

      ai.respondWith(lessonOutput());
      await createCaller().lesson.generate({ id: lesson.id });

      // Exposed only through checking answers and revealing them
      const version = await prisma.lessonVersion.findFirstOrThrow({
        where: { lessonId: lesson.id },
        include: { exercises: { orderBy: { position: 'asc' } } },
      });
      expect(version).toMatchObject({
        model: 'claude-sonnet-5-5',
        promptVersion: 'lesson-v4',
      });
      expect(
        version.exercises.map(
          ({
            expectedAnswers,
            essentialPoints,
            supplementaryPoints,
            expectedPoints,
            open,
          }) => ({
            expectedAnswers,
            essentialPoints,
            supplementaryPoints,
            expectedPoints,
            open,
          }),
        ),
      ).toEqual([
        {
          expectedAnswers: ['Buongiorno'],
          essentialPoints: [],
          supplementaryPoints: [],
          expectedPoints: [],
          open: false,
        },
        {
          expectedAnswers: ['Buongiorno, come stai?'],
          essentialPoints: [],
          supplementaryPoints: [],
          expectedPoints: [],
          open: true,
        },
        {
          expectedAnswers: ['Ciao'],
          essentialPoints: [],
          supplementaryPoints: [],
          expectedPoints: [],
          open: false,
        },
        {
          expectedAnswers: [],
          essentialPoints: ['It greets someone in the evening'],
          supplementaryPoints: ['Buonanotte is for parting at night'],
          // Only explanations generated before the split have these
          expectedPoints: [],
          open: true,
        },
      ]);
    });

    it('records when the lesson was first opened, and keeps that time', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const [lesson] = await createCourseWithLessons();
        const caller = createCaller();

        vi.setSystemTime(new Date('2026-10-20T09:00:00Z'));
        ai.respondWith(lessonOutput());
        await caller.lesson.generate({ id: lesson.id });
        vi.setSystemTime(new Date('2026-10-22T09:00:00Z'));
        await caller.lesson.generate({ id: lesson.id });

        const opened = await caller.lesson.getById({ id: lesson.id });
        expect(opened.firstOpenedAt).toEqual(new Date('2026-10-20T09:00:00Z'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('records the AI usage of the generation', async () => {
      const [lesson] = await createCourseWithLessons();

      ai.respondWith(lessonOutput(), { inputTokens: 2400, outputTokens: 3100 });
      await createCaller().lesson.generate({ id: lesson.id });

      expect(
        await prisma.aiUsage.findMany({
          where: { purpose: 'LESSON_GENERATION' },
        }),
      ).toEqual([
        expect.objectContaining({
          userId,
          purpose: 'LESSON_GENERATION',
          model: 'claude-sonnet-5-5',
          inputTokens: 2400,
          outputTokens: 3100,
        }),
      ]);
    });

    it('stores nothing when the output is invalid, and the learner can retry', async () => {
      const [lesson] = await createCourseWithLessons();
      const caller = createCaller();

      ai.respondWith({ ...lessonOutput(), exercises: [] });
      await expect(caller.lesson.generate({ id: lesson.id })).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_GATEWAY' }),
      );

      const opened = await caller.lesson.getById({ id: lesson.id });
      expect(opened.version).toBeNull();
      expect(opened.firstOpenedAt).toBeNull();

      ai.respondWith(lessonOutput());
      await caller.lesson.generate({ id: lesson.id });
      expect(
        (await caller.lesson.getById({ id: lesson.id })).version,
      ).not.toBeNull();
    });

    it('generates once when the lesson is opened twice at the same time', async () => {
      const [lesson] = await createCourseWithLessons();
      const caller = createCaller();
      ai.respondWith(lessonOutput('First.'));
      ai.respondWith(lessonOutput('Second.'));

      const results = await Promise.allSettled([
        caller.lesson.generate({ id: lesson.id }),
        caller.lesson.generate({ id: lesson.id }),
      ]);

      expect(ai.requests).toHaveLength(1);
      expect(
        await prisma.lessonVersion.count({ where: { lessonId: lesson.id } }),
      ).toBe(1);
      // The losing call either finds the finished version or is told to wait
      for (const result of results) {
        if (result.status === 'fulfilled') {
          expect(result.value.version).not.toBeNull();
        } else {
          expect(result.reason).toMatchObject({ code: 'CONFLICT' });
        }
      }
    });

    it('asks the learner to wait while another open is writing the lesson', async () => {
      const [lesson] = await createCourseWithLessons();
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { generationClaimedAt: new Date() },
      });

      await expect(
        createCaller().lesson.generate({ id: lesson.id }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'CONFLICT',
          message: expect.stringMatching(/already being written/),
        }),
      );
      expect(ai.requests).toHaveLength(0);
    });

    it('takes over a claim left by a request that died', async () => {
      const [lesson] = await createCourseWithLessons();
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { generationClaimedAt: new Date(Date.now() - 16 * 60 * 1000) },
      });

      ai.respondWith(lessonOutput());
      const opened = await createCaller().lesson.generate({ id: lesson.id });

      expect(opened.version).not.toBeNull();
    });

    it('releases its claim when generation fails, so a retry can start at once', async () => {
      const [lesson] = await createCourseWithLessons();
      const caller = createCaller();
      ai.failWith('api-error');
      await expect(caller.lesson.generate({ id: lesson.id })).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_GATEWAY' }),
      );

      ai.respondWith(lessonOutput());
      const opened = await caller.lesson.generate({ id: lesson.id });

      expect(opened.version).not.toBeNull();
    });

    it("doesn't generate an archived lesson", async () => {
      const [lesson] = await createCourseWithLessons();
      // Archiving has no procedure yet (#17)
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { archivedAt: new Date() },
      });

      await expect(
        createCaller().lesson.generate({ id: lesson.id }),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      );
      expect(ai.requests).toHaveLength(0);
    });

    it("doesn't write a lesson of an archived course", async () => {
      const [greetings] = await createCourseWithLessons();
      await prisma.course.updateMany({ data: { archivedAt: new Date() } });

      await expect(
        createCaller().lesson.generate({ id: greetings.id }),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      );
      expect(ai.requests).toHaveLength(0);
    });

    it('refuses a learner without AI access, without calling the model', async () => {
      const [lesson] = await createCourseWithLessons();
      vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');

      await expect(
        createCaller().lesson.generate({ id: lesson.id }),
      ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
      expect(ai.requests).toHaveLength(0);
    });

    it('is paused once the monthly AI spending cap is reached', async () => {
      const [lesson] = await createCourseWithLessons();
      vi.stubEnv('AI_MONTHLY_CAP_USD', '0.0001');

      await expect(
        createCaller().lesson.generate({ id: lesson.id }),
      ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }));
      expect(ai.requests).toHaveLength(0);
    });
  });

  describe('generation context', () => {
    /** Generates a lesson, answering with the given summary. */
    async function generate(lessonId: string, summary: string) {
      ai.respondWith(lessonOutput(summary));
      await createCaller().lesson.generate({ id: lessonId });
      return ai.requests.at(-1)!.prompt;
    }

    it('sends the setup answers, the syllabus outline and the lesson objectives', async () => {
      const [, cafe] = await createCourseWithLessons();

      const prompt = await generate(cafe.id, 'Taught ordering.');

      for (const answer of Object.values(courseForm)) {
        expect(prompt).toContain(answer);
      }
      for (const { title, objectives } of syllabus.lessons) {
        expect(prompt).toContain(title);
        expect(prompt).toContain(objectives[0]);
      }
      expect(prompt).toMatch(/Write the lesson "At the café"/);
    });

    it('asks the model to choose the objectives of a lesson the learner added without any', async () => {
      const [, cafe] = await createCourseWithLessons();
      await prisma.lesson.update({
        where: { id: cafe.id },
        data: { objectives: [] },
      });

      const prompt = await generate(cafe.id, 'Taught ordering.');

      expect(prompt).toMatch(
        /Write the lesson "At the café"\. It has no learning objectives yet: choose two to five/,
      );
    });

    it('sends summaries of earlier generated lessons in syllabus order, never later ones', async () => {
      const [greetings, cafe, numbers] = await createCourseWithLessons();

      await generate(numbers.id, 'Taught numbers.');
      await generate(greetings.id, 'Taught greetings.');
      const cafePrompt = await generate(cafe.id, 'Taught ordering.');

      expect(cafePrompt).toContain('Taught greetings.');
      expect(cafePrompt).not.toContain('Taught numbers.');
    });

    it('lists earlier summaries in syllabus order, not generation order', async () => {
      const [greetings, cafe, numbers] = await createCourseWithLessons();

      await generate(cafe.id, 'Taught ordering.');
      await generate(greetings.id, 'Taught greetings.');
      const prompt = await generate(numbers.id, 'Taught numbers.');

      expect(prompt.indexOf('Taught greetings.')).toBeLessThan(
        prompt.indexOf('Taught ordering.'),
      );
    });

    it('leaves archived lessons out of the outline and the summaries', async () => {
      const [greetings, cafe, numbers] = await createCourseWithLessons();
      await generate(greetings.id, 'Taught greetings.');
      await generate(cafe.id, 'Taught ordering.');
      // Archiving has no procedure yet (#17)
      await prisma.lesson.update({
        where: { id: greetings.id },
        data: { archivedAt: new Date() },
      });

      const prompt = await generate(numbers.id, 'Taught numbers.');

      expect(prompt).not.toContain('Greetings');
      expect(prompt).not.toContain('Taught greetings.');
      expect(prompt).toContain('Taught ordering.');
    });
  });

  describe('getById', () => {
    it('says when the lesson is being written by another open', async () => {
      const [lesson] = await createCourseWithLessons();
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { generationClaimedAt: new Date() },
      });

      const opened = await createCaller().lesson.getById({ id: lesson.id });

      expect(opened).toMatchObject({ version: null, generating: true });
    });

    it('stops saying so once a claim has gone stale', async () => {
      const [lesson] = await createCourseWithLessons();
      await prisma.lesson.update({
        where: { id: lesson.id },
        data: { generationClaimedAt: new Date(Date.now() - 16 * 60 * 1000) },
      });

      const opened = await createCaller().lesson.getById({ id: lesson.id });

      expect(opened.generating).toBe(false);
    });

    it('is not generating once the lesson has a version', async () => {
      const [lesson] = await createCourseWithLessons();
      ai.respondWith(lessonOutput());
      await createCaller().lesson.generate({ id: lesson.id });

      const opened = await createCaller().lesson.getById({ id: lesson.id });

      expect(opened.generating).toBe(false);
    });

    it('shows a lesson that has not been generated yet, without calling the model', async () => {
      const [lesson] = await createCourseWithLessons();

      const opened = await createCaller().lesson.getById({ id: lesson.id });

      expect(opened).toMatchObject({
        title: 'Greetings',
        version: null,
        generating: false,
        firstOpenedAt: null,
      });
      expect(ai.requests).toHaveLength(0);
    });

    it('shows the same version on reopening, with no model call and without AI access', async () => {
      const [lesson] = await createCourseWithLessons();
      const caller = createCaller();
      ai.respondWith(lessonOutput());
      const first = await caller.lesson.generate({ id: lesson.id });
      ai.reset();
      vi.stubEnv('AI_ALLOWED_EMAILS', '');

      const reopened = await caller.lesson.getById({ id: lesson.id });

      // Open Exercises are hidden without AI access, which is tested below
      expect(reopened.version).toMatchObject({
        id: first.version?.id,
        content: first.version?.content,
        examples: first.version?.examples,
      });
      expect(ai.requests).toHaveLength(0);
    });

    it('never regenerates a lesson that already has a version', async () => {
      const [lesson] = await createCourseWithLessons();
      const caller = createCaller();
      ai.respondWith(lessonOutput());
      const first = await caller.lesson.generate({ id: lesson.id });

      const again = await caller.lesson.generate({ id: lesson.id });

      expect(again.version?.id).toBe(first.version?.id);
      expect(ai.requests).toHaveLength(1);
    });

    it('hides Open Exercises from a learner without AI access, and says how many', async () => {
      const [lesson] = await createCourseWithLessons();
      ai.respondWith(lessonOutput());
      await createCaller().lesson.generate({ id: lesson.id });
      vi.stubEnv('AI_ALLOWED_EMAILS', '');

      const opened = await createCaller().lesson.getById({ id: lesson.id });

      expect(opened.version?.exercises).toEqual([
        expect.objectContaining({ prompt: 'Translate: Good morning' }),
        expect.objectContaining({ prompt: '___, Marco!' }),
      ]);
      expect(opened.version?.hiddenExerciseCount).toBe(2);
    });

    it('shows every exercise to a learner with AI access', async () => {
      const [lesson] = await createCourseWithLessons();
      ai.respondWith(lessonOutput());
      await createCaller().lesson.generate({ id: lesson.id });

      const opened = await createCaller().lesson.getById({ id: lesson.id });

      expect(opened.version?.exercises).toHaveLength(4);
      expect(opened.version?.hiddenExerciseCount).toBe(0);
    });

    it('does not show exercise answers or the Lesson Summary to the learner', async () => {
      const [lesson] = await createCourseWithLessons();
      ai.respondWith(lessonOutput());

      const opened = await createCaller().lesson.generate({ id: lesson.id });

      expect(JSON.stringify(opened)).not.toMatch(
        /Buongiorno|It greets someone|Buonanotte|Taught ciao/,
      );
    });
  });

  describe('ownership', () => {
    it("lets only the course's owner open or generate its lessons", async () => {
      const [lesson] = await createCourseWithLessons();
      const other = createCaller(otherUserId);

      await expect(other.lesson.getById({ id: lesson.id })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
      ai.respondWith(lessonOutput());
      await expect(other.lesson.generate({ id: lesson.id })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
      expect(ai.requests).toHaveLength(0);
    });
  });
});

describe('Lesson Completion', () => {
  /** The course's syllabus as the course page gets it. */
  async function syllabusOf(lessonId: string, caller = createCaller()) {
    const lesson = await prisma.lesson.findUniqueOrThrow({
      where: { id: lessonId },
    });
    return caller.course.getById({ id: lesson.courseId });
  }

  it('shows each lesson in the Syllabus as not started, opened or complete', async () => {
    const [greetings, cafe, numbers] = await createCourseWithLessons();
    const caller = createCaller();
    ai.respondWith(lessonOutput());
    await caller.lesson.generate({ id: greetings.id });
    await caller.lesson.setCompleted({ id: numbers.id, completed: true });

    const course = await syllabusOf(cafe.id);

    expect(
      course.lessons.map(({ title, status }) => ({ title, status })),
    ).toEqual([
      { title: 'Greetings', status: 'OPENED' },
      { title: 'At the café', status: 'NOT_STARTED' },
      { title: 'Numbers', status: 'COMPLETE' },
    ]);
  });

  it('continues at the first incomplete lesson in syllabus order, whatever order lessons were completed in', async () => {
    const [greetings, cafe, numbers] = await createCourseWithLessons();
    const caller = createCaller();

    await caller.lesson.setCompleted({ id: greetings.id, completed: true });
    await caller.lesson.setCompleted({ id: numbers.id, completed: true });
    expect((await syllabusOf(greetings.id)).continueLesson).toEqual({
      id: cafe.id,
      title: 'At the café',
    });

    await caller.lesson.setCompleted({ id: greetings.id, completed: false });
    expect((await syllabusOf(greetings.id)).continueLesson).toEqual({
      id: greetings.id,
      title: 'Greetings',
    });
  });

  it('continues at the first lesson of a course nothing has been done in', async () => {
    const [greetings] = await createCourseWithLessons();

    expect((await syllabusOf(greetings.id)).continueLesson).toEqual({
      id: greetings.id,
      title: 'Greetings',
    });
  });

  it('skips archived lessons when continuing', async () => {
    const [greetings, cafe] = await createCourseWithLessons();
    await prisma.lesson.update({
      where: { id: greetings.id },
      data: { archivedAt: new Date() },
    });

    expect((await syllabusOf(cafe.id)).continueLesson).toEqual({
      id: cafe.id,
      title: 'At the café',
    });
  });

  it('has nowhere to continue once every lesson is complete', async () => {
    const lessons = await createCourseWithLessons();
    const caller = createCaller();
    for (const { id } of lessons) {
      await caller.lesson.setCompleted({ id, completed: true });
    }

    expect((await syllabusOf(lessons[0].id)).continueLesson).toBeNull();
  });

  it('undoes completion, back to opened or not started', async () => {
    const [greetings, cafe] = await createCourseWithLessons();
    const caller = createCaller();
    ai.respondWith(lessonOutput());
    await caller.lesson.generate({ id: greetings.id });
    for (const { id } of [greetings, cafe]) {
      await caller.lesson.setCompleted({ id, completed: true });
      await caller.lesson.setCompleted({ id, completed: false });
    }

    const course = await syllabusOf(greetings.id);

    expect(course.lessons.map(({ status }) => status)).toEqual([
      'OPENED',
      'NOT_STARTED',
      'NOT_STARTED',
    ]);
  });

  it('keeps when a lesson was completed if it is marked complete again', async () => {
    const [greetings] = await createCourseWithLessons();
    const caller = createCaller();

    const first = await caller.lesson.setCompleted({
      id: greetings.id,
      completed: true,
    });
    const again = await caller.lesson.setCompleted({
      id: greetings.id,
      completed: true,
    });

    expect(first.completedAt).toBeInstanceOf(Date);
    expect(again.completedAt).toEqual(first.completedAt);
  });

  it('needs no AI access', async () => {
    const [greetings] = await createCourseWithLessons();
    vi.stubEnv('AI_ALLOWED_EMAILS', '');

    await createCaller().lesson.setCompleted({
      id: greetings.id,
      completed: true,
    });

    const course = await syllabusOf(greetings.id);
    expect(course.lessons[0].status).toBe('COMPLETE');
  });

  it("can't be set on another learner's lesson", async () => {
    const [greetings] = await createCourseWithLessons();

    await expect(
      createCaller(otherUserId).lesson.setCompleted({
        id: greetings.id,
        completed: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await syllabusOf(greetings.id)).lessons[0].status).toBe(
      'NOT_STARTED',
    );
  });

  it('shows on the lesson whether it is complete', async () => {
    const [greetings] = await createCourseWithLessons();
    const caller = createCaller();

    expect(
      (await caller.lesson.getById({ id: greetings.id })).completedAt,
    ).toBeNull();
    const { completedAt } = await caller.lesson.setCompleted({
      id: greetings.id,
      completed: true,
    });
    expect(
      (await caller.lesson.getById({ id: greetings.id })).completedAt,
    ).toEqual(completedAt);
  });
});

describe('The next lesson', () => {
  /** Where the lesson's Continue goes, as opening the lesson gets it. */
  async function nextAfter(lessonId: string) {
    return (await createCaller().lesson.getById({ id: lessonId })).nextLesson;
  }

  it('is the first incomplete lesson in syllabus order other than this one', async () => {
    const [greetings, cafe] = await createCourseWithLessons();

    expect(await nextAfter(greetings.id)).toEqual({
      id: cafe.id,
      title: 'At the café',
    });
    // An earlier incomplete lesson comes first, even from a later one
    expect(await nextAfter(cafe.id)).toEqual({
      id: greetings.id,
      title: 'Greetings',
    });
  });

  it('skips complete lessons, whatever order they were completed in', async () => {
    const [greetings, cafe, numbers] = await createCourseWithLessons();
    const caller = createCaller();
    await caller.lesson.setCompleted({ id: cafe.id, completed: true });
    await caller.lesson.setCompleted({ id: greetings.id, completed: true });

    expect(await nextAfter(greetings.id)).toEqual({
      id: numbers.id,
      title: 'Numbers',
    });
  });

  it('follows the syllabus order, not the order lessons were created in', async () => {
    const [greetings, cafe, numbers] = await createCourseWithLessons();
    // Numbers moved to the front of the syllabus
    await prisma.lesson.update({
      where: { id: numbers.id },
      data: { position: -1 },
    });

    expect(await nextAfter(cafe.id)).toEqual({
      id: numbers.id,
      title: 'Numbers',
    });
    expect(await nextAfter(numbers.id)).toEqual({
      id: greetings.id,
      title: 'Greetings',
    });
  });

  it('skips archived lessons', async () => {
    const [greetings, cafe, numbers] = await createCourseWithLessons();
    await prisma.lesson.update({
      where: { id: cafe.id },
      data: { archivedAt: new Date() },
    });

    expect(await nextAfter(greetings.id)).toEqual({
      id: numbers.id,
      title: 'Numbers',
    });
  });

  it('is none once every other lesson is complete, whether or not this one is', async () => {
    const [greetings, cafe, numbers] = await createCourseWithLessons();
    const caller = createCaller();
    await caller.lesson.setCompleted({ id: cafe.id, completed: true });
    await caller.lesson.setCompleted({ id: numbers.id, completed: true });

    expect(await nextAfter(greetings.id)).toBeNull();
    await caller.lesson.setCompleted({ id: greetings.id, completed: true });
    expect(await nextAfter(greetings.id)).toBeNull();
  });

  it('comes with a lesson as it is written, too', async () => {
    const [greetings, cafe] = await createCourseWithLessons();

    ai.respondWith(lessonOutput());
    const written = await createCaller().lesson.generate({ id: greetings.id });

    expect(written.nextLesson).toEqual({ id: cafe.id, title: 'At the café' });
  });
});

describe('Missed exercises', () => {
  it('counts the exercises review cards will focus on: any got wrong on this version, even since put right or before starting over', async () => {
    const [lesson] = await createCourseWithLessons();
    const caller = createCaller();
    ai.respondWith(lessonOutput());
    const opened = await caller.lesson.generate({ id: lesson.id });
    const [goodMorning, , blank] = opened.version!.exercises;
    expect(opened.version!.missedExerciseCount).toBe(0);

    // Missed, then put right
    await caller.exercise.submitAttempt({
      exerciseId: goodMorning.id,
      answer: 'Buonasera',
    });
    await caller.exercise.submitAttempt({
      exerciseId: goodMorning.id,
      answer: 'Buongiorno',
    });
    await caller.exercise.submitAttempt({
      exerciseId: blank.id,
      answer: 'Addio',
    });
    await caller.lesson.startOver({ id: lesson.id });

    const reopened = await caller.lesson.getById({ id: lesson.id });
    expect(reopened.version!.missedExerciseCount).toBe(2);
  });
});

describe('Starting a lesson over', () => {
  /** Opens the first lesson and answers its first exercise. */
  async function openAndAnswer(answer: string) {
    const [lesson] = await createCourseWithLessons();
    const caller = createCaller();
    ai.respondWith(lessonOutput());
    const opened = await caller.lesson.generate({ id: lesson.id });
    const exercise = opened.version!.exercises[0];
    await caller.exercise.submitAttempt({ exerciseId: exercise.id, answer });
    return { lessonId: lesson.id, courseId: opened.course.id, exercise };
  }

  it('shows every exercise unattempted, then only attempts made since', async () => {
    const { lessonId, exercise } = await openAndAnswer('Buonasera');
    const caller = createCaller();
    const beforeReset = await caller.lesson.getById({ id: lessonId });
    expect(beforeReset.version!.exercises[0].latestAttempt).toMatchObject({
      answer: 'Buonasera',
      evaluation: 'INCORRECT',
    });

    await caller.lesson.startOver({ id: lessonId });
    const afterReset = await caller.lesson.getById({ id: lessonId });
    expect(
      afterReset.version!.exercises.map(({ latestAttempt }) => latestAttempt),
    ).toEqual([null, null, null, null]);

    await caller.exercise.submitAttempt({
      exerciseId: exercise.id,
      answer: 'Buongiorno',
    });
    const reopened = await caller.lesson.getById({ id: lessonId });
    expect(reopened.version!.exercises[0].latestAttempt).toMatchObject({
      answer: 'Buongiorno',
      evaluation: 'CORRECT',
    });
  });

  it('keeps earlier attempts, which card proposals still use', async () => {
    const { lessonId } = await openAndAnswer('Buonasera');
    const caller = createCaller();

    await caller.lesson.startOver({ id: lessonId });
    ai.respondWith({
      cards: [
        {
          type: 'TYPED_RECALL',
          front: 'Translate: Good morning',
          canonicalAnswer: 'Buongiorno',
        },
      ],
    });
    await caller.lesson.proposeReviewCards({ id: lessonId });

    expect(ai.requests.at(-1)!.prompt).toContain(
      'The learner answered (INCORRECT): Buonasera',
    );
  });

  it('needs an attempt since starting over to reveal answers again', async () => {
    const { lessonId, exercise } = await openAndAnswer('Buonasera');
    const caller = createCaller();
    await expect(
      caller.exercise.answers({ exerciseId: exercise.id }),
    ).resolves.toMatchObject({ expectedAnswers: ['Buongiorno'] });

    await caller.lesson.startOver({ id: lessonId });
    await expect(
      caller.exercise.answers({ exerciseId: exercise.id }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await caller.exercise.submitAttempt({
      exerciseId: exercise.id,
      answer: 'Buonasera',
    });
    await expect(
      caller.exercise.answers({ exerciseId: exercise.id }),
    ).resolves.toMatchObject({ expectedAnswers: ['Buongiorno'] });
  });

  it('clears Lesson Completion and keeps the first-opened time', async () => {
    const { lessonId, courseId } = await openAndAnswer('Buongiorno');
    const caller = createCaller();
    await caller.lesson.setCompleted({ id: lessonId, completed: true });
    const before = await caller.lesson.getById({ id: lessonId });

    await caller.lesson.startOver({ id: lessonId });

    const after = await caller.lesson.getById({ id: lessonId });
    expect(after.completedAt).toBeNull();
    expect(after.firstOpenedAt).toEqual(before.firstOpenedAt);
    const course = await caller.course.getById({ id: courseId });
    expect(course.lessons[0].status).toBe('OPENED');
  });

  it('needs no AI access', async () => {
    const { lessonId } = await openAndAnswer('Buonasera');
    vi.stubEnv('AI_ALLOWED_EMAILS', '');

    await createCaller().lesson.startOver({ id: lessonId });

    const lesson = await createCaller().lesson.getById({ id: lessonId });
    expect(lesson.version!.exercises[0].latestAttempt).toBeNull();
  });

  it("can't start another learner's lesson over", async () => {
    const { lessonId } = await openAndAnswer('Buonasera');

    await expect(
      createCaller(otherUserId).lesson.startOver({ id: lessonId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const lesson = await createCaller().lesson.getById({ id: lessonId });
    expect(lesson.version!.exercises[0].latestAttempt).not.toBeNull();
  });
});
