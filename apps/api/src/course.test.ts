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
    {
      title: 'Greetings',
      objectives: ['Greet someone formally and informally', 'Say your name'],
    },
    { title: 'At the café', objectives: ['Order food and drinks'] },
    { title: 'Numbers', objectives: ['Count to one hundred'] },
  ],
};

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'course-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-course@example.com', passwordHash: 'fakehash' },
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
    'course-test@example.com, other-course@example.com',
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

/** Creates a course through the router with the fixture syllabus. */
async function createCourse(caller = createCaller()) {
  ai.respondWith(syllabus);
  return caller.course.create(courseForm);
}

describe('courseRouter', () => {
  describe('AI access', () => {
    it('refuses to create a course for a user not on the allowlist', async () => {
      vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');
      ai.respondWith(syllabus);

      await expect(createCaller().course.create(courseForm)).rejects.toThrow(
        expect.objectContaining({
          code: 'FORBIDDEN',
          message: expect.stringMatching(/AI features/),
        }),
      );
      expect(ai.requests).toHaveLength(0);
      expect(await prisma.course.count()).toBe(0);
    });

    it('lets nobody use AI when the allowlist is unset', async () => {
      vi.stubEnv('AI_ALLOWED_EMAILS', undefined);

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });

    it('matches allowlisted emails regardless of case', async () => {
      vi.stubEnv('AI_ALLOWED_EMAILS', 'Course-Test@Example.com');

      await expect(createCourse()).resolves.toHaveProperty('id');
    });

    it('reports AI access with the logged-in user', async () => {
      vi.stubEnv('AI_ALLOWED_EMAILS', 'course-test@example.com');

      const allowed = await createCaller().auth.me();
      const refused = await createCaller(otherUserId).auth.me();

      expect(allowed.user?.canUseAI).toBe(true);
      expect(refused.user?.canUseAI).toBe(false);
    });

    it('keeps standalone flashcards available without AI access', async () => {
      vi.stubEnv('AI_ALLOWED_EMAILS', '');
      const caller = createCaller();

      const deck = await caller.deck.create({ name: 'Capitals' });
      await caller.card.create({
        deckId: deck.id,
        front: 'France',
        canonicalAnswers: ['Paris'],
      });
      const session = await caller.study.startSession({ deckId: deck.id });

      expect(session?.items).toHaveLength(1);
    });
  });

  describe('monthly AI spending cap', () => {
    /** Records AI usage costing the given dollars at Sonnet 5.5's $10 per million output tokens. */
    async function recordSpend(
      dollars: number,
      { by = userId, at = new Date() }: { by?: string; at?: Date } = {},
    ) {
      await prisma.aiUsage.create({
        data: {
          userId: by,
          purpose: 'SYLLABUS_GENERATION',
          model: 'claude-sonnet-5-5',
          inputTokens: 0,
          outputTokens: dollars * 100_000,
          createdAt: at,
        },
      });
    }

    it('pauses AI features once the month reaches the cap, without calling the model', async () => {
      vi.stubEnv('AI_MONTHLY_CAP_USD', '5');
      await recordSpend(5);

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({
          code: 'TOO_MANY_REQUESTS',
          message: expect.stringMatching(/paused/),
        }),
      );
      expect(ai.requests).toHaveLength(0);
      expect(await prisma.course.count()).toBe(0);
    });

    it('keeps AI features available below the cap', async () => {
      vi.stubEnv('AI_MONTHLY_CAP_USD', '5');
      await recordSpend(4.99);

      await expect(createCourse()).resolves.toHaveProperty('id');
      expect(ai.requests).toHaveLength(1);
    });

    it('stays paused over the cap', async () => {
      vi.stubEnv('AI_MONTHLY_CAP_USD', '5');
      await recordSpend(7.5);

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }),
      );
      expect(ai.requests).toHaveLength(0);
    });

    it("counts every user's AI usage toward the cap", async () => {
      vi.stubEnv('AI_MONTHLY_CAP_USD', '5');
      await recordSpend(3);
      await recordSpend(2, { by: otherUserId });

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }),
      );
    });

    it('starts each month afresh, in UTC', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
      vi.stubEnv('AI_MONTHLY_CAP_USD', '5');

      try {
        await recordSpend(5, { at: new Date('2026-09-30T23:59:59.999Z') });
        await expect(createCourse()).resolves.toHaveProperty('id');

        await recordSpend(5, { at: new Date('2026-10-01T00:00:00Z') });
        await expect(createCourse()).rejects.toThrow(
          expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['unset', undefined],
      ['not a number', 'ten dollars'],
    ])('pauses AI features when the cap is %s', async (_, cap) => {
      vi.stubEnv('AI_MONTHLY_CAP_USD', cap);

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }),
      );
      expect(ai.requests).toHaveLength(0);
    });

    it('counts a call that timed out toward the cap', async () => {
      // The failed call's 16,000-token output budget alone costs $0.16 at
      // Sonnet 5.5's rate, and its input estimate adds a little more
      vi.stubEnv('AI_MONTHLY_CAP_USD', '0.16');
      ai.failWith('timeout');

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_GATEWAY' }),
      );
      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }),
      );
      expect(ai.requests).toHaveLength(1);
    });

    it('does not count a call that failed with an API error toward the cap', async () => {
      vi.stubEnv('AI_MONTHLY_CAP_USD', '0.16');
      ai.failWith('api-error');

      await expect(createCourse()).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_GATEWAY' }),
      );
      await expect(createCourse()).resolves.toHaveProperty('id');
    });

    it('keeps flashcards and existing courses usable while paused', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);
      vi.stubEnv('AI_MONTHLY_CAP_USD', '5');
      await recordSpend(5);

      await caller.course.acceptProposal({ courseId: id });
      const course = await caller.course.getById({ id });
      const courses = await caller.course.list();
      const deck = await caller.deck.create({ name: 'Capitals' });
      await caller.card.create({
        deckId: deck.id,
        front: 'France',
        canonicalAnswers: ['Paris'],
      });
      const session = await caller.study.startSession({ deckId: deck.id });

      expect(course.lessons).toHaveLength(syllabus.lessons.length);
      expect(courses).toHaveLength(1);
      expect(session?.items).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('generates a Syllabus Proposal from the course form', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);

      const course = await caller.course.getById({ id });

      expect(course).toMatchObject({ title: 'Italian', ...courseForm });
      expect(course.proposal).toMatchObject({
        lessons: syllabus.lessons,
        model: 'claude-sonnet-5-5',
        promptVersion: 'syllabus-v1',
        acceptedAt: null,
      });
      expect(course.lessons).toEqual([]);
    });

    it('sends the setup answers to the model', async () => {
      await createCourse();

      expect(ai.requests).toHaveLength(1);
      const { prompt, model } = ai.requests[0];
      expect(model).toBe('claude-sonnet-5-5');
      for (const answer of Object.values(courseForm)) {
        expect(prompt).toContain(answer);
      }
    });

    it('records the AI usage of the generation', async () => {
      ai.respondWith(syllabus, { inputTokens: 812, outputTokens: 1450 });
      await createCaller().course.create(courseForm);

      const usage = await prisma.aiUsage.findMany();
      expect(usage).toEqual([
        expect.objectContaining({
          userId,
          purpose: 'SYLLABUS_GENERATION',
          model: 'claude-sonnet-5-5',
          inputTokens: 812,
          outputTokens: 1450,
          createdAt: expect.any(Date),
        }),
      ]);
    });

    it.each([
      ['text that is not JSON', 'Here is your syllabus: ...'],
      ['JSON that fails the syllabus schema', { lessons: [] }],
    ])(
      'treats %s as a retryable error and stores nothing',
      async (_, output) => {
        ai.respondWith(output);

        await expect(createCaller().course.create(courseForm)).rejects.toThrow(
          expect.objectContaining({
            code: 'BAD_GATEWAY',
            message: expect.stringMatching(/try again/i),
          }),
        );
        expect(await prisma.course.count()).toBe(0);
        expect(await prisma.deck.count()).toBe(0);
        // The call still happened, so its usage is still recorded
        expect(await prisma.aiUsage.count()).toBe(1);
      },
    );

    it.each(['timeout', 'connection-error', 'api-error'] as const)(
      'treats a model call that fails with a %s as a retryable error',
      async (failure) => {
        ai.failWith(failure);

        await expect(createCaller().course.create(courseForm)).rejects.toThrow(
          expect.objectContaining({
            code: 'BAD_GATEWAY',
            message: expect.stringMatching(/try again/i),
          }),
        );
        expect(await prisma.course.count()).toBe(0);
      },
    );

    it.each(['timeout', 'connection-error'] as const)(
      'records a call that fails with a %s as failed, with its full output budget',
      async (failure) => {
        ai.failWith(failure);

        await expect(
          createCaller().course.create(courseForm),
        ).rejects.toThrow();

        const usage = await prisma.aiUsage.findMany();
        expect(usage).toEqual([
          expect.objectContaining({
            userId,
            purpose: 'SYLLABUS_GENERATION',
            model: 'claude-sonnet-5-5',
            outputTokens: ai.requests[0].maxTokens,
            failed: true,
          }),
        ]);
      },
    );

    it('estimates the input tokens of a failed call at no less than the bytes of its prompts', async () => {
      ai.failWith('timeout');

      await expect(createCaller().course.create(courseForm)).rejects.toThrow();

      // A token usually spans several bytes, so this overcounts the prompt text
      const { system, prompt } = ai.requests[0];
      const requestBytes = Buffer.byteLength(system + prompt, 'utf8');
      const [usage] = await prisma.aiUsage.findMany();
      expect(usage.inputTokens).toBeGreaterThanOrEqual(requestBytes);
    });

    it('records the token counts the provider reports for a failed call', async () => {
      ai.failWith('connection-error', { inputTokens: 812, outputTokens: 300 });

      await expect(createCaller().course.create(courseForm)).rejects.toThrow();

      expect(await prisma.aiUsage.findMany()).toEqual([
        expect.objectContaining({
          inputTokens: 812,
          outputTokens: 300,
          failed: true,
        }),
      ]);
    });

    it('records no usage for a call that fails with an API error', async () => {
      ai.failWith('api-error');

      await expect(createCaller().course.create(courseForm)).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_GATEWAY' }),
      );

      expect(await prisma.aiUsage.count()).toBe(0);
    });

    it('creates no Course Deck until the proposal is accepted', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);

      expect((await caller.course.getById({ id })).deckId).toBeNull();
      expect(await caller.deck.list()).toEqual([]);
    });
  });

  describe('acceptProposal', () => {
    it('creates the Syllabus: Lessons in order with their objectives', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);

      await caller.course.acceptProposal({ courseId: id });
      const course = await caller.course.getById({ id });

      expect(
        course.lessons.map(({ title, position, objectives, archivedAt }) => ({
          title,
          position,
          objectives,
          archivedAt,
        })),
      ).toEqual([
        {
          title: 'Greetings',
          position: 0,
          objectives: [
            'Greet someone formally and informally',
            'Say your name',
          ],
          archivedAt: null,
        },
        {
          title: 'At the café',
          position: 1,
          objectives: ['Order food and drinks'],
          archivedAt: null,
        },
        {
          title: 'Numbers',
          position: 2,
          objectives: ['Count to one hundred'],
          archivedAt: null,
        },
      ]);
      expect(course.proposal?.acceptedAt).toBeInstanceOf(Date);
    });

    it('creates the Course Deck, listed in Flashcards with its course', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);
      await caller.deck.create({ name: 'Standalone' });

      await caller.course.acceptProposal({ courseId: id });
      const course = await caller.course.getById({ id });
      const decks = await caller.deck.list();

      const courseDeck = decks.find((deck) => deck.id === course.deckId);
      expect(courseDeck).toMatchObject({
        name: 'Italian',
        course: { id, title: 'Italian' },
      });
      expect(decks.find((deck) => deck.name === 'Standalone')?.course).toBe(
        null,
      );
    });

    it('leaves archived lessons out of the Syllabus', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);
      await caller.course.acceptProposal({ courseId: id });
      await prisma.lesson.updateMany({
        where: { courseId: id, title: 'At the café' },
        data: { archivedAt: new Date() },
      });

      const course = await caller.course.getById({ id });

      expect(course.lessons.map((lesson) => lesson.title)).toEqual([
        'Greetings',
        'Numbers',
      ]);
    });

    it('refuses to accept a proposal twice', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);
      await caller.course.acceptProposal({ courseId: id });

      await expect(
        caller.course.acceptProposal({ courseId: id }),
      ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      expect((await caller.course.getById({ id })).lessons).toHaveLength(3);
      expect(await prisma.deck.count()).toBe(1);
    });
  });

  describe('discardProposal', () => {
    it('deletes a course whose proposal has not been accepted', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);

      await caller.course.discardProposal({ courseId: id });

      expect(await caller.course.list()).toEqual([]);
      await expect(caller.course.getById({ id })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });

    it('keeps the AI usage of a discarded proposal', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);

      await caller.course.discardProposal({ courseId: id });

      expect(await prisma.aiUsage.count()).toBe(1);
    });

    it('refuses to discard an accepted Syllabus', async () => {
      const caller = createCaller();
      const { id } = await createCourse(caller);
      await caller.course.acceptProposal({ courseId: id });

      await expect(
        caller.course.discardProposal({ courseId: id }),
      ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }));
      expect((await caller.course.getById({ id })).lessons).toHaveLength(3);
    });
  });

  describe('ownership', () => {
    it("hides another learner's course, proposal and Syllabus", async () => {
      const { id } = await createCourse();
      const stranger = createCaller(otherUserId);

      await expect(stranger.course.getById({ id })).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
      await expect(
        stranger.course.acceptProposal({ courseId: id }),
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      await expect(
        stranger.course.discardProposal({ courseId: id }),
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(await stranger.course.list()).toEqual([]);
      expect(await prisma.course.count()).toBe(1);
      expect(await prisma.lesson.count()).toBe(0);
    });
  });

  describe('list', () => {
    it('returns an empty list when the learner has no courses', async () => {
      expect(await createCaller().course.list()).toEqual([]);
    });

    it('lists active courses, newest first, with their Syllabus state', async () => {
      const caller = createCaller();
      const first = await createCourse(caller);
      await caller.course.acceptProposal({ courseId: first.id });
      ai.respondWith(syllabus);
      const second = await caller.course.create({
        ...courseForm,
        topic: 'Spanish',
      });

      const courses = await caller.course.list();

      expect(courses).toEqual([
        expect.objectContaining({
          id: second.id,
          title: 'Spanish',
          goal: 'A2 by summer',
          lessonCount: 0,
          syllabusAccepted: false,
        }),
        expect.objectContaining({
          id: first.id,
          title: 'Italian',
          lessonCount: 3,
          syllabusAccepted: true,
        }),
      ]);
    });

    it('leaves out archived courses', async () => {
      const { id } = await createCourse();
      await prisma.course.update({
        where: { id },
        data: { archivedAt: new Date() },
      });

      expect(await createCaller().course.list()).toEqual([]);
    });
  });
});

