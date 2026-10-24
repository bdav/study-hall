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
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  // Deterministic checks need no AI access
  vi.stubEnv('AI_ALLOWED_EMAILS', '');
  vi.stubEnv('AI_MONTHLY_CAP_USD', '100');
});

/** Gives the learner AI access, which evaluating an open answer needs. */
function allowAI() {
  vi.stubEnv('AI_ALLOWED_EMAILS', 'exercise-test@example.com');
}

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

    it('rejects an answer too long to be an answer, before any model call', async () => {
      allowAI();
      const { freeForm } = await createLesson();

      await expect(
        createCaller().exercise.submitAttempt({
          exerciseId: freeForm.id,
          answer: 'a'.repeat(2001),
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
      expect(ai.requests).toHaveLength(0);
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

  describe('AI evaluation', () => {
    it('evaluates a free-form explanation with the model against its expected points, and stores the feedback', async () => {
      allowAI();
      const { version, freeForm } = await createLesson();
      ai.respondWith({
        evaluation: 'CORRECT',
        feedback: 'Yes: buonasera is an evening greeting.',
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: freeForm.id,
        answer: 'When you meet someone in the evening',
      });

      expect(result).toMatchObject({
        evaluation: 'CORRECT',
        feedback: 'Yes: buonasera is an evening greeting.',
        accentCorrection: null,
      });
      expect(ai.requests).toEqual([
        expect.objectContaining({
          model: 'claude-haiku-5-5',
          prompt: expect.stringContaining('- In the evening'),
        }),
      ]);
      expect(ai.requests[0].prompt).toContain(
        'When you meet someone in the evening',
      );
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({
          lessonVersionId: version.id,
          exerciseId: freeForm.id,
          answer: 'When you meet someone in the evening',
          evaluation: 'CORRECT',
          method: 'LLM',
          feedback: 'Yes: buonasera is an evening greeting.',
        }),
      ]);
    });

    /** A lesson with one open short answer, as generation marks it. */
    function createOpenShortAnswer() {
      return createLessonWith({
        type: 'SHORT_ANSWER',
        prompt: 'Translate: How are you?',
        expectedAnswers: ['Come stai?'],
        open: true,
      });
    }

    it('evaluates an answer to an open short answer that matches no expected answer with the model', async () => {
      allowAI();
      const { exercise } = await createOpenShortAnswer();
      ai.respondWith({
        evaluation: 'CORRECT',
        feedback: '"Come va?" is a natural way to ask.',
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'Come va?',
      });

      expect(result).toMatchObject({
        evaluation: 'CORRECT',
        feedback: '"Come va?" is a natural way to ask.',
      });
      expect(ai.requests).toHaveLength(1);
      expect(ai.requests[0].prompt).toContain('- Come stai?');
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({ evaluation: 'CORRECT', method: 'LLM' }),
      ]);
    });

    it('stores an incorrect evaluation from the model with its feedback', async () => {
      allowAI();
      const { exercise } = await createOpenShortAnswer();
      ai.respondWith({
        evaluation: 'INCORRECT',
        feedback: 'That asks where someone is, not how they are.',
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'Dove sei?',
      });

      expect(result).toMatchObject({
        evaluation: 'INCORRECT',
        feedback: 'That asks where someone is, not how they are.',
      });
      expect(await prisma.exerciseAttempt.findMany()).toEqual([
        expect.objectContaining({
          evaluation: 'INCORRECT',
          method: 'LLM',
          feedback: 'That asks where someone is, not how they are.',
        }),
      ]);
    });

    it.each([
      ['an exact match', 'Come stai?'],
      ['an Accent Mismatch', 'Còme stai?'],
    ])(
      'settles %s to an open short answer without the model',
      async (_, answer) => {
        allowAI();
        const { exercise } = await createOpenShortAnswer();

        const result = await createCaller().exercise.submitAttempt({
          exerciseId: exercise.id,
          answer,
        });

        expect(result).toMatchObject({ evaluation: 'CORRECT', feedback: null });
        expect(ai.requests).toHaveLength(0);
        expect(await prisma.exerciseAttempt.findMany()).toEqual([
          expect.objectContaining({ method: 'DETERMINISTIC' }),
        ]);
      },
    );

    it('settles a wrong answer to a closed short answer without the model, even with AI access', async () => {
      allowAI();
      const { exercise } = await createLessonWith({
        type: 'SHORT_ANSWER',
        prompt: 'What is the capital of Australia?',
        expectedAnswers: ['Canberra'],
        open: false,
      });

      const result = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'Sydney',
      });

      expect(result).toMatchObject({ evaluation: 'INCORRECT', feedback: null });
      expect(ai.requests).toHaveLength(0);
      expect(await prisma.aiUsage.count()).toBe(0);
    });

    it('records the AI usage of an evaluation', async () => {
      allowAI();
      const { exercise } = await createOpenShortAnswer();
      ai.respondWith(
        { evaluation: 'CORRECT', feedback: 'Right.' },
        { inputTokens: 300, outputTokens: 40 },
      );

      await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'Come va?',
      });

      expect(await prisma.aiUsage.findMany()).toEqual([
        expect.objectContaining({
          userId,
          purpose: 'EXERCISE_EVALUATION',
          model: 'claude-haiku-5-5',
          inputTokens: 300,
          outputTokens: 40,
        }),
      ]);
    });

    it('refuses an answer that needs the model without AI access, storing nothing', async () => {
      const { exercise } = await createOpenShortAnswer();

      await expect(
        createCaller().exercise.submitAttempt({
          exerciseId: exercise.id,
          answer: 'Come va?',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'FORBIDDEN',
          message: expect.stringMatching(/needs AI/),
        }),
      );
      expect(ai.requests).toHaveLength(0);
      expect(await prisma.exerciseAttempt.count()).toBe(0);
    });

    it('refuses an answer that needs the model once the spending cap is reached', async () => {
      allowAI();
      vi.stubEnv('AI_MONTHLY_CAP_USD', '0.0001');
      await prisma.aiUsage.create({
        data: {
          userId,
          purpose: 'LESSON_GENERATION',
          model: 'claude-sonnet-5-5',
          inputTokens: 1000,
          outputTokens: 1000,
        },
      });
      const { exercise } = await createOpenShortAnswer();

      await expect(
        createCaller().exercise.submitAttempt({
          exerciseId: exercise.id,
          answer: 'Come va?',
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }));
      expect(ai.requests).toHaveLength(0);
      expect(await prisma.exerciseAttempt.count()).toBe(0);
    });

    it('stores no attempt when the model output is invalid, and the learner can retry', async () => {
      allowAI();
      const { exercise } = await createOpenShortAnswer();
      ai.respondWith({ evaluation: 'PARTIAL', feedback: 'Close.' });

      await expect(
        createCaller().exercise.submitAttempt({
          exerciseId: exercise.id,
          answer: 'Come va?',
        }),
      ).rejects.toThrow(expect.objectContaining({ code: 'BAD_GATEWAY' }));
      expect(await prisma.exerciseAttempt.count()).toBe(0);
      expect(await prisma.aiUsage.count()).toBe(1);

      ai.respondWith({ evaluation: 'CORRECT', feedback: 'Right.' });
      const retried = await createCaller().exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'Come va?',
      });
      expect(retried.evaluation).toBe('CORRECT');
    });

    it('shows the feedback when the lesson is reopened', async () => {
      allowAI();
      const { version, exercise } = await createOpenShortAnswer();
      ai.respondWith({ evaluation: 'CORRECT', feedback: 'Right.' });
      const caller = createCaller();
      await caller.exercise.submitAttempt({
        exerciseId: exercise.id,
        answer: 'Come va?',
      });

      const lesson = await caller.lesson.getById({ id: version.lessonId });

      expect(lesson.version?.exercises[0].latestAttempt).toMatchObject({
        evaluation: 'CORRECT',
        feedback: 'Right.',
      });
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
        expectedPoints: [],
      });
      expect(ai.requests).toHaveLength(0);
    });

    it("reveals a free-form explanation's expected points once the learner has tried it", async () => {
      allowAI();
      const { freeForm } = await createLesson();
      const caller = createCaller();
      ai.respondWith({ evaluation: 'INCORRECT', feedback: 'Think of when.' });
      await caller.exercise.submitAttempt({
        exerciseId: freeForm.id,
        answer: 'To say goodbye',
      });

      const revealed = await caller.exercise.answers({
        exerciseId: freeForm.id,
      });

      expect(revealed).toEqual({
        expectedAnswers: [],
        expectedPoints: ['In the evening'],
      });
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
