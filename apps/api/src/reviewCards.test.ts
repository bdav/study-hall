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
  lessons: [{ title: 'Greetings', objectives: ['Greet someone formally'] }],
};

const lessonOutput = {
  content: [
    {
      heading: 'Saying hello',
      paragraphs: ['Use buongiorno with strangers until the afternoon.'],
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
      type: 'FILL_IN_THE_BLANK',
      prompt: '___, Marco!',
      expectedAnswers: ['Ciao'],
    },
    {
      type: 'FREE_FORM_EXPLANATION',
      prompt: 'When would you say buonasera?',
      essentialPoints: ['It greets someone in the evening'],
      supplementaryPoints: [],
    },
  ],
  summary: 'Taught ciao, buongiorno and buonasera.',
};

const proposal = {
  cards: [
    {
      type: 'TYPED_RECALL',
      front: 'Translate: Good morning',
      canonicalAnswer: 'Buongiorno',
    },
    {
      type: 'TYPED_RECALL',
      front: 'Translate: Good evening',
      canonicalAnswer: 'Buonasera',
    },
  ],
};

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'review-cards@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-review-cards@example.com', passwordHash: 'fakehash' },
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
    'review-cards@example.com, other-review-cards@example.com',
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
 * Creates a course through the router and opens its lesson, so the lesson
 * has a generated version. Returns the lesson, its exercises and the
 * Course Deck.
 */
async function openLesson() {
  const caller = createCaller();
  ai.respondWith(syllabus);
  const { id } = await caller.course.create(courseForm);
  await caller.course.acceptProposal({ courseId: id });
  const course = await caller.course.getById({ id });

  ai.respondWith(lessonOutput);
  const lesson = await caller.lesson.generate({ id: course.lessons[0].id });
  ai.reset();

  return {
    lessonId: lesson.id,
    exercises: lesson.version!.exercises,
    deckId: course.deckId!,
  };
}

