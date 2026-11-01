import { describe, it, expect } from 'vitest';
import { CARD_WRITING_RULES } from './cardProposal.js';
import {
  CARD_GENERATION_SYSTEM_PROMPT,
  buildCardGenerationPrompt,
  cardGenerationOutputSchema,
} from './cardGeneration.js';

const validOutput = {
  cards: [
    {
      type: 'TYPED_RECALL',
      front: 'Preterite of ir: yo ___',
      canonicalAnswer: 'fui',
    },
    {
      type: 'TYPED_RECALL',
      front: 'Preterite of tener: yo ___',
      canonicalAnswer: 'tuve',
    },
  ],
};

describe('cardGenerationOutputSchema', () => {
  it('accepts a list of typed recall cards', () => {
    expect(cardGenerationOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it('accepts no cards with a note, for a description cards can’t follow', () => {
    expect(
      cardGenerationOutputSchema.parse({
        cards: [],
        note: ' Cards can’t test pronunciation. ',
      }),
    ).toEqual({ cards: [], note: 'Cards can’t test pronunciation.' });
  });

  it.each([
    ['a missing cards list', {}],
    ['a list instead of an object', validOutput.cards],
    [
      'a card without a card type',
      { cards: [{ front: 'Hello', canonicalAnswer: 'Hola' }] },
    ],
    [
      'a card type other than typed recall',
      {
        cards: [
          { type: 'MULTIPLE_CHOICE', front: 'Hello', canonicalAnswer: 'Hola' },
        ],
      },
    ],
    [
      'a blank front',
      {
        cards: [{ type: 'TYPED_RECALL', front: ' ', canonicalAnswer: 'Hola' }],
      },
    ],
    [
      'a missing canonical answer',
      { cards: [{ type: 'TYPED_RECALL', front: 'Hello' }] },
    ],
  ])('rejects %s', (_, output) => {
    expect(cardGenerationOutputSchema.safeParse(output).success).toBe(false);
  });

  it('trims fronts and canonical answers', () => {
    const parsed = cardGenerationOutputSchema.parse({
      cards: [
        { type: 'TYPED_RECALL', front: ' Hello  ', canonicalAnswer: ' Hola ' },
      ],
    });

    expect(parsed.cards[0]).toEqual({
      type: 'TYPED_RECALL',
      front: 'Hello',
      canonicalAnswer: 'Hola',
    });
  });
});

describe('card generation prompt', () => {
  it('follows the card-writing rules', () => {
    expect(CARD_GENERATION_SYSTEM_PROMPT).toContain(CARD_WRITING_RULES);
  });

  it("gives the description, how many cards, the deck and the deck's cards", () => {
    const prompt = buildCardGenerationPrompt({
      instructions: ['The most common Spanish irregular preterites'],
      count: 20,
      deck: { name: 'Spanish verbs', description: 'Past tenses' },
      existingCards: [
        { front: 'Preterite of ir: yo ___', canonicalAnswer: 'fui' },
      ],
    });

    expect(prompt).toContain('The most common Spanish irregular preterites');
    expect(prompt).toContain('20 cards');
    expect(prompt).toContain('Spanish verbs');
    expect(prompt).toContain('Past tenses');
    expect(prompt).toContain('- Preterite of ir: yo ___ → fui');
    expect(prompt).not.toContain('Your last proposal');
  });

  it('says when the deck has no description or cards', () => {
    const prompt = buildCardGenerationPrompt({
      instructions: ['Spanish numbers'],
      count: 10,
      deck: { name: 'Numbers', description: null },
      existingCards: [],
    });

    expect(prompt).toContain('Deck description: none');
    expect(prompt).toContain('- None yet.');
  });

  it('gives the description first and every instruction of a refinement in order, and the proposal as the learner left it', () => {
    const prompt = buildCardGenerationPrompt({
      instructions: [
        'The most common Spanish irregular preterites',
        'Use full sentences',
        'Add vosotros forms',
      ],
      count: 10,
      deck: { name: 'Spanish verbs', description: null },
      existingCards: [],
      refining: [
        {
          front: 'Ayer yo ___ al cine (ir)',
          canonicalAnswer: 'fui',
          included: true,
        },
        {
          front: 'Preterite of ser: yo ___',
          canonicalAnswer: 'fui',
          included: false,
        },
      ],
    });

    expect(prompt).toContain(
      'The learner’s description of the cards they want:\nThe most common Spanish irregular preterites',
    );
    expect(prompt).toContain('1. Use full sentences\n2. Add vosotros forms');
    expect(prompt).toContain('1. Ayer yo ___ al cine (ir) → fui\n');
    expect(prompt).toContain(
      '2. Preterite of ser: yo ___ → fui (unticked by the learner)',
    );
  });
});
