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
import {
  createDeckWithCards,
  createTestPrisma,
  recordCardHistory,
} from './test-helpers.js';
import { appRouter } from './routers/index.js';
import { createFakeAiProvider } from './ai/fakeProvider.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;
let otherUserId: string;

const day = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * day);

beforeAll(() => {
  ({ prisma, cleanup } = createTestPrisma());
});

beforeEach(async () => {
  // Each test starts with two learners and nothing else
  await prisma.user.deleteMany();
  userId = (
    await prisma.user.create({
      data: { email: 'today@example.com', passwordHash: 'fakehash' },
    })
  ).id;
  otherUserId = (
    await prisma.user.create({
      data: { email: 'other@example.com', passwordHash: 'fakehash' },
    })
  ).id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await cleanup();
});

function createCaller(asUserId = userId) {
  return appRouter.createCaller({
    prisma,
    userId: asUserId,
    sessionToken: null,
    ai: createFakeAiProvider(),
  });
}

/** A deck of cards "Card 1" to "Card n", answered "A1" to "An". */
function deckOf(n: number, name: string, owner = userId) {
  return createDeckWithCards(prisma, {
    userId: owner,
    name,
    cards: Array.from({ length: n }, (_, i) => ({
      front: `Card ${i + 1}`,
      canonicalAnswers: [`A${i + 1}`],
    })),
  });
}

/** Makes a card due: answered once, long enough ago that it's due now. */
function makeDue(cardId: string) {
  return recordCardHistory(prisma, {
    userId,
    cardId,
    answers: [{ grade: 'MISSED', at: daysAgo(10) }],
  });
}

