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
import { TUTOR_MODEL } from './ai/tutor.js';

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
  notes: '',
};

const syllabus = {
  lessons: [
    { title: 'Greetings', objectives: ['Greet someone formally'] },
    { title: 'At the café', objectives: ['Order food and drinks'] },
  ],
};

const lessonOutput = {
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
  ],
  summary: 'Taught ciao and buongiorno.',
};

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  userId = (
    await prisma.user.create({
      data: { email: 'tutor-test@example.com', passwordHash: 'fakehash' },
    })
  ).id;
  otherUserId = (
    await prisma.user.create({
      data: { email: 'other-tutor@example.com', passwordHash: 'fakehash' },
    })
  ).id;
});

beforeEach(async () => {
  await prisma.course.deleteMany({});
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.stubEnv(
    'AI_ALLOWED_EMAILS',
    'tutor-test@example.com, other-tutor@example.com',
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

/** A course with an accepted syllabus whose first lesson has been written. */
async function createWrittenLesson() {
  const caller = createCaller();
  ai.respondWith(syllabus);
  const { id } = await caller.course.create(courseForm);
  await caller.course.acceptProposal({ courseId: id });
  const [lesson] = (await caller.course.getById({ id })).lessons;
  ai.respondWith(lessonOutput);
  await caller.lesson.generate({ id: lesson.id });
  ai.reset();
  return lesson;
}

/** Asks the tutor and reads the whole streamed reply, piece by piece. */
async function ask(lessonId: string, message: string, caller = createCaller()) {
  const pieces: string[] = [];
  for await (const piece of await caller.tutor.ask({ lessonId, message })) {
    pieces.push(piece);
  }
  return pieces;
}

describe('tutorRouter', () => {
  describe('ask', () => {
    it('streams the reply in pieces, and the thread then holds both messages', async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['What do ', 'you think ', 'it means?']);

      const pieces = await ask(lesson.id, 'What does ciao mean?');

      expect(pieces).toEqual(['What do ', 'you think ', 'it means?']);
      const { messages } = await createCaller().tutor.thread({
        lessonId: lesson.id,
      });
      expect(messages).toMatchObject([
        { role: 'LEARNER', content: 'What does ciao mean?' },
        { role: 'TUTOR', content: 'What do you think it means?' },
      ]);
    });

    it('sends the tutor the thread so far with the new message, and the lesson', async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['What do you think it means?']);
      await ask(lesson.id, 'What does ciao mean?');
      ai.streamReply(['Close: it is informal.']);

      await ask(lesson.id, 'Hello?');

      const request = ai.chatRequests[1];
      expect(request.model).toBe(TUTOR_MODEL);
      expect(request.messages).toEqual([
        { role: 'user', content: 'What does ciao mean?' },
        { role: 'assistant', content: 'What do you think it means?' },
        { role: 'user', content: 'Hello?' },
      ]);
      const lessonBlock = request.system.find((block) => block.cache);
      expect(lessonBlock?.text).toContain(
        'Italian has a formal and an informal hello.',
      );
    });

    it('writes an AI usage record for the reply', async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['Ciao!'], {
        usage: { inputTokens: 1500, outputTokens: 40 },
      });

      await ask(lesson.id, 'Hi');

      const usage = await createCaller().aiUsage.report();
      expect(usage.breakdown).toContainEqual(
        expect.objectContaining({
          purpose: 'TUTOR',
          model: TUTOR_MODEL,
          calls: 1,
          inputTokens: 1500,
          outputTokens: 40,
        }),
      );
    });

    it('starts a fresh thread for a new Lesson Version, leaving the old one with its version', async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['Ciao!']);
      await ask(lesson.id, 'Hi');
      const [oldVersion] = await prisma.lessonVersion.findMany({
        where: { lessonId: lesson.id },
      });
      // As regenerating the lesson would
      await prisma.lessonVersion.create({
        data: {
          lessonId: lesson.id,
          content: lessonOutput.content,
          examples: lessonOutput.examples,
          summary: lessonOutput.summary,
          model: 'claude-sonnet-5-5',
          promptVersion: 'lesson-v3',
        },
      });
      const caller = createCaller();

      expect(
        (await caller.tutor.thread({ lessonId: lesson.id })).messages,
      ).toEqual([]);

      ai.streamReply(['Buongiorno!']);
      await ask(lesson.id, 'Good morning?');

      expect(ai.chatRequests[1].messages).toEqual([
        { role: 'user', content: 'Good morning?' },
      ]);
      expect(
        (await caller.tutor.thread({ lessonId: lesson.id })).messages,
      ).toMatchObject([
        { role: 'LEARNER', content: 'Good morning?' },
        { role: 'TUTOR', content: 'Buongiorno!' },
      ]);
      const oldThread = await prisma.tutorThread.findUniqueOrThrow({
        where: { lessonVersionId: oldVersion.id },
        include: { messages: true },
      });
      expect(oldThread.messages).toHaveLength(2);
    });

    it('stores nothing when the reply fails partway, and counts the call toward the cap', async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['What do '], {
        failAfter: 'connection-error',
        usage: { inputTokens: 1500, outputTokens: 8000 },
      });

      await expect(
        ask(lesson.id, 'What does ciao mean?'),
      ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });

      const { messages } = await createCaller().tutor.thread({
        lessonId: lesson.id,
      });
      expect(messages).toEqual([]);
      const usage = await createCaller().aiUsage.report();
      expect(usage.breakdown).toContainEqual(
        expect.objectContaining({ purpose: 'TUTOR', calls: 1 }),
      );
    });

    it('stores nothing when the API refuses the call', async () => {
      const lesson = await createWrittenLesson();
      ai.failWith('api-error');

      await expect(ask(lesson.id, 'Hi')).rejects.toMatchObject({
        code: 'BAD_GATEWAY',
      });

      const { messages } = await createCaller().tutor.thread({
        lessonId: lesson.id,
      });
      expect(messages).toEqual([]);
    });

    it("doesn't keep a reply the model declined to finish", async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['Well, '], { refused: true });

      await expect(ask(lesson.id, 'Hi')).rejects.toMatchObject({
        code: 'BAD_GATEWAY',
      });

      const { messages } = await createCaller().tutor.thread({
        lessonId: lesson.id,
      });
      expect(messages).toEqual([]);
    });

    it('finishes and stores the reply when the learner stops reading partway', async () => {
      const lesson = await createWrittenLesson();
      const caller = createCaller();
      ai.streamReply(['What do ', 'you think ', 'it means?']);

      for await (const piece of await caller.tutor.ask({
        lessonId: lesson.id,
        message: 'What does ciao mean?',
      })) {
        expect(piece).toBe('What do ');
        break;
      }

      await vi.waitFor(async () => {
        const { messages } = await caller.tutor.thread({
          lessonId: lesson.id,
        });
        expect(messages).toMatchObject([
          { role: 'LEARNER' },
          { role: 'TUTOR', content: 'What do you think it means?' },
        ]);
      });
    });

    it('refuses a lesson that has not been written', async () => {
      const caller = createCaller();
      ai.respondWith(syllabus);
      const { id } = await caller.course.create(courseForm);
      await caller.course.acceptProposal({ courseId: id });
      const [lesson] = (await caller.course.getById({ id })).lessons;

      await expect(ask(lesson.id, 'Hi')).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    });

    it('needs AI access, and makes no model call without it', async () => {
      const lesson = await createWrittenLesson();
      vi.stubEnv('AI_ALLOWED_EMAILS', 'other-tutor@example.com');

      await expect(ask(lesson.id, 'Hi')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(ai.chatRequests).toHaveLength(0);
    });

    it('makes no model call while AI is paused', async () => {
      const lesson = await createWrittenLesson();
      vi.stubEnv('AI_MONTHLY_CAP_USD', '0');

      await expect(ask(lesson.id, 'Hi')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
      expect(ai.chatRequests).toHaveLength(0);
    });
  });

  describe('ownership', () => {
    it("only lets the course's owner read or add to a thread", async () => {
      const lesson = await createWrittenLesson();
      ai.streamReply(['Ciao!']);
      await ask(lesson.id, 'Hi');
      const other = createCaller(otherUserId);

      await expect(
        other.tutor.thread({ lessonId: lesson.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(ask(lesson.id, 'Hi', other)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(ai.chatRequests).toHaveLength(1);
    });
  });
});
