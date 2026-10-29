import { describe, it, expect } from 'vitest';
import { estimateCostUsd, type PricedModel } from './spend.js';

/** A call's usage, with no cached tokens unless given. */
function call(usage: {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  cacheReadTokens?: number;
}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    ...usage,
  };
}

describe('estimateCostUsd', () => {
  it.each([
    // Sonnet 5.5: $2 in, $10 out per million tokens
    ['claude-sonnet-5-5', 1_000_000, 1_000_000, 12],
    ['claude-sonnet-5-5', 812, 1450, 0.016124],
    // Opus 5.5: $4 in, $20 out
    ['claude-opus-5-5', 100_000, 10_000, 0.6],
    // Haiku 5.5: $0.10 in, $0.50 out for prompts up to 100K tokens
    ['claude-haiku-5-5', 100_000, 200_000, 0.11],
    // Fable 5.1: $10 in, $50 out
    ['claude-fable-5-1', 20_000, 4_000, 0.4],
  ])(
    'prices %s at %i input and %i output tokens',
    (model, inputTokens, outputTokens, expected) => {
      expect(
        estimateCostUsd(call({ model, inputTokens, outputTokens })),
      ).toBeCloseTo(expected, 8);
    },
  );

  it('prices a Haiku 5.5 prompt over 100K tokens at the long-prompt rate', () => {
    // $0.50 in, $2.50 out per million tokens
    expect(
      estimateCostUsd(
        call({
          model: 'claude-haiku-5-5',
          inputTokens: 200_000,
          outputTokens: 100_000,
        }),
      ),
    ).toBeCloseTo(0.35, 8);
  });

  it('prices a model missing from the table at the highest rate, so the cap never undercounts', () => {
    expect(
      estimateCostUsd(
        call({
          model: 'claude-unknown-9',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
        }),
      ),
    ).toBeCloseTo(60, 8);
  });

  // Figures worked by hand from Anthropic's pricing page (2026-10-28)
  it("prices cache writes and reads at the model's own rates", () => {
    // Sonnet 5.5: $2 in, $2.50 5-minute writes, $0.10 reads, $10 out
    // 1,000 × 2 + 10,000 × 2.5 + 50,000 × 0.1 + 2,000 × 10 = 52,000
    expect(
      estimateCostUsd(
        call({
          model: 'claude-sonnet-5-5',
          inputTokens: 1_000,
          cacheWrite5mTokens: 10_000,
          cacheReadTokens: 50_000,
          outputTokens: 2_000,
        }),
      ),
    ).toBeCloseTo(0.052, 8);
  });

  it('prices 1-hour cache writes at their own, higher rate', () => {
    // Opus 5.5: $5 5-minute writes, $8 1-hour writes, $0.20 reads
    // 10,000 × 5 + 100,000 × 8 + 100,000 × 0.2 = 870,000
    expect(
      estimateCostUsd(
        call({
          model: 'claude-opus-5-5',
          cacheWrite5mTokens: 10_000,
          cacheWrite1hTokens: 100_000,
          cacheReadTokens: 100_000,
        }),
      ),
    ).toBeCloseTo(0.87, 8);
  });

  it('prices Fable 5.1 cache reads at 0.025× its input rate', () => {
    // $0.25 per million reads
    expect(
      estimateCostUsd(
        call({ model: 'claude-fable-5-1', cacheReadTokens: 1_000_000 }),
      ),
    ).toBeCloseTo(0.25, 8);
  });

  it("counts cached tokens toward Haiku 5.5's 100K-token prompt threshold", () => {
    // 10,000 + 95,000 cached = 105,000, over 100K: $0.50 in, $0.05
    // reads, $2.50 out. 10,000 × 0.5 + 95,000 × 0.05 + 1,000 × 2.5 = 12,250
    expect(
      estimateCostUsd(
        call({
          model: 'claude-haiku-5-5',
          inputTokens: 10_000,
          cacheReadTokens: 95_000,
          outputTokens: 1_000,
        }),
      ),
    ).toBeCloseTo(0.01225, 8);
  });

  it('keeps the Haiku 5.5 rate for a prompt of exactly 100K tokens', () => {
    // 10,000 + 90,000 cached: $0.10 in, $0.01 reads, $0.50 out.
    // 10,000 × 0.1 + 90,000 × 0.01 + 1,000 × 0.5 = 2,400
    expect(
      estimateCostUsd(
        call({
          model: 'claude-haiku-5-5',
          inputTokens: 10_000,
          cacheReadTokens: 90_000,
          outputTokens: 1_000,
        }),
      ),
    ).toBeCloseTo(0.0024, 8);
  });

  it('prices cached tokens of a model missing from the table at the highest rates', () => {
    // The highest 1-hour write is $20 and the highest read $0.25, Fable 5.1's
    expect(
      estimateCostUsd(
        call({
          model: 'claude-unknown-9',
          cacheWrite1hTokens: 1_000_000,
          cacheReadTokens: 1_000_000,
        }),
      ),
    ).toBeCloseTo(20.25, 8);
  });

  it('costs nothing for no tokens', () => {
    expect(
      estimateCostUsd(
        call({
          model: 'claude-sonnet-5-5',
          inputTokens: 0,
          outputTokens: 0,
        }),
      ),
    ).toBe(0);
  });
});

describe('PricedModel', () => {
  it('admits only models in the price table, so the app cannot call an unpriced one', () => {
    const priced: PricedModel = 'claude-sonnet-5-5';
    // @ts-expect-error: a model missing from the price table
    const unpriced: PricedModel = 'claude-unpriced-1';

    expect([priced, unpriced]).toHaveLength(2);
  });
});
