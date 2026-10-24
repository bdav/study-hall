import { type PrismaClient } from '@prisma/client';

type Price = {
  /** US dollars per million input tokens. */
  input: number;
  /** US dollars per million output tokens. */
  output: number;
};

type ModelPrice = Price & {
  /** A higher rate for the whole call once the prompt passes a size. */
  longPrompt?: Price & { aboveInputTokens: number };
};

/**
 * Anthropic first-party API prices. Update this table when prices change or
 * the app starts using another model.
 */
const MODEL_PRICES = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    longPrompt: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 },
  },
} satisfies Record<string, ModelPrice>;

/**
 * A model in the price table. The app calls only these, so a new model
 * can't be used until it has a price.
 */
export type PricedModel = keyof typeof MODEL_PRICES;

export function isPricedModel(model: string): model is PricedModel {
  return Object.hasOwn(MODEL_PRICES, model);
}

/**
 * A server-side fallback can answer with a model missing from the table, so
 * unknown models get the highest rate and the cap never undercounts.
 */
const UNKNOWN_MODEL_PRICE: Price = {
  input: Math.max(...Object.values(MODEL_PRICES).map((p) => p.input)),
  output: Math.max(...Object.values(MODEL_PRICES).map((p) => p.output)),
};

/** The estimated cost of one model call in US dollars. */
export function estimateCostUsd(usage: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  // The model that answered can differ from the one requested
  const prices: Record<string, ModelPrice | undefined> = MODEL_PRICES;
  const modelPrice = prices[usage.model];
  const price =
    modelPrice?.longPrompt &&
    usage.inputTokens > modelPrice.longPrompt.aboveInputTokens
      ? modelPrice.longPrompt
      : (modelPrice ?? UNKNOWN_MODEL_PRICE);

  return (
    (usage.inputTokens * price.input + usage.outputTokens * price.output) /
    1_000_000
  );
}

/** AI months run in UTC, from the first of the month. */
export function startOfAiMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The AI month a date falls in, as `YYYY-MM`. */
export function aiMonthOf(date: Date): string {
  return startOfAiMonth(date).toISOString().slice(0, 7);
}

/**
 * This month's estimated AI spend in US dollars across every user, since
 * the bill is shared. Each call is priced on its own because some prices
 * depend on the size of that call's prompt.
 */
export async function monthlyAiSpendUsd(prisma: PrismaClient): Promise<number> {
  const usage = await prisma.aiUsage.findMany({
    where: { createdAt: { gte: startOfAiMonth(new Date()) } },
    select: { model: true, inputTokens: true, outputTokens: true },
  });

  return usage.reduce((total, call) => total + estimateCostUsd(call), 0);
}

/**
 * The monthly cap in US dollars from `AI_MONTHLY_CAP_USD`. Unset or invalid
 * means no AI spending at all, like an unset allowlist.
 */
export function monthlyCapUsd(): number {
  const cap = Number(process.env.AI_MONTHLY_CAP_USD);
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

/**
 * This month's spend against the cap. Reaching the cap pauses AI features.
 */
export async function aiSpendStatus(prisma: PrismaClient): Promise<{
  spentUsd: number;
  capUsd: number;
  paused: boolean;
}> {
  const spentUsd = await monthlyAiSpendUsd(prisma);
  const capUsd = monthlyCapUsd();
  return { spentUsd, capUsd, paused: spentUsd >= capUsd };
}

/** Whether this month's spend has reached the cap, which pauses AI features. */
export async function isAiPaused(prisma: PrismaClient): Promise<boolean> {
  return (await aiSpendStatus(prisma)).paused;
}

export const AI_PAUSED_MESSAGE =
  "AI features are paused until next month because this month's AI spending cap has been reached. Your existing courses still work.";
