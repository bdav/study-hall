import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from './spend.js';

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
      expect(estimateCostUsd({ model, inputTokens, outputTokens })).toBeCloseTo(
        expected,
        8,
      );
    },
  );

  it('prices a Haiku 5.5 prompt over 100K tokens at the long-prompt rate', () => {
    // $0.50 in, $2.50 out per million tokens
    expect(
      estimateCostUsd({
        model: 'claude-haiku-5-5',
        inputTokens: 200_000,
        outputTokens: 100_000,
      }),
    ).toBeCloseTo(0.35, 8);
  });

  it('prices a model missing from the table at the highest rate, so the cap never undercounts', () => {
    expect(
      estimateCostUsd({
        model: 'claude-unknown-9',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(60, 8);
  });

  it('costs nothing for no tokens', () => {
    expect(
      estimateCostUsd({
        model: 'claude-sonnet-5-5',
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0);
  });
});
