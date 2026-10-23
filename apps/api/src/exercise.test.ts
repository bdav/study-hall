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

/** A generated lesson with just the given exercise. */
async function createLessonWith(
  exercise: Parameters<typeof createLessonVersion>[1]['exercises'][number],
) {
  const version = await createLessonVersion(prisma, {
    userId,
    exercises: [exercise],
  });
  return { version, exercise: version.exercises[0] };
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
    ])('accepts a short answer with %s', async (_, answer) => {
      const { shortAnswer } = await createLesson();

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer,
      });

      expect(result.evaluation).toBe('CORRECT');
    });

    it('accepts a short answer wrong only in its accents as an Accent Mismatch, corrected to the accented form', async () => {
      const { exercise } = await createLessonWith({
        type: 'SHORT_ANSWER',
        prompt: 'Translate: It is late',
        expectedAnswers: ['È tardi'],
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'e tardi',
      });

      expect(result).toMatchObject({
        evaluation: 'CORRECT',
        accentCorrection: 'È tardi',
      });
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({
          answer: 'e tardi',
          evaluation: 'CORRECT',
          accentCorrection: 'È tardi',
          method: 'DETERMINISTIC',
        }),
      ]);
      expect(ai.requests).toHaveLength(0);
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

    it('accepts a fill-in-the-blank answer wrong only in its accents as an Accent Mismatch, corrected to the accented form', async () => {
      const { exercise } = await createLessonWith({
        type: 'FILL_IN_THE_BLANK',
        prompt: 'Marco ___ stanco. (is)',
        expectedAnswers: ['è'],
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'e',
      });

      expect(result).toMatchObject({
        evaluation: 'CORRECT',
        accentCorrection: 'è',
      });
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({
          answer: 'e',
          evaluation: 'CORRECT',
          accentCorrection: 'è',
          method: 'DETERMINISTIC',
        }),
      ]);
      expect(ai.requests).toHaveLength(0);
    });

    it('needs no accent correction for an answer that exactly matches any expected answer', async () => {
      const { exercise } = await createLessonWith({
        type: 'SHORT_ANSWER',
        prompt: 'Translate: why',
        expectedAnswers: ['perché', 'perche'],
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'perche',
      });

      expect(result).toMatchObject({
        evaluation: 'CORRECT',
        accentCorrection: null,
      });
    });

    it('needs no accent correction for an exact match or a wrong answer', async () => {
      const { shortAnswer } = await createLesson();
      const caller = createCaller();

      const correct = await caller.exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buongiorno',
      });
      const incorrect = await caller.exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buonasera',
      });

      expect(correct.accentCorrection).toBeNull();
      expect(incorrect.accentCorrection).toBeNull();
    });

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

    it("shows an Accent Mismatch's correction when the lesson is reopened", async () => {
      const { version, exercise } = await createLessonWith({
        type: 'FILL_IN_THE_BLANK',
        prompt: 'Marco ___ stanco. (is)',
        expectedAnswers: ['è'],
      });
      const caller = createCaller();
      await caller.exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'e',
      });

      const lesson = await caller.lesson.getById({ id: version.lessonId });

      expect(lesson.version?.exercises[0].latestAttempt).toMatchObject({
        answer: 'e',
        evaluation: 'CORRECT',
        accentCorrection: 'è',
      });
    });
  });

  describe('answers', () => {
    it("reveals an exercise's expected answers once the learner has tried it", async () => {
      const { shortAnswer } = await createLesson();
      const caller = createCaller();
      await caller.exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buonasera',
      });

      const revealed = await caller.exercise.answers({
        exerciseId: shortAnswer.id,
      });

      expect(revealed).toEqual({
        expectedAnswers: ['Buongiorno', 'Buon giorno'],
      });
      expect(ai.requests).toHaveLength(0);
    });

    it('keeps the answers hidden until the learner has tried the exercise', async () => {
      const { shortAnswer } = await createLesson();

      await expect(
        createCaller().exercise.answers({ exerciseId: shortAnswer.id }),
      ).rejects.toThrow(
        expect.objectContaining({ code: 'PRECONDITION_FAILED' }),
      );
    });

    it("reveals answers only to the course's owner", async () => {
      const { shortAnswer } = await createLesson();
      await createCaller().exercise.submitAttempt({
        exerciseId: shortAnswer.id,
        answer: 'Buonasera',
      });

      await expect(
        createCaller(otherUserId).exercise.answers({
          exerciseId: shortAnswer.id,
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });
  });
});
