import { type AiPurpose, type PrismaClient } from '@prisma/client';
import {
  aiMonthOf,
  callUsageFields,
  estimateCostUsd,
  promptTokens,
  startOfAiMonth,
} from './spend.js';

type BreakdownRow = {
  purpose: AiPurpose;
  model: string;
  calls: number;
  /** Every input token, whether or not it was cached. */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

/**
 * A learner's AI usage: this month by purpose and model, and a total for
 * each previous month. Calls are priced with the same estimate and month
 * boundaries as the spending cap, so the figures match what it enforces.
 */
export async function aiUsageReport(prisma: PrismaClient, userId: string) {
  const now = new Date();
  // The cap's own test for this month, so the two always agree
  const monthStart = startOfAiMonth(now);
  const usage = await prisma.aiUsage.findMany({
    where: { userId },
    select: { ...callUsageFields, purpose: true, createdAt: true },
  });

  const breakdownRows = new Map<string, BreakdownRow>();
  const previousMonths = new Map<string, number>();
  for (const call of usage) {
    if (call.createdAt < monthStart) {
      const month = aiMonthOf(call.createdAt);
      previousMonths.set(
        month,
        (previousMonths.get(month) ?? 0) + estimateCostUsd(call),
      );
      continue;
    }

    const key = `${call.purpose}:${call.model}`;
    const row = breakdownRows.get(key) ?? {
      purpose: call.purpose,
      model: call.model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    row.calls += 1;
    row.inputTokens += promptTokens(call);
    row.outputTokens += call.outputTokens;
    row.costUsd += estimateCostUsd(call);
    breakdownRows.set(key, row);
  }

  const breakdown = [...breakdownRows.values()].sort(
    (a, b) => b.costUsd - a.costUsd,
  );

  return {
    month: aiMonthOf(now),
    totalUsd: breakdown.reduce((total, row) => total + row.costUsd, 0),
    breakdown,
    previousMonths: [...previousMonths]
      .map(([month, costUsd]) => ({ month, costUsd }))
      .sort((a, b) => b.month.localeCompare(a.month)),
  };
}
