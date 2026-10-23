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
import { type AiPurpose, type PrismaClient } from '@prisma/client';
import { createTestPrisma } from './test-helpers.js';
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
    data: { email: 'usage-test@example.com', passwordHash: 'fakehash' },
  });
  userId = user.id;

  const otherUser = await prisma.user.create({
    data: { email: 'other-usage@example.com', passwordHash: 'fakehash' },
  });
  otherUserId = otherUser.id;
});

beforeEach(async () => {
  await prisma.aiUsage.deleteMany({});
  ai.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  vi.stubEnv('AI_ALLOWED_EMAILS', 'usage-test@example.com');
  vi.stubEnv('AI_MONTHLY_CAP_USD', '10');
});

afterEach(() => {
  vi.useRealTimers();
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

/** Records one model call; Sonnet 5.5 costs $2 in and $10 out per million tokens. */
async function recordCall({
  by = userId,
  at = new Date('2026-10-10T12:00:00Z'),
  purpose = 'SYLLABUS_GENERATION',
  model = 'claude-sonnet-5-5',
  inputTokens = 0,
  outputTokens = 0,
  failed = false,
}: {
  by?: string;
  at?: Date;
  purpose?: AiPurpose;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  failed?: boolean;
} = {}) {
  await prisma.aiUsage.create({
    data: {
      userId: by,
      purpose,
      model,
      inputTokens,
      outputTokens,
      failed,
      createdAt: at,
    },
  });
}

describe('aiUsage router', () => {
  describe('summary', () => {
    it("reports this month's spend across every learner against the cap", async () => {
      await recordCall({ outputTokens: 80_000 }); // $0.80
      await recordCall({ by: otherUserId, outputTokens: 40_000 }); // $0.40

      const summary = await createCaller().aiUsage.summary();

      expect(summary.spentUsd).toBeCloseTo(1.2, 8);
      expect(summary.capUsd).toBe(10);
      expect(summary.paused).toBe(false);
    });

    it('says AI is paused once the month reaches the cap', async () => {
      await recordCall({ outputTokens: 1_000_000 }); // $10

      const summary = await createCaller().aiUsage.summary();

      expect(summary).toMatchObject({ capUsd: 10, paused: true });
    });

    it('counts only this UTC month toward the cap', async () => {
      await recordCall({
        at: new Date('2026-09-30T23:59:59.999Z'),
        outputTokens: 500_000,
      });
      await recordCall({
        at: new Date('2026-10-01T00:00:00Z'),
        outputTokens: 10_000,
      });

      const summary = await createCaller().aiUsage.summary();

      expect(summary.spentUsd).toBeCloseTo(0.1, 8);
    });

    it("refuses learners who can't use AI, since the total covers everyone", async () => {
      await expect(createCaller(otherUserId).aiUsage.summary()).rejects.toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    });

    it('makes no model call', async () => {
      await recordCall({ outputTokens: 10_000 });

      await createCaller().aiUsage.summary();

      expect(ai.requests).toHaveLength(0);
    });
  });

  describe('report', () => {
    it('breaks this month down by purpose and model, costliest first', async () => {
      // Sonnet 5.5: 2 calls, $0.004 + $0.10 + $0.002 + $0.05
      await recordCall({ inputTokens: 2_000, outputTokens: 10_000 });
      await recordCall({ inputTokens: 1_000, outputTokens: 5_000 });
      // Opus 5.5 at $4 in, $20 out: $0.40 + $0.20
      await recordCall({
        model: 'claude-opus-5-5',
        inputTokens: 100_000,
        outputTokens: 10_000,
      });

      const report = await createCaller().aiUsage.report();

      expect(report.month).toBe('2026-10');
      expect(report.breakdown).toEqual([
        {
          purpose: 'SYLLABUS_GENERATION',
          model: 'claude-opus-5-5',
          calls: 1,
          inputTokens: 100_000,
          outputTokens: 10_000,
          costUsd: expect.closeTo(0.6, 8),
        },
        {
          purpose: 'SYLLABUS_GENERATION',
          model: 'claude-sonnet-5-5',
          calls: 2,
          inputTokens: 3_000,
          outputTokens: 15_000,
          costUsd: expect.closeTo(0.156, 8),
        },
      ]);
      expect(report.totalUsd).toBeCloseTo(0.756, 8);
    });

    it("shows only the learner's own usage", async () => {
      await recordCall({ outputTokens: 10_000 });
      await recordCall({ by: otherUserId, outputTokens: 50_000 });

      const mine = await createCaller().aiUsage.report();
      const theirs = await createCaller(otherUserId).aiUsage.report();

      expect(mine.breakdown).toEqual([
        expect.objectContaining({ calls: 1, outputTokens: 10_000 }),
      ]);
      expect(mine.totalUsd).toBeCloseTo(0.1, 8);
      expect(theirs.totalUsd).toBeCloseTo(0.5, 8);
    });

    it('totals each previous month, newest first, split on UTC month boundaries', async () => {
      await recordCall({
        at: new Date('2026-10-01T00:00:00Z'),
        outputTokens: 10_000,
      });
      await recordCall({
        at: new Date('2026-09-30T23:59:59.999Z'),
        outputTokens: 20_000,
      });
      await recordCall({
        at: new Date('2026-09-01T00:00:00Z'),
        outputTokens: 30_000,
      });
      await recordCall({
        at: new Date('2026-07-31T23:59:59.999Z'),
        model: 'claude-opus-5-5',
        outputTokens: 10_000,
      });

      const report = await createCaller().aiUsage.report();

      expect(report.totalUsd).toBeCloseTo(0.1, 8);
      expect(report.previousMonths).toEqual([
        { month: '2026-09', costUsd: expect.closeTo(0.5, 8) },
        { month: '2026-07', costUsd: expect.closeTo(0.2, 8) },
      ]);
    });

    it('counts a call dated after now in this month, as the cap does', async () => {
      await recordCall({
        at: new Date('2026-11-02T00:00:00Z'),
        outputTokens: 10_000,
      });

      const report = await createCaller().aiUsage.report();

      expect(report.totalUsd).toBeCloseTo(0.1, 8);
      expect(report.previousMonths).toEqual([]);
    });

    it('shows an empty report to a learner with no usage yet', async () => {
      const report = await createCaller().aiUsage.report();

      expect(report).toEqual({
        month: '2026-10',
        totalUsd: 0,
        breakdown: [],
        previousMonths: [],
      });
    });

    it('counts calls that failed mid-flight, as the cap does', async () => {
      await recordCall({ outputTokens: 10_000, failed: true });

      const report = await createCaller().aiUsage.report();

      expect(report.breakdown).toEqual([
        expect.objectContaining({ calls: 1, costUsd: expect.closeTo(0.1, 8) }),
      ]);
    });

    it('makes no model call', async () => {
      await recordCall({ outputTokens: 10_000 });

      await createCaller().aiUsage.report();

      expect(ai.requests).toHaveLength(0);
    });
  });
});
