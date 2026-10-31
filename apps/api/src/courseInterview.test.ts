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
import { type InterviewQuestion } from './ai/courseInterview.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;
let userId: string;

const ai = createFakeAiProvider();

const opening = 'Italian, because I go to Rome in June and want to get by';

/** A draft Course Setup as the model gives one. */
const draft = {
  title: 'Italian for a trip to Rome',
  topic: 'Italian',
  goal: 'Get by on a trip to Rome in June',
  priorKnowledge: '',
  canAlreadyDo: [],
  minutesPerWeek: null,
  sessionMinutes: null,
  deadline: '2027-06-01',
  depth: 'Balanced',
  focus: 'Speaking',
  skip: '',
  materials: '',
  notes: '',
};

const firstQuestions: InterviewQuestion[] = [
  {
    type: 'SINGLE_CHOICE',
    prompt: 'How much time a week can you give it?',
    options: ['1 hour', '2 hours', '3 hours'],
    suggested: '2 hours',
  },
  {
    type: 'FREE_TEXT',
    prompt: 'What Italian do you know already?',
    suggested: 'None',
  },
];

const secondQuestions: InterviewQuestion[] = [
  {
    type: 'SINGLE_CHOICE',
    prompt: 'How long is a sitting?',
    options: ['15 minutes', '30 minutes'],
    suggested: '30 minutes',
  },
  {
    type: 'FREE_TEXT',
    prompt: 'Anything to leave out?',
    suggested: '',
  },
];