describe('today.get', () => {
  describe('Review', () => {
    it('lists each deck with cards due or new, with its cards and its due and new counts', async () => {
      const deck = await deckOf(3, 'Capitals');
      await makeDue(deck.cards[0].id);

      const { review } = await createCaller().today.get();

      expect(review.decks).toEqual([
        expect.objectContaining({
          id: deck.id,
          name: 'Capitals',
          cardCount: 3,
          dueCount: 1,
          newCount: 2,
        }),
      ]);
    });

    it('lists exactly the decks Flashcards lists that have cards due or new', async () => {
      const listed = await deckOf(1, 'Listed');
      const archived = await deckOf(1, 'Archived');
      await createCaller().deck.archive({ id: archived.id });
      const caughtUp = await deckOf(1, 'Caught up');
      // Answered a moment ago, so not due again yet
      await recordCardHistory(prisma, {
        userId,
        cardId: caughtUp.cards[0].id,
        answers: [{ grade: 'GOOD', at: new Date() }],
      });
      await deckOf(0, 'Empty');
      await deckOf(2, "Someone else's", otherUserId);

      const { review } = await createCaller().today.get();

      expect(review.decks.map((deck) => deck.id)).toEqual([listed.id]);
    });

    it('lists a Course Deck of an archived course until the deck itself is archived', async () => {
      const deck = await deckOf(1, 'Italian');
      const course = await createCourse({
        title: 'Italian',
        lessons: [{ title: 'Greetings' }],
      });
      await prisma.deck.update({
        where: { id: deck.id },
        data: { courseId: course.id },
      });
      await createCaller().course.archive({ courseId: course.id });

      expect(
        (await createCaller().today.get()).review.decks.map(({ id }) => id),
      ).toEqual([deck.id]);

      await createCaller().deck.archive({ id: deck.id });

      expect((await createCaller().today.get()).review.decks).toEqual([]);
    });

    it('leaves retired cards out', async () => {
      const deck = await deckOf(1, 'Mastered');
      await recordCardHistory(prisma, {
        userId,
        cardId: deck.cards[0].id,
        // Good, then Nailed five times, months apart: retirable, and due
        answers: [
          { at: daysAgo(400), grade: 'GOOD' },
          ...[399, 390, 370, 330, 240].map((days) => ({
            at: daysAgo(days),
            grade: 'NAILED' as const,
          })),
        ],
      });
      await createCaller().card.retire({ cardIds: [deck.cards[0].id] });

      expect((await createCaller().today.get()).review.decks).toEqual([]);
    });

    it('adds both Study Directions of a Reversible Deck together', async () => {
      const deck = await deckOf(2, 'Both ways');
      await createCaller().deck.update({ id: deck.id, reversible: true });
      await makeDue(deck.cards[0].id);
      await recordCardHistory(prisma, {
        userId,
        cardId: deck.cards[0].id,
        direction: 'REVERSE',
        answers: [{ grade: 'MISSED', at: daysAgo(10) }],
      });

      const [row] = (await createCaller().today.get()).review.decks;

      // Card 1 due both ways; Card 2 new both ways
      expect(row).toMatchObject({ dueCount: 2, newCount: 2 });
    });

    it('orders decks by most due, then most new, then name', async () => {
      const oneDue = await deckOf(1, 'One due');
      await makeDue(oneDue.cards[0].id);
      const twoDue = await deckOf(2, 'Two due');
      await makeDue(twoDue.cards[0].id);
      await makeDue(twoDue.cards[1].id);
      await deckOf(3, 'Three new');
      await deckOf(1, 'beta, one new');
      await deckOf(1, 'Alpha, one new');

      const { review } = await createCaller().today.get();

      expect(review.decks.map((deck) => deck.name)).toEqual([
        'Two due',
        'One due',
        'Three new',
        'Alpha, one new',
        'beta, one new',
      ]);
    });

    it('gives a deck its Cram Date while it has one', async () => {
      const deck = await deckOf(1, 'Exam');
      await createCaller().deck.update({
        id: deck.id,
        cramUntil: '2099-06-01',
      });
      await deckOf(1, 'No exam');

      const { review } = await createCaller().today.get();

      expect(
        review.decks.map(({ name, cramUntil }) => ({ name, cramUntil })),
      ).toEqual([
        { name: 'Exam', cramUntil: new Date('2099-06-01') },
        { name: 'No exam', cramUntil: null },
      ]);
    });

    it('labels a Course Deck with its course', async () => {
      const deck = await deckOf(1, 'Italian');
      const course = await createCourse({ title: 'Italian course' });
      await prisma.deck.update({
        where: { id: deck.id },
        data: { courseId: course.id },
      });

      const [row] = (await createCaller().today.get()).review.decks;

      expect(row.course).toEqual({ title: 'Italian course' });
    });

    it('says when the next card comes due, once none are due or new', async () => {
      expect((await createCaller().today.get()).review.nextDueAt).toBeNull();

      const deck = await deckOf(1, 'Caught up');
      await recordCardHistory(prisma, {
        userId,
        cardId: deck.cards[0].id,
        answers: [{ grade: 'GOOD', at: new Date() }],
      });
      const { dueAt } = await prisma.cardProgress.findFirstOrThrow({
        where: { cardId: deck.cards[0].id, direction: 'FORWARD' },
      });

      const { review } = await createCaller().today.get();

      expect(review.decks).toEqual([]);
      expect(review.nextDueAt).toEqual(dueAt);
    });

    it('counts only Forward on a deck studied one way', async () => {
      const deck = await deckOf(2, 'One way');
      await makeDue(deck.cards[0].id);

      const [row] = (await createCaller().today.get()).review.decks;

      expect(row).toMatchObject({ dueCount: 1, newCount: 1 });
    });
  });

  describe('Continue learning', () => {
    it("gives each course its next lesson: the first in syllabus order that isn't complete or archived", async () => {
      const course = await createCourse({
        title: 'Italian',
        lessons: [
          { title: 'Greetings', completedAt: daysAgo(3) },
          { title: 'Numbers', archived: true },
          { title: 'Food', openedAt: daysAgo(1), written: true },
          { title: 'Travel' },
        ],
      });

      const { continueLearning } = await createCaller().today.get();

      expect(continueLearning).toEqual([
        {
          id: course.id,
          title: 'Italian',
          goal: 'Learn Italian',
          deadline: null,
          next: {
            kind: 'LESSON',
            lesson: { id: course.lessons[2].id, title: 'Food', written: true },
          },
        },
      ]);
    });

    it('lists a course whose Syllabus Proposal is waiting, with its deadline', async () => {
      const course = await createCourse({
        title: 'Spanish',
        deadline: new Date('2099-03-01'),
        lessons: [{ title: 'Hola' }],
        waiting: true,
      });

      const { continueLearning } = await createCaller().today.get();

      expect(continueLearning).toEqual([
        {
          id: course.id,
          title: 'Spanish',
          goal: 'Learn Spanish',
          deadline: new Date('2099-03-01'),
          next: { kind: 'SYLLABUS_PROPOSAL' },
        },
      ]);
    });

    it('leaves out completed, archived and other learners’ courses', async () => {
      const listed = await createCourse({
        title: 'Listed',
        lessons: [{ title: 'One' }],
      });
      await createCourse({
        title: 'Complete',
        lessons: [{ title: 'One', completedAt: daysAgo(1) }],
      });
      await createCourse({
        title: 'Only archived lessons left',
        lessons: [
          { title: 'One', completedAt: daysAgo(1) },
          { title: 'Two', archived: true },
        ],
      });
      const archived = await createCourse({
        title: 'Archived',
        lessons: [{ title: 'One' }],
      });
      await createCaller().course.archive({ courseId: archived.id });
      await createCourse({
        title: "Someone else's",
        owner: otherUserId,
        lessons: [{ title: 'One' }],
      });

      const { continueLearning } = await createCaller().today.get();

      expect(continueLearning.map((course) => course.id)).toEqual([listed.id]);
    });

    it("orders courses by the learner's latest activity, newest first", async () => {
      const written = { written: true, openedAt: daysAgo(10) };
      const opened = await createCourse({
        title: 'Lesson opened 5 days ago',
        lessons: [{ title: 'One', openedAt: daysAgo(5) }],
        createdAt: daysAgo(20),
      });
      const completed = await createCourse({
        title: 'Lesson completed a day ago',
        lessons: [{ title: 'One', completedAt: daysAgo(1) }, { title: 'Two' }],
        createdAt: daysAgo(20),
      });
      const attempted = await createCourse({
        title: 'Exercise answered 2 days ago',
        lessons: [{ title: 'One', ...written }],
        createdAt: daysAgo(20),
      });
      await recordExerciseAttempt(
        attempted.lessons[0].versions[0].id,
        daysAgo(2),
      );
      const asked = await createCourse({
        title: 'Tutor asked 3 days ago',
        lessons: [{ title: 'One', ...written }],
        createdAt: daysAgo(20),
      });
      await recordTutorMessage(asked.lessons[0].versions[0].id, daysAgo(3));
      const created = await createCourse({
        title: 'Created 4 days ago',
        waiting: true,
        createdAt: daysAgo(4),
      });

      const { continueLearning } = await createCaller().today.get();

      expect(continueLearning.map((course) => course.id)).toEqual([
        completed.id,
        attempted.id,
        asked.id,
        created.id,
        opened.id,
      ]);
    });

    it("says whether AI is paused, as a lesson not yet written can't be written while it is, and needs no AI access", async () => {
      // Nobody can use AI
      vi.stubEnv('AI_ALLOWED_EMAILS', '');
      await createCourse({ title: 'Italian', lessons: [{ title: 'One' }] });

      vi.stubEnv('AI_MONTHLY_CAP_USD', '');
      expect((await createCaller().today.get()).aiPaused).toBe(true);

      vi.stubEnv('AI_MONTHLY_CAP_USD', '50');
      expect((await createCaller().today.get()).aiPaused).toBe(false);
    });
  });

  describe('the previews, for when a block is empty', () => {
    it('gives the decks Flashcards lists, most recently studied first, then newest', async () => {
      const older = await deckOf(1, 'Never studied, older');
      const newer = await deckOf(1, 'Never studied, newer');
      await prisma.deck.update({
        where: { id: older.id },
        data: { createdAt: daysAgo(30) },
      });
      const lastWeek = await deckOf(2, 'Studied last week');
      await recordCardHistory(prisma, {
        userId,
        cardId: lastWeek.cards[0].id,
        answers: [{ grade: 'GOOD', at: daysAgo(7) }],
      });
      const yesterday = await deckOf(1, 'Studied yesterday');
      await recordCardHistory(prisma, {
        userId,
        cardId: yesterday.cards[0].id,
        answers: [{ grade: 'GOOD', at: daysAgo(1) }],
      });
      const archived = await deckOf(1, 'Archived');
      await createCaller().deck.archive({ id: archived.id });
      await deckOf(1, "Someone else's", otherUserId);

      const { previews } = await createCaller().today.get();

      expect(previews.decks.map((deck) => deck.id)).toEqual([
        yesterday.id,
        lastWeek.id,
        newer.id,
        older.id,
      ]);
      expect(previews.decks[1]).toEqual({
        id: lastWeek.id,
        name: 'Studied last week',
        course: null,
        cardCount: 2,
      });
    });

    it('gives every active course, completed ones too, the one last active in first', async () => {
      const complete = await createCourse({
        title: 'Complete',
        lessons: [
          { title: 'One', completedAt: daysAgo(1) },
          { title: 'Two', completedAt: daysAgo(2) },
          { title: 'Three', archived: true },
        ],
        createdAt: daysAgo(20),
      });
      const waiting = await createCourse({
        title: 'Waiting',
        waiting: true,
        createdAt: daysAgo(3),
      });
      await createCourse({
        title: "Someone else's",
        owner: otherUserId,
        waiting: true,
      });

      const { previews } = await createCaller().today.get();

      expect(previews.courses).toEqual([
        {
          id: complete.id,
          title: 'Complete',
          goal: 'Learn Complete',
          syllabusAccepted: true,
          lessonCount: 2,
          completedLessonCount: 2,
        },
        {
          id: waiting.id,
          title: 'Waiting',
          goal: 'Learn Waiting',
          syllabusAccepted: false,
          lessonCount: 0,
          completedLessonCount: 0,
        },
      ]);
    });
  });
});

