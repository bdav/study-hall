import { type PrismaClient } from '@prisma/client';

type Price = {
  /** US dollars per million input tokens. */
  input: number;
  /** US dollars per million input tokens written to the 5-minute cache. */
  cacheWrite5m: number;
  /** US dollars per million input tokens written to the 1-hour cache. */
  cacheWrite1h: number;
  /** US dollars per million input tokens read from the cache. */
  cacheRead: number;
  /** US dollars per million output tokens. */
  output: number;
};

type ModelPrice = Price & {
  /**
   * A higher rate for the whole call once its prompt passes a size. The
   * prompt counts every input token, cached or not.
   */
  longPrompt?: Price & { aboveInputTokens: number };
};

/**
 * Anthropic first-party API prices (platform.claude.com/docs/en/about-claude/pricing,
 * checked 2026-10-28). Update this table when prices change or the app
 * starts using another model.
 */
const MODEL_PRICES = {
  'claude-fable-5-1': {
    input: 10,
    cacheWrite5m: 12.5,
    cacheWrite1h: 20,
    cacheRead: 0.25,
    output: 50,
  },
  'claude-opus-5-5': {
    input: 4,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
    output: 20,
  },
  'claude-sonnet-5-5': {
    input: 2,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.1,
    output: 10,
  },
  'claude-haiku-5-5': {
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
    longPrompt: {
      aboveInputTokens: 100_000,
      input: 0.5,
      cacheWrite5m: 0.625,
      cacheWrite1h: 1,
      cacheRead: 0.05,
      output: 2.5,
    },
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

const highest = (rate: keyof Price) =>
  Math.max(...Object.values(MODEL_PRICES).map((price) => price[rate]));

/**
 * A server-side fallback can answer with a model missing from the table, so
 * unknown models get the highest rates and the cap never undercounts.
 */
const UNKNOWN_MODEL_PRICE: Price = {
  input: highest('input'),
  cacheWrite5m: highest('cacheWrite5m'),
  cacheWrite1h: highest('cacheWrite1h'),
  cacheRead: highest('cacheRead'),
  output: highest('output'),
};

/** The tokens of one model call, as an AI usage record stores them. */
export type CallUsage = {
  model: string;
  /** Input tokens neither written to nor read from the cache. */
  inputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
};

/** Every input token of a call, whether or not it was cached. */
export function promptTokens(usage: Omit<CallUsage, 'model' | 'outputTokens'>) {
  return (
    usage.inputTokens +
    usage.cacheWrite5mTokens +
    usage.cacheWrite1hTokens +
    usage.cacheReadTokens
  );
}

/** The estimated cost of one model call in US dollars. */
export function estimateCostUsd(usage: CallUsage): number {
  // The model that answered can differ from the one requested
  const prices: Record<string, ModelPrice | undefined> = MODEL_PRICES;
  const modelPrice = prices[usage.model];
  const price =
    modelPrice?.longPrompt &&
    promptTokens(usage) > modelPrice.longPrompt.aboveInputTokens
      ? modelPrice.longPrompt
      : (modelPrice ?? UNKNOWN_MODEL_PRICE);

  return (
    (usage.inputTokens * price.input +
      usage.cacheWrite5mTokens * price.cacheWrite5m +
      usage.cacheWrite1hTokens * price.cacheWrite1h +
      usage.cacheReadTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000
  );
}

/** The fields of an AI usage record that price its call. */
export const callUsageFields = {
  model: true,
  inputTokens: true,
  cacheWrite5mTokens: true,
  cacheWrite1hTokens: true,
  cacheReadTokens: true,
  outputTokens: true,
} as const;

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
    select: callUsageFields,
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
