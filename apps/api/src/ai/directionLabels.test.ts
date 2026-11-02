import { describe, it, expect } from 'vitest';
import {
  buildDirectionLabelsPrompt,
  directionLabelsOutputSchema,
} from './directionLabels.js';

describe('directionLabelsOutputSchema', () => {
  it('accepts two labels, trimmed', () => {
    expect(
      directionLabelsOutputSchema.parse({
        forwardLabel: ' Capitals from states ',
        reverseLabel: 'States from capitals',
      }),
    ).toEqual({
      forwardLabel: 'Capitals from states',
      reverseLabel: 'States from capitals',
    });
  });

  it('accepts labels of 40 characters', () => {
    const label = 'x'.repeat(40);

    expect(
      directionLabelsOutputSchema.parse({
        forwardLabel: label,
        reverseLabel: label,
      }),
    ).toEqual({ forwardLabel: label, reverseLabel: label });
  });

  it.each([
    ['a missing label', { forwardLabel: 'Capitals from states' }],
    ['a blank label', { forwardLabel: ' ', reverseLabel: 'States' }],
    [
      'a label over 40 characters',
      { forwardLabel: 'x'.repeat(41), reverseLabel: 'States' },
    ],
    ['labels as a list', ['Capitals from states', 'States from capitals']],
  ])('refuses %s', (_, output) => {
    expect(directionLabelsOutputSchema.safeParse(output).success).toBe(false);
  });
});

describe('buildDirectionLabelsPrompt', () => {
  it('gives the deck and its cards, front and primary answer', () => {
    const prompt = buildDirectionLabelsPrompt({
      name: 'US capitals',
      description: 'One per state',
      cards: [{ front: 'Ohio', canonicalAnswer: 'Columbus' }],
    });

    expect(prompt).toContain('Deck: US capitals');
    expect(prompt).toContain('Deck description: One per state');
    expect(prompt).toContain('- Ohio → Columbus');
  });

  it('says when the deck has no description or cards yet', () => {
    const prompt = buildDirectionLabelsPrompt({
      name: 'US capitals',
      description: null,
      cards: [],
    });

    expect(prompt).toContain('Deck description: none');
    expect(prompt).toContain('No cards yet');
  });
});