/** A lesson of a course's accepted Syllabus, as the learner has left it. */
type LessonSpec = {
  title: string;
  openedAt?: Date;
  completedAt?: Date;
  archived?: boolean;
  /** Generated: it has a Lesson Version. */
  written?: boolean;
};

/**
 * An active course of the learner's: its Syllabus accepted with the given
 * lessons, in order, or its Syllabus Proposal waiting.
 */
async function createCourse({
  title,
  owner = userId,
  deadline = null,
  lessons = [],
  waiting = false,
  createdAt,
}: {
  title: string;
  owner?: string;
  deadline?: Date | null;
  lessons?: LessonSpec[];
  waiting?: boolean;
  createdAt?: Date;
}) {
  const course = await prisma.course.create({
    data: {
      userId: owner,
      title,
      topic: title,
      goal: `Learn ${title}`,
      priorKnowledge: '',
      minutesPerWeek: 120,
      sessionMinutes: 30,
      depth: 'Balanced',
      notes: '',
      deadline,
      createdAt,
      proposal: {
        create: {
          lessons: lessons.map((lesson) => ({
            title: lesson.title,
            objectives: [],
          })),
          model: 'test-model',
          promptVersion: 'test',
          acceptedAt: waiting ? null : new Date(),
        },
      },
    },
  });
  // Accepting a proposal is what creates its lessons
  const created = [];
  for (const [position, lesson] of waiting ? [] : lessons.entries()) {
    created.push(
      await prisma.lesson.create({
        data: {
          courseId: course.id,
          title: lesson.title,
          position,
          objectives: [],
          firstOpenedAt: lesson.openedAt ?? lesson.completedAt,
          completedAt: lesson.completedAt,
          archivedAt: lesson.archived ? new Date() : null,
          versions: lesson.written
            ? {
                create: {
                  content: [],
                  examples: [],
                  summary: '',
                  model: 'test-model',
                  promptVersion: 'test',
                },
              }
            : undefined,
        },
        include: { versions: true },
      }),
    );
  }
  return { ...course, lessons: created };
}

/** An answer to a new exercise of a Lesson Version, given at a time. */
async function recordExerciseAttempt(lessonVersionId: string, at: Date) {
  const exercise = await prisma.exercise.create({
    data: {
      lessonVersionId,
      position: 0,
      type: 'SHORT_ANSWER',
      prompt: 'Say hello',
      expectedAnswers: ['ciao'],
    },
  });
  await prisma.exerciseAttempt.create({
    data: {
      lessonVersionId,
      exerciseId: exercise.id,
      answer: 'ciao',
      evaluation: 'CORRECT',
      method: 'DETERMINISTIC',
      createdAt: at,
    },
  });
}

/** The learner's question to the Tutor on a Lesson Version, at a time. */
async function recordTutorMessage(lessonVersionId: string, at: Date) {
  await prisma.tutorThread.create({
    data: {
      lessonVersionId,
      number: 1,
      messages: {
        create: { role: 'LEARNER', content: 'Why ciao?', createdAt: at },
      },
    },
  });
}
