import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
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
  minutesPerWeek: 60,
  sessionMinutes: 30,
  depth: 'Practical',
  focus: 'Speaking',
  canAlreadyDo: ['Count to ten'],
  deadline: '2026-11-30',
};

/** Four lessons: 1 complete, 2 opened, 3 and 4 not started. */
const syllabus = {
  lessons: [
    { title: 'Greetings', objectives: ['Greet someone'] },
    { title: 'At the café', objectives: ['Order a coffee'] },
    { title: 'Numbers', objectives: ['Count to one hundred'] },
    { title: 'Directions', objectives: ['Ask the way'] },
  ],
};

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  userId = (
    await prisma.user.create({
      data: { email: 'revise-test@example.com', passwordHash: 'fakehash' },
    })
  ).id;
  otherUserId = (
    await prisma.user.create({
      data: { email: 'other-revise@example.com', passwordHash: 'fakehash' },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.course.deleteMany({});
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.stubEnv(
    'AI_ALLOWED_EMAILS',
    'revise-test@example.com, other-revise@example.com',
  );
  vi.stubEnv('AI_MONTHLY_CAP_USD', '100');
  // Monday 2 November 2026: 4 weeks before the deadline
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

function createCaller(id = userId) {
  return appRouter.createCaller({
    prisma,
    userId: id,
    sessionToken: null,
    ai,
  });
}

/**
 * An accepted Syllabus of the fixture's four lessons: the first complete,
 * the second opened with a written version, the others not started.
 */
async function acceptedCourse() {
  const caller = createCaller();
  ai.respondWith(syllabus);
  const { id } = await caller.course.create(courseForm);
  await caller.course.acceptProposal({ courseId: id });
  const lessons = await prisma.lesson.findMany({
    where: { courseId: id },
    orderBy: { position: 'asc' },
  });
  await prisma.lesson.update({
    where: { id: lessons[0].id },
    data: { firstOpenedAt: new Date(), completedAt: new Date() },
  });
  await prisma.lesson.update({
    where: { id: lessons[1].id },
    data: {
      firstOpenedAt: new Date(),
      versions: {
        create: {
          content: [],
          examples: [],
          summary: 'Taught ordering un caffè and un cappuccino.',
          model: 'claude-sonnet-5-5',
          promptVersion: 'lesson-v9',
        },
      },
    },
  });
  ai.reset();
  return { id, lessons, caller };
}

/** The Syllabus's lesson titles, in order. */
async function syllabusTitles(courseId: string) {
  const lessons = await prisma.lesson.findMany({
    where: { courseId, archivedAt: null },
    orderBy: { position: 'asc' },
  });
  return lessons.map((lesson) => lesson.title);
}

describe('course.proposeSyllabusRevision', () => {
  it('sends the Course Setup, the Syllabus with statuses and summaries, and the chips as instructions', async () => {
    const { id, caller } = await acceptedCourse();
    ai.respondWith({ changes: [] });

    await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['SPEED_UP'],
      feedback: 'I already know my numbers',
    });

    const { prompt, system, model } = ai.requests[0];
    expect(model).toBe('claude-sonnet-5-5');
    expect(prompt).toContain('Focus: Speaking');
    expect(prompt).toContain('Can already do:\n- Count to ten');
    expect(prompt).toMatch(/1\. Greetings \(complete\)/);
    expect(prompt).toMatch(/2\. At the café \(opened\)/);
    expect(prompt).toMatch(/3\. Numbers \(not started\)/);
    expect(prompt).toContain('Taught ordering un caffè');
    expect(prompt).toMatch(/Speed up:/);
    expect(prompt).toContain('I already know my numbers');
    expect(system).toMatch(/variety of a language/);
  });

  it('proposes edits, archives, additions and a new order for the lessons ahead', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    ai.respondWith({
      changes: [
        { action: 'EDIT', lesson: 3, title: 'Numbers to a thousand' },
        { action: 'ARCHIVE', lesson: 4 },
        {
          action: 'ADD',
          title: 'Telling the time',
          objectives: ['Say what time it is'],
          after: 3,
        },
      ],
      order: [1, 2, 4, 3],
      note: 'Directions moved later.',
    });

    const proposal = await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['FEWER_LESSONS'],
    });

    expect(proposal).toMatchObject({
      model: 'claude-sonnet-5-5',
      note: 'Directions moved later.',
      edits: [
        {
          lessonId: lessons[2].id,
          before: { title: 'Numbers', objectives: ['Count to one hundred'] },
          after: {
            title: 'Numbers to a thousand',
            objectives: ['Count to one hundred'],
          },
        },
      ],
      archives: [{ lessonId: lessons[3].id, title: 'Directions' }],
      additions: [
        {
          title: 'Telling the time',
          objectives: ['Say what time it is'],
          afterLessonId: lessons[2].id,
        },
      ],
      order: {
        before: lessons.map((lesson) => lesson.id),
        after: [lessons[0].id, lessons[1].id, lessons[3].id, lessons[2].id],
      },
    });
  });

  it('drops changes to opened, complete or unknown lessons, second changes and changes to nothing', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    ai.respondWith({
      changes: [
        { action: 'EDIT', lesson: 1, title: 'Hello again' },
        { action: 'ARCHIVE', lesson: 2 },
        { action: 'EDIT', lesson: 9, title: 'Nowhere' },
        { action: 'EDIT', lesson: 3, title: 'Numbers' },
        { action: 'EDIT', lesson: 4, title: 'Finding your way' },
        { action: 'ARCHIVE', lesson: 4 },
        { action: 'ADD', title: 'Lost', objectives: ['Get lost'], after: 9 },
      ],
      // Moves the opened lesson: it keeps its place, the others move round it
      order: [2, 1, 4, 3],
    });

    const proposal = await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: [],
      feedback: 'Tidy it up',
    });

    expect(proposal.edits).toEqual([
      expect.objectContaining({
        lessonId: lessons[3].id,
        after: expect.objectContaining({ title: 'Finding your way' }),
      }),
    ]);
    expect(proposal.archives).toEqual([]);
    expect(proposal.additions).toEqual([]);
    expect(proposal.order?.after).toEqual([
      lessons[0].id,
      lessons[1].id,
      lessons[3].id,
      lessons[2].id,
    ]);
  });

  it('places a new lesson after the lessons the learner has started, never before them', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    ai.respondWith({
      changes: [
        {
          action: 'ADD',
          title: 'Alphabet',
          objectives: ['Spell your name'],
          after: 0,
        },
        {
          action: 'ADD',
          title: 'Review',
          objectives: ['Go over it'],
          after: 1,
        },
      ],
    });

    const { additions } = await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['SLOW_DOWN'],
    });

    expect(additions.map((addition) => addition.afterLessonId)).toEqual([
      lessons[1].id,
      lessons[1].id,
    ]);
  });

  it('leaves out of a refined proposal a new lesson whose place has gone', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    await prisma.lesson.update({
      where: { id: lessons[3].id },
      data: { archivedAt: new Date() },
    });
    ai.respondWith({ changes: [] });

    await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['SLOW_DOWN'],
      refining: {
        rounds: [{ chips: ['MORE_LESSONS'], text: null }],
        proposal: {
          edits: [],
          archives: [],
          additions: [
            {
              title: 'After directions',
              objectives: ['Follow up'],
              afterLessonId: lessons[3].id,
              included: true,
            },
          ],
          order: null,
        },
      },
    });

    expect(ai.requests[0].prompt).not.toContain('After directions');
  });

  it('gives the pacing of the lessons left at each count the ticked changes can reach', async () => {
    const { id, caller } = await acceptedCourse();
    ai.respondWith({
      changes: [
        { action: 'ARCHIVE', lesson: 4 },
        {
          action: 'ADD',
          title: 'Time',
          objectives: ['Tell the time'],
          after: 4,
        },
        {
          action: 'ADD',
          title: 'Weather',
          objectives: ['Talk about it'],
          after: 4,
        },
      ],
    });

    const { pacing } = await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['MORE_LESSONS'],
    });

    // 3 lessons left (1 is complete), 30 minutes each at an hour a week
    expect(pacing?.lessonsLeft).toBe(3);
    expect(
      pacing?.byLessonsLeft.map(({ lessons, weeks }) => [lessons, weeks]),
    ).toEqual([
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
    ]);
    expect(pacing?.byLessonsLeft[1].deadline).toEqual({
      finishesBefore: true,
      weeksOver: 0,
    });
  });

  it('sends every round so far, oldest first, and the proposal as the learner left it', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    ai.respondWith({ changes: [] });

    await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['MORE_PRACTICAL'],
      feedback: 'Less grammar',
      refining: {
        rounds: [{ chips: ['SLOW_DOWN'], text: 'Too fast' }],
        proposal: {
          edits: [
            {
              lessonId: lessons[2].id,
              title: 'Numbers, slowly',
              objectives: ['Count to twenty'],
              included: true,
            },
          ],
          archives: [{ lessonId: lessons[3].id, included: false }],
          additions: [
            {
              title: 'Review',
              objectives: ['Go over the basics'],
              afterLessonId: lessons[2].id,
              included: true,
            },
          ],
          order: null,
        },
      },
    });

    const { prompt } = ai.requests[0];
    expect(prompt.indexOf('Too fast')).toBeLessThan(
      prompt.indexOf('Less grammar'),
    );
    expect(prompt).toMatch(/Slow down:/);
    expect(prompt).toMatch(/More practical:/);
    expect(prompt).toContain('Numbers, slowly');
    expect(prompt).toMatch(/Archive lesson 4 \(unticked by the learner\)/);
    expect(prompt).toMatch(/Add "Review" after lesson 3/);
  });

  it('records the AI usage of the revision', async () => {
    const { id, caller } = await acceptedCourse();
    ai.respondWith({ changes: [] }, { inputTokens: 700, outputTokens: 120 });

    await caller.course.proposeSyllabusRevision({
      courseId: id,
      chips: ['SPEED_UP'],
    });

    expect(
      await prisma.aiUsage.findMany({
        where: { purpose: 'SYLLABUS_REVISION' },
      }),
    ).toEqual([
      expect.objectContaining({
        userId,
        purpose: 'SYLLABUS_REVISION',
        inputTokens: 700,
        outputTokens: 120,
      }),
    ]);
  });

  it.each([
    ['neither chip nor words', { chips: [] }],
    ['both of a pair', { chips: ['SPEED_UP', 'SLOW_DOWN'] }],
  ] satisfies [string, { chips: ('SPEED_UP' | 'SLOW_DOWN')[] }][])(
    'refuses %s, without calling the model',
    async (_, ask) => {
      const { id, caller } = await acceptedCourse();

      await expect(
        caller.course.proposeSyllabusRevision({ courseId: id, ...ask }),
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
      expect(ai.requests).toHaveLength(0);
    },
  );

  it('needs AI access, and refuses while AI is paused, without calling the model', async () => {
    const { id, caller } = await acceptedCourse();

    vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');
    await expect(
      caller.course.proposeSyllabusRevision({
        courseId: id,
        chips: ['SPEED_UP'],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

    vi.stubEnv('AI_ALLOWED_EMAILS', 'revise-test@example.com');
    vi.stubEnv('AI_MONTHLY_CAP_USD', '5');
    await prisma.aiUsage.create({
      data: {
        userId,
        purpose: 'SYLLABUS_GENERATION',
        model: 'claude-sonnet-5-5',
        inputTokens: 0,
        outputTokens: 500_000,
      },
    });
    await expect(
      caller.course.proposeSyllabusRevision({
        courseId: id,
        chips: ['SPEED_UP'],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }));
    expect(ai.requests).toHaveLength(0);
  });

  it("hides another learner's course", async () => {
    const { id } = await acceptedCourse();

    await expect(
      createCaller(otherUserId).course.proposeSyllabusRevision({
        courseId: id,
        chips: ['SPEED_UP'],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(ai.requests).toHaveLength(0);
  });
});

describe('course.applySyllabusRevision', () => {
  it('applies edits, archives, additions and the new order in one go', async () => {
    const { id, lessons, caller } = await acceptedCourse();

    await caller.course.applySyllabusRevision({
      courseId: id,
      edits: [
        {
          lessonId: lessons[2].id,
          title: 'Numbers to a thousand',
          objectives: ['Count to a thousand'],
        },
      ],
      archives: [lessons[3].id],
      additions: [
        {
          title: 'Telling the time',
          objectives: ['Say what time it is'],
          afterLessonId: lessons[1].id,
        },
      ],
      order: [lessons[0].id, lessons[1].id, lessons[3].id, lessons[2].id],
    });

    expect(await syllabusTitles(id)).toEqual([
      'Greetings',
      'At the café',
      'Telling the time',
      'Numbers to a thousand',
    ]);
    const numbers = await prisma.lesson.findUniqueOrThrow({
      where: { id: lessons[2].id },
    });
    expect(numbers.objectives).toEqual(['Count to a thousand']);
  });

  it('keeps an archived lesson restorable to its place', async () => {
    const { id, lessons, caller } = await acceptedCourse();

    await caller.course.applySyllabusRevision({
      courseId: id,
      edits: [],
      archives: [lessons[2].id],
      additions: [],
      order: null,
    });
    await caller.course.restoreLesson({ lessonId: lessons[2].id });

    expect(await syllabusTitles(id)).toEqual([
      'Greetings',
      'At the café',
      'Numbers',
      'Directions',
    ]);
  });

  it('adds a lesson at the start when it follows no lesson', async () => {
    const { id, caller } = await acceptedCourse();

    await caller.course.applySyllabusRevision({
      courseId: id,
      edits: [],
      archives: [],
      additions: [
        {
          title: 'Pronunciation',
          objectives: ['Say the vowels'],
          afterLessonId: null,
        },
      ],
      order: null,
    });

    expect((await syllabusTitles(id))[0]).toBe('Pronunciation');
  });

  it('refuses a change to a lesson opened meanwhile, changing nothing', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    await prisma.lesson.update({
      where: { id: lessons[2].id },
      data: { firstOpenedAt: new Date() },
    });

    await expect(
      caller.course.applySyllabusRevision({
        courseId: id,
        edits: [{ lessonId: lessons[2].id, title: 'Numbers again' }],
        archives: [lessons[3].id],
        additions: [],
        order: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
    expect(await syllabusTitles(id)).toEqual([
      'Greetings',
      'At the café',
      'Numbers',
      'Directions',
    ]);
  });

  it('refuses an order that moves an opened lesson', async () => {
    const { id, lessons, caller } = await acceptedCourse();

    await expect(
      caller.course.applySyllabusRevision({
        courseId: id,
        edits: [],
        archives: [],
        additions: [],
        order: [lessons[1].id, lessons[0].id, lessons[2].id, lessons[3].id],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('refuses a revision of an archived course', async () => {
    const { id, lessons, caller } = await acceptedCourse();
    await caller.course.archive({ courseId: id });

    await expect(
      caller.course.applySyllabusRevision({
        courseId: id,
        edits: [],
        archives: [lessons[3].id],
        additions: [],
        order: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('keeps the Syllabus within its lessons', async () => {
    const { id, caller } = await acceptedCourse();
    await prisma.lesson.createMany({
      data: Array.from({ length: 96 }, (_, i) => ({
        courseId: id,
        title: `Extra ${i}`,
        objectives: ['More'],
        position: 10 + i,
      })),
    });

    await expect(
      caller.course.applySyllabusRevision({
        courseId: id,
        edits: [],
        archives: [],
        additions: [
          {
            title: 'One too many',
            objectives: ['Overflow'],
            afterLessonId: null,
          },
        ],
        order: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('keeps at least one lesson in the Syllabus', async () => {
    const caller = createCaller();
    ai.respondWith({ lessons: syllabus.lessons.slice(2, 3) });
    const { id } = await caller.course.create(courseForm);
    await caller.course.acceptProposal({ courseId: id });
    const [only] = await prisma.lesson.findMany({ where: { courseId: id } });

    await expect(
      caller.course.applySyllabusRevision({
        courseId: id,
        edits: [],
        archives: [only.id],
        additions: [],
        order: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it("needs no AI access, and is the owner's only", async () => {
    const { id, lessons } = await acceptedCourse();
    vi.stubEnv('AI_ALLOWED_EMAILS', '');

    await expect(
      createCaller(otherUserId).course.applySyllabusRevision({
        courseId: id,
        edits: [],
        archives: [lessons[3].id],
        additions: [],
        order: null,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    await createCaller().course.applySyllabusRevision({
      courseId: id,
      edits: [],
      archives: [lessons[3].id],
      additions: [],
      order: null,
    });
    expect(await syllabusTitles(id)).not.toContain('Directions');
  });
});