describe('lesson.proposeReviewCards', () => {
  it('proposes cards in one model call from the lesson, its incorrect attempts and the Course Deck', async () => {
    const { lessonId, exercises, deckId } = await openLesson();
    const caller = createCaller();
    const [translate, blank] = exercises;
    await caller.exercise.submitAttempt({
      exerciseId: translate.id,
      answer: 'Buonasera',
    });
    await caller.exercise.submitAttempt({
      exerciseId: blank.id,
      answer: 'Ciao',
    });
    await caller.card.create({
      deckId,
      front: 'Italian for thank you',
      canonicalAnswer: 'Grazie',
    });

    ai.respondWith(proposal);
    const proposed = await caller.lesson.proposeReviewCards({ id: lessonId });

    expect(proposed.cards).toEqual(proposal.cards);
    expect(ai.requests).toHaveLength(1);
    const [request] = ai.requests;
    expect(request.model).toBe('claude-sonnet-5-5');
    expect(request.prompt).toContain(
      'Use buongiorno with strangers until the afternoon.',
    );
    expect(request.prompt).toContain('Ciao, Marco!');
    expect(request.prompt).toContain('Taught ciao, buongiorno and buonasera.');
    // The exercise the learner got wrong, with their answer and the right one
    expect(request.prompt).toContain('Translate: Good morning');
    expect(request.prompt).toContain('Buonasera');
    expect(request.prompt).toContain('Buongiorno');
    // An exercise answered correctly isn't a weakness
    expect(request.prompt).not.toContain('___, Marco!');
    // Existing cards, so the model doesn't propose them again
    expect(request.prompt).toContain('Italian for thank you');
    expect(request.prompt).toContain('Grazie');
  });

  it('returns the model and prompt version, and the Course Deck cards for flagging duplicates', async () => {
    const { lessonId, deckId } = await openLesson();
    const caller = createCaller();
    const existing = await caller.card.create({
      deckId,
      front: 'Translate: Good morning',
      canonicalAnswer: 'Buongiorno',
    });

    ai.respondWith(proposal);
    const proposed = await caller.lesson.proposeReviewCards({ id: lessonId });

    expect(proposed).toMatchObject({
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-proposal-v2',
      existingCards: [
        {
          id: existing!.id,
          front: 'Translate: Good morning',
          canonicalAnswer: 'Buongiorno',
        },
      ],
    });
  });

  it('writes a usage record and stores nothing', async () => {
    const { lessonId, deckId } = await openLesson();
    const caller = createCaller();

    ai.respondWith(proposal);
    await caller.lesson.proposeReviewCards({ id: lessonId });

    const report = await caller.aiUsage.report();
    expect(report.breakdown).toContainEqual(
      expect.objectContaining({ purpose: 'CARD_PROPOSAL', calls: 1 }),
    );
    expect(await caller.card.listByDeck({ deckId })).toEqual([]);
  });

  it('sends the model no exercises when the learner got none wrong', async () => {
    const { lessonId } = await openLesson();

    ai.respondWith(proposal);
    await createCaller().lesson.proposeReviewCards({ id: lessonId });

    expect(ai.requests[0].prompt).not.toContain('The learner answered');
  });

  it('counts a partially correct explanation as got wrong', async () => {
    const { lessonId, exercises } = await openLesson();
    const caller = createCaller();
    const explanation = exercises[2];
    ai.respondWith({
      points: [
        {
          point: 'It greets someone in the evening',
          evidence: 'Says it is for nights',
          status: 'WRONG',
        },
      ],
      misconceptions: [],
      feedback: 'Think about the time of day.',
    });
    await caller.exercise.submitAttempt({
      exerciseId: explanation.id,
      answer: 'At bedtime',
    });

    ai.respondWith(proposal);
    await caller.lesson.proposeReviewCards({ id: lessonId });

    expect(ai.requests[1].prompt).toContain('When would you say buonasera?');
    expect(ai.requests[1].prompt).toContain('At bedtime');
    expect(ai.requests[1].prompt).toContain('It greets someone in the evening');
  });

  it('is refused to a learner without AI access, before any model call', async () => {
    const { lessonId } = await openLesson();
    vi.stubEnv('AI_ALLOWED_EMAILS', 'other-review-cards@example.com');

    await expect(
      createCaller().lesson.proposeReviewCards({ id: lessonId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(ai.requests).toHaveLength(0);
  });

  it("refuses another learner's lesson", async () => {
    const { lessonId } = await openLesson();

    await expect(
      createCaller(otherUserId).lesson.proposeReviewCards({ id: lessonId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ai.requests).toHaveLength(0);
  });

  it("refuses a lesson that hasn't been written yet", async () => {
    const caller = createCaller();
    ai.respondWith(syllabus);
    const { id } = await caller.course.create(courseForm);
    await caller.course.acceptProposal({ courseId: id });
    const course = await caller.course.getById({ id });
    ai.reset();

    await expect(
      caller.lesson.proposeReviewCards({ id: course.lessons[0].id }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(ai.requests).toHaveLength(0);
  });

  it('fails retryably when the model proposes no usable cards', async () => {
    const { lessonId } = await openLesson();

    ai.respondWith({ cards: [] });

    await expect(
      createCaller().lesson.proposeReviewCards({ id: lessonId }),
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});

describe('lesson.createReviewCards', () => {
  /** Confirms proposals as the preview sends them. */
  function confirm(
    lessonId: string,
    cards: { front: string; canonicalAnswer: string }[],
    caller = createCaller(),
  ) {
    return caller.lesson.createReviewCards({
      id: lessonId,
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-proposal-v2',
      cards: cards.map((card) => ({ type: 'TYPED_RECALL' as const, ...card })),
    });
  }

  it('creates the confirmed cards at the end of the Course Deck, from the lesson and the proposal that made them', async () => {
    const { lessonId, deckId } = await openLesson();
    const caller = createCaller();
    await caller.card.create({
      deckId,
      front: 'Italian for thank you',
      canonicalAnswer: 'Grazie',
    });

    const result = await confirm(lessonId, [
      { front: 'Translate: Good morning', canonicalAnswer: 'Buongiorno' },
      { front: 'Translate: Good evening', canonicalAnswer: 'Buonasera' },
    ]);

    expect(result).toEqual({ deckId, createdCount: 2 });
    const cards = await caller.card.listByDeck({ deckId });
    expect(cards).toMatchObject([
      { front: 'Italian for thank you', sourceLessonId: null },
      {
        front: 'Translate: Good morning',
        canonicalAnswers: [{ text: 'Buongiorno', isPrimary: true }],
        sourceLessonId: lessonId,
        sourceModel: 'claude-sonnet-5-5',
        sourcePromptVersion: 'card-proposal-v2',
      },
      {
        front: 'Translate: Good evening',
        canonicalAnswers: [{ text: 'Buonasera', isPrimary: true }],
        sourceLessonId: lessonId,
      },
    ]);
  });

  it('records the model and prompt version of the proposal the cards came from', async () => {
    const { lessonId, deckId } = await openLesson();
    const caller = createCaller();
    ai.respondWith(proposal);
    const proposed = await caller.lesson.proposeReviewCards({ id: lessonId });

    await caller.lesson.createReviewCards({
      id: lessonId,
      model: proposed.model,
      promptVersion: proposed.promptVersion,
      cards: proposed.cards,
    });

    const cards = await caller.card.listByDeck({ deckId });
    expect(
      cards.map(({ sourceModel, sourcePromptVersion }) => ({
        sourceModel,
        sourcePromptVersion,
      })),
    ).toEqual([
      {
        sourceModel: 'claude-sonnet-5-5',
        sourcePromptVersion: 'card-proposal-v2',
      },
      {
        sourceModel: 'claude-sonnet-5-5',
        sourcePromptVersion: 'card-proposal-v2',
      },
    ]);
  });

  it('makes no model call', async () => {
    const { lessonId } = await openLesson();

    await confirm(lessonId, [
      { front: 'Translate: Good morning', canonicalAnswer: 'Buongiorno' },
    ]);

    expect(ai.requests).toHaveLength(0);
  });

  it('creates cards that study like any other card, as NEW cards', async () => {
    const { lessonId, deckId } = await openLesson();
    const caller = createCaller();
    await confirm(lessonId, [
      { front: 'Translate: Good morning', canonicalAnswer: 'Buongiorno' },
    ]);

    // A Standard queue takes NEW cards from their card progress
    const session = await caller.study.startSession({ deckId });
    expect(session?.items.map((item) => item.card.front)).toEqual([
      'Translate: Good morning',
    ]);
    const answer = await caller.study.submitAnswer({
      itemId: session!.items[0].id,
      userAnswer: 'buongiorno',
    });
    expect(answer.recallGrade).toBe('NAILED');
  });

  it('creates nothing when one card is invalid', async () => {
    const { lessonId, deckId } = await openLesson();

    await expect(
      confirm(lessonId, [
        { front: 'Translate: Good morning', canonicalAnswer: 'Buongiorno' },
        { front: 'Translate: Good evening', canonicalAnswer: '  ' },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await createCaller().card.listByDeck({ deckId })).toEqual([]);
  });

  it('needs at least one card', async () => {
    const { lessonId } = await openLesson();

    await expect(confirm(lessonId, [])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it("refuses another learner's lesson and creates nothing", async () => {
    const { lessonId, deckId } = await openLesson();

    await expect(
      confirm(
        lessonId,
        [{ front: 'Translate: Good morning', canonicalAnswer: 'Buongiorno' }],
        createCaller(otherUserId),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await createCaller().card.listByDeck({ deckId })).toEqual([]);
  });
});