describe('course review', () => {
  /** A course with an accepted syllabus and these cards in its Course Deck. */
  async function courseWithCards(fronts: string[]) {
    const caller = createCaller();
    const { id } = await createCourse(caller);
    await caller.course.acceptProposal({ courseId: id });
    const { deckId } = await caller.course.getById({ id });
    const cards = [];
    for (const front of fronts) {
      cards.push(
        await caller.card.create({
          deckId: deckId!,
          front,
          canonicalAnswers: ['Ciao'],
        }),
      );
    }
    return { id, deckId: deckId!, cards: cards.map((card) => card!) };
  }

  /** Puts a card into review, due at the given time. */
  async function scheduleCard(cardId: string, dueAt: Date) {
    await prisma.cardProgress.update({
      where: { userId_cardId: { userId, cardId } },
      data: { lifecycleState: 'LEARNING', dueAt },
    });
  }

  it('counts the Course Deck cards that are due and the new ones', async () => {
    const { id, deckId, cards } = await courseWithCards(['A', 'B', 'C', 'D']);
    const hour = 60 * 60 * 1000;
    await scheduleCard(cards[0].id, new Date(Date.now() - hour));
    await scheduleCard(cards[1].id, new Date(Date.now() + 24 * hour));

    const course = await createCaller().course.getById({ id });

    expect(course.review).toEqual({ deckId, dueCount: 1, newCount: 2 });
  });

  it('leaves out retired cards', async () => {
    const { id, cards } = await courseWithCards(['A']);
    await prisma.cardProgress.update({
      where: { userId_cardId: { userId, cardId: cards[0].id } },
      data: { lifecycleState: 'RETIRED', dueAt: new Date(0) },
    });

    const course = await createCaller().course.getById({ id });

    expect(course.review).toMatchObject({ dueCount: 0, newCount: 0 });
  });

  it('has nothing to review before the syllabus is accepted', async () => {
    const { id } = await createCourse();

    const course = await createCaller().course.getById({ id });

    expect(course.review).toBeNull();
  });

  it('needs no AI access', async () => {
    const { id } = await courseWithCards(['A']);
    vi.stubEnv('AI_ALLOWED_EMAILS', '');

    const course = await createCaller().course.getById({ id });

    expect(course.review).toMatchObject({ dueCount: 0, newCount: 1 });
  });

  it("isn't shown to another learner", async () => {
    const { id } = await courseWithCards(['A']);

    await expect(
      createCaller(otherUserId).course.getById({ id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('names the course on its Course Deck, so studying can link back to it', async () => {
    const { id, deckId } = await courseWithCards(['A']);

    const deck = await createCaller().deck.getById({ id: deckId });

    expect(deck.course).toEqual({ id, title: 'Italian' });
  });
});