/** A round the learner has answered with the suggested answers. */
function answered(questions: InterviewQuestion[]) {
  return {
    questions,
    answers: questions.map((q) => ('suggested' in q ? q.suggested : [])),
  };
}

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;

  const user = await prisma.user.create({
    data: { email: 'interview-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;
});

beforeEach(async () => {
  await prisma.course.deleteMany({});
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.stubEnv('AI_ALLOWED_EMAILS', 'interview-test@example.com');
  vi.stubEnv('AI_MONTHLY_CAP_USD', '100');
  // Monday 2 November 2026
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

function createCaller() {
  return appRouter.createCaller({ prisma, userId, sessionToken: null, ai });
}

describe('course.interviewRound', () => {
  it("asks the first round from the learner's opening words, with today's date", async () => {
    ai.respondWith({ draft, ready: false, questions: firstQuestions });

    const round = await createCaller().course.interviewRound({
      opening,
      rounds: [],
    });

    expect(round).toEqual({
      draft,
      ready: false,
      questions: firstQuestions,
      model: 'claude-sonnet-5-5',
      promptVersion: expect.stringMatching(/^course-interview-v\d+$/),
    });
    const { model, prompt } = ai.requests[0];
    expect(model).toBe('claude-sonnet-5-5');
    expect(prompt).toContain(opening);
    expect(prompt).toContain('2026-11-02');
  });

  it("sends every earlier round's questions and answers, oldest first", async () => {
    ai.respondWith({ draft, ready: false, questions: secondQuestions });

    await createCaller().course.interviewRound({
      opening,
      rounds: [
        {
          questions: firstQuestions,
          answers: ['3 hours', 'A few words from Duolingo'],
        },
      ],
    });

    const { prompt } = ai.requests[0];
    expect(prompt).toContain(opening);
    expect(prompt).toContain('How much time a week can you give it?');
    expect(prompt).toContain('3 hours');
    expect(prompt).toContain('A few words from Duolingo');
  });

  it('says when nothing is left to ask', async () => {
    ai.respondWith({ draft, ready: true, questions: [] });

    const round = await createCaller().course.interviewRound({
      opening,
      rounds: [answered(firstQuestions)],
    });

    expect(round).toMatchObject({ draft, ready: true, questions: [] });
  });

  it('ends after three rounds whatever the model returns', async () => {
    ai.respondWith({ draft, ready: false, questions: secondQuestions });

    const round = await createCaller().course.interviewRound({
      opening,
      rounds: [
        answered(firstQuestions),
        answered(secondQuestions),
        answered(firstQuestions),
      ],
    });

    expect(round).toMatchObject({ draft, ready: true, questions: [] });
    expect(ai.requests[0].prompt).toMatch(/no rounds are left/i);
  });

  it('asks for a date with a date question, a blank answer meaning none', async () => {
    const dateQuestion: InterviewQuestion = {
      type: 'DATE',
      prompt: 'Is there a date you need to be ready by?',
      suggested: '',
    };
    ai.respondWith({
      draft,
      ready: false,
      questions: [dateQuestion, firstQuestions[1]],
    });

    const first = await createCaller().course.interviewRound({
      opening,
      rounds: [],
    });
    expect(first.questions[0]).toEqual(dateQuestion);

    ai.respondWith({ draft, ready: true, questions: [] });
    await createCaller().course.interviewRound({
      opening,
      rounds: [
        { questions: [dateQuestion, firstQuestions[1]], answers: ['', 'None'] },
      ],
    });
    expect(ai.requests[1].prompt).toMatch(
      /Is there a date you need to be ready by\?\n\s+Answer: <answer>No date<\/answer>/,
    );
  });

  it('refuses a date answer that is not a date, without calling the model', async () => {
    await expect(
      createCaller().course.interviewRound({
        opening,
        rounds: [
          {
            questions: [
              { type: 'DATE', prompt: 'When is your exam?', suggested: '' },
            ],
            answers: ['next summer'],
          },
        ],
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(ai.requests).toHaveLength(0);
  });

  describe('multiple choice, the placement checklist and Something else', () => {
    const focusQuestion: InterviewQuestion = {
      type: 'MULTIPLE_CHOICE',
      prompt: 'What do you want to be able to do?',
      options: ['Order food', 'Ask directions', 'Small talk'],
      suggested: ['Order food', 'Ask directions'],
    };
    const placement: InterviewQuestion = {
      type: 'PLACEMENT',
      prompt: 'Which of these can you already do?',
      options: [
        'Greet someone',
        'Count to ten',
        'Order a coffee',
        'Say where you are from',
        'Ask the time',
      ],
    };

    it('asks multiple-choice questions and the placement checklist', async () => {
      ai.respondWith({
        draft,
        ready: false,
        questions: [focusQuestion, placement],
      });

      const round = await createCaller().course.interviewRound({
        opening,
        rounds: [],
      });

      expect(round.questions).toEqual([focusQuestion, placement]);
    });

    it('offers suggested answers the options leave out', async () => {
      ai.respondWith({
        draft,
        ready: false,
        questions: [
          { ...focusQuestion, suggested: ['Order food', 'Read menus'] },
          firstQuestions[1],
        ],
      });

      const round = await createCaller().course.interviewRound({
        opening,
        rounds: [],
      });

      expect(round.questions[0]).toMatchObject({
        options: ['Read menus', 'Order food', 'Ask directions', 'Small talk'],
      });
    });

    it("sends chosen chips, ticked items and typed answers back, typed ones as the learner's own words", async () => {
      ai.respondWith({ draft, ready: true, questions: [] });

      await createCaller().course.interviewRound({
        opening,
        rounds: [
          {
            questions: [focusQuestion, placement, firstQuestions[0]],
            answers: [
              ['Order food', 'Small talk'],
              ['Greet someone', 'Count to ten'],
              'Whatever my weekends allow',
            ],
          },
        ],
      });

      const { prompt } = ai.requests[0];
      expect(prompt).toContain('Order food; Small talk');
      expect(prompt).toContain('Ticked: <answer>Greet someone; Count to ten');
      expect(prompt).toMatch(
        /own words[^\n]*\n?[^\n]*Whatever my weekends allow/,
      );
    });

    it("adds ticked placement items to the draft's can already do list", async () => {
      ai.respondWith({
        draft: { ...draft, canAlreadyDo: ['Count to ten', 'Read a menu'] },
        ready: false,
        questions: firstQuestions,
      });

      const round = await createCaller().course.interviewRound({
        opening,
        rounds: [
          {
            questions: [placement, firstQuestions[1]],
            answers: [['Greet someone', 'Count to ten'], 'None'],
          },
        ],
      });

      expect(round.draft.canAlreadyDo).toEqual([
        'Count to ten',
        'Read a menu',
        'Greet someone',
      ]);
    });

    it('leaves out of can already do what the learner left unticked', async () => {
      ai.respondWith({
        draft: { ...draft, canAlreadyDo: ['Order a coffee', 'Read a menu'] },
        ready: true,
        questions: [],
      });

      const round = await createCaller().course.interviewRound({
        opening,
        rounds: [
          {
            questions: [placement, firstQuestions[1]],
            answers: [['Greet someone'], 'None'],
          },
        ],
      });

      // Order a coffee was on the checklist and left unticked
      expect(round.draft.canAlreadyDo).toEqual([
        'Read a menu',
        'Greet someone',
      ]);
    });

    it('keeps chosen chips, ticked items and typed answers in the transcript', async () => {
      const caller = createCaller();
      ai.respondWith({
        lessons: [{ title: 'Greetings', objectives: ['Say hello'] }],
      });
      const interview = {
        opening,
        rounds: [
          {
            questions: [focusQuestion, placement, firstQuestions[0]],
            answers: [
              ['Order food'],
              ['Greet someone', 'Count to ten'],
              'Whatever my weekends allow',
            ],
          },
        ],
        model: 'claude-sonnet-5-5',
        promptVersion: 'course-interview-v3',
      };

      const { id } = await caller.course.create({
        title: 'Italian',
        topic: 'Italian',
        goal: 'Get by in Rome',
        minutesPerWeek: 120,
        sessionMinutes: 30,
        depth: 'Balanced',
        interview,
      });

      const course = await prisma.course.findUniqueOrThrow({ where: { id } });
      expect(course.interview).toEqual(interview);
    });

    it.each([
      ['a chip the question did not offer', [focusQuestion], [['Swim']]],
      ['a typed placement answer', [placement], ['I can do all of it']],
      ['a list for a free-text question', [firstQuestions[1]], [['None']]],
    ])(
      'refuses %s, without calling the model',
      async (_, questions, answers) => {
        await expect(
          createCaller().course.interviewRound({
            opening,
            rounds: [{ questions, answers }],
          }),
        ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
        expect(ai.requests).toHaveLength(0);
      },
    );
  });

  it('offers a suggested answer among its options', async () => {
    ai.respondWith({
      draft,
      ready: false,
      questions: [
        { ...firstQuestions[0], suggested: '4 hours' },
        firstQuestions[1],
      ],
    });

    const round = await createCaller().course.interviewRound({
      opening,
      rounds: [],
    });

    expect(round.questions[0]).toMatchObject({
      options: ['4 hours', '1 hour', '2 hours', '3 hours'],
      suggested: '4 hours',
    });
  });

  it('snaps a drafted session length to the nearest one the form offers', async () => {
    ai.respondWith({
      draft: { ...draft, sessionMinutes: 40 },
      ready: false,
      questions: firstQuestions,
    });

    const round = await createCaller().course.interviewRound({
      opening,
      rounds: [],
    });

    expect(round.draft.sessionMinutes).toBe(45);
  });

  it('reads a blank deadline and no minutes in the draft as not given', async () => {
    ai.respondWith({
      draft: { ...draft, deadline: '', minutesPerWeek: 0, sessionMinutes: 0 },
      ready: false,
      questions: firstQuestions,
    });

    const round = await createCaller().course.interviewRound({
      opening,
      rounds: [],
    });

    expect(round.draft).toMatchObject({
      deadline: null,
      minutesPerWeek: null,
      sessionMinutes: null,
    });
  });

  it('records its AI usage as a Setup Interview call', async () => {
    ai.respondWith(
      { draft, ready: false, questions: firstQuestions },
      { inputTokens: 900, outputTokens: 400 },
    );

    await createCaller().course.interviewRound({ opening, rounds: [] });

    expect(await prisma.aiUsage.findMany()).toEqual([
      expect.objectContaining({
        userId,
        purpose: 'COURSE_INTERVIEW',
        model: 'claude-sonnet-5-5',
        inputTokens: 900,
        outputTokens: 400,
      }),
    ]);
  });

  it('refuses a learner without AI access, without calling the model', async () => {
    vi.stubEnv('AI_ALLOWED_EMAILS', 'someone-else@example.com');

    await expect(
      createCaller().course.interviewRound({ opening, rounds: [] }),
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(ai.requests).toHaveLength(0);
  });

  it('refuses while AI is paused, without calling the model', async () => {
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
      createCaller().course.interviewRound({ opening, rounds: [] }),
    ).rejects.toThrow(expect.objectContaining({ code: 'TOO_MANY_REQUESTS' }));
    expect(ai.requests).toHaveLength(0);
  });

  it('treats a failed call as a retryable error', async () => {
    ai.failWith('api-error');

    await expect(
      createCaller().course.interviewRound({ opening, rounds: [] }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'BAD_GATEWAY',
        message: expect.stringMatching(/try again/i),
      }),
    );
  });

  it.each([
    ['no opening words', { opening: '  ', rounds: [] }],
    [
      'more than three rounds',
      {
        opening,
        rounds: [
          answered(firstQuestions),
          answered(firstQuestions),
          answered(firstQuestions),
          answered(firstQuestions),
        ],
      },
    ],
    [
      'a round with an answer missing',
      {
        opening,
        rounds: [{ questions: firstQuestions, answers: ['2 hours'] }],
      },
    ],
  ])('refuses %s, without calling the model', async (_, input) => {
    await expect(
      createCaller().course.interviewRound(
        input as Parameters<
          ReturnType<typeof createCaller>['course']['interviewRound']
        >[0],
      ),
    ).rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(ai.requests).toHaveLength(0);
  });
});

describe('creating a course after a Setup Interview', () => {
  const setup = {
    title: 'Italian for a trip to Rome',
    topic: 'Italian',
    goal: 'Get by on a trip to Rome in June',
    minutesPerWeek: 120,
    sessionMinutes: 30,
    depth: 'Balanced',
  };
  const syllabus = {
    lessons: [{ title: 'Greetings', objectives: ['Say hello'] }],
  };

  it('stores the transcript with the model and prompt version that asked it', async () => {
    const caller = createCaller();
    ai.respondWith(syllabus);
    const interview = {
      opening,
      rounds: [answered(firstQuestions)],
      model: 'claude-sonnet-5-5',
      promptVersion: 'course-interview-v0',
    };

    const { id } = await caller.course.create({ ...setup, interview });

    const course = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(course.interview).toEqual(interview);
  });

  it('generates the syllabus from the Course Setup alone, never the transcript', async () => {
    ai.respondWith(syllabus);

    await createCaller().course.create({
      ...setup,
      interview: {
        opening,
        rounds: [answered(firstQuestions)],
        model: 'claude-sonnet-5-5',
        promptVersion: 'course-interview-v1',
      },
    });

    expect(ai.requests[0].prompt).not.toContain(opening);
    expect(ai.requests[0].prompt).not.toContain(firstQuestions[0].prompt);
  });

  it('stores no transcript for a course set up without an interview', async () => {
    ai.respondWith(syllabus);

    const { id } = await createCaller().course.create(setup);

    const course = await prisma.course.findUniqueOrThrow({ where: { id } });
    expect(course.interview).toBeNull();
  });
});
