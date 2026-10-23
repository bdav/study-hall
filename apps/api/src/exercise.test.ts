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
import { createLessonVersion, createTestPrisma } from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

let userId: string;
let otherUserId: string;

const ai = createFakeAiProvider();

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'exercise-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-exercise@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  await prisma.course.deleteMany({});
  ai.reset();
  // Deterministic checks need no AI access
  vi.stubEnv('AI_ALLOWED_EMAILS', '');
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

/** A generated lesson with one exercise of each type. */
async function createLesson() {
  const version = await createLessonVersion(prisma, {
    userId,
    exercises: [
      {
        type: 'SHORT_ANSWER',
        prompt: 'Translate: Good morning',
        expectedAnswers: ['Buongiorno', 'Buon giorno'],
      },
      {
        type: 'FILL_IN_THE_BLANK',
        prompt: '___, Marco! (informal hello)',
        expectedAnswers: ['Ciao'],
      },
      {
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        expectedPoints: ['In the evening'],
      },
    ],
  });
  const [shortAnswer, fillInTheBlank, freeForm] = version.exercises;
  return { version, shortAnswer, fillInTheBlank, freeForm };
}

describe('exerciseRouter', () => {
  describe('submitAttempt', () => {
    it('confirms a correct short answer and stores the attempt, with no model call', async () => {
      const { version, shortAnswer } = await createLesson();

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buongiorno',
      });

      expect(result).toMatchObject({ evaluation: 'CORRECT' });
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({
          lessonVersionId: version.id,
          exerciseId: shortAnswer.id,
          answer: 'Buongiorno',
          evaluation: 'CORRECT',
          method: 'DETERMINISTIC',
        }),
      ]);
      expect(ai.requests).toHaveLength(0);
    });

    it.each([
      ['a different case and punctuation', 'buongiorno!'],
      ['extra whitespace', '  Buongiorno  '],
      ['any expected answer', 'buon giorno'],
      // Accent Mismatches reach exercises in #21
      ['wrong accents, ignored for now', 'Buòngiorno'],
    ])('accepts a short answer with %s', async (_, answer) => {
      const { shortAnswer } = await createLesson();

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer,
      });

      expect(result.evaluation).toBe('CORRECT');
    });

    it('marks a short answer that matches no expected answer incorrect', async () => {
      const { shortAnswer } = await createLesson();

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buonasera',
      });

      expect(result.evaluation).toBe('INCORRECT');
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({
          answer: 'Buonasera',
          evaluation: 'INCORRECT',
          method: 'DETERMINISTIC',
        }),
      ]);
      expect(ai.requests).toHaveLength(0);
    });

    it('keeps the spaces between words significant, as on cards', async () => {
      const { fillInTheBlank } = await createLesson();

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: fillInTheBlank.id,
        answer: 'Ci ao',
      });

      expect(result.evaluation).toBe('INCORRECT');
    });

    it.each([
      ['Ciao', 'CORRECT'],
      ['ciao', 'CORRECT'],
      ['Salve', 'INCORRECT'],
    ])(
      'checks a fill-in-the-blank answer %s as %s',
      async (answer, evaluation) => {
        const { fillInTheBlank } = await createLesson();

        const result = await createCaller().exercise.submitAttempt({
          exerciseId: fillInTheBlank.id,
          answer,
        });

        expect(result.evaluation).toBe(evaluation);
        expect(ai.requests).toHaveLength(0);
      },
    );

    it("doesn't take answers to free-form explanations yet", async () => {
      const { freeForm } = await createLesson();

      await expect(
        createCaller().exercise.submitAttempt({
          exerciseId: freeForm.id,
          answer: 'In the evening',
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
      expect(await prisma.exerciseAttempt.count()).toBe(0);
      expect(ai.requests).toHaveLength(0);
    });

    it('rejects a blank answer', async () => {
      const { shortAnswer } = await createLesson();

      await expect(
        createCaller().exercise.submitAttempt({
          exerciseId: shortAnswer.id,
          answer: '   ',
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
      expect(await prisma.exerciseAttempt.count()).toBe(0);
    });

    it("lets only the course's owner submit attempts", async () => {
      const { shortAnswer } = await createLesson();

      await expect(
        createCaller(otherUserId).exercise.submitAttempt({
          exerciseId: shortAnswer.id,
          answer: 'Buongiorno',
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(await prisma.exerciseAttempt.count()).toBe(0);
    });
  });

  describe('latest results on the lesson', () => {
    it("shows each exercise's latest attempt when the lesson is reopened", async () => {
      const { version, shortAnswer, fillInTheBlank } = await createLesson();
      const caller = createCaller();
      await caller.exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buonasera',
      });
      await caller.exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buongiorno',
      });

      const lesson = await caller.lesson.getById({ id: version.lessonId });

      expect(
        lesson.version?.exercises.map(({ id, latestAttempt }) => ({
          id,
          latestAttempt,
        })),
      ).toEqual([
        {
          id: shortAnswer.id,
          latestAttempt: expect.objectContaining({
            answer: 'Buongiorno',
            evaluation: 'CORRECT',
          }),
        },
        { id: fillInTheBlank.id, latestAttempt: null },
        { id: expect.any(String), latestAttempt: null },
      ]);
    });
  });
});
