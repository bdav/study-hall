import { describe, it, expect } from 'vitest';
import {
  CARD_WRITING_RULES,
  REVERSIBLE_DECK_RULE,
  buildCardProposalSystemPrompt,
  cardProposalOutputSchema,
} from './cardProposal.js';

const validOutput = {
  cards: [
    {
      type: 'TYPED_RECALL',
      front: 'Translate: Good morning',
      canonicalAnswer: 'Buongiorno',
    },
    {
      type: 'TYPED_RECALL',
      front: 'Informal Italian hello',
      canonicalAnswer: 'Ciao',
    },
  ],
};

describe('cardProposalOutputSchema', () => {
  it('accepts a list of typed recall cards', () => {
    expect(cardProposalOutputSchema.parse(validOutput)).toEqual(validOutput);
  });

  it.each([
    ['no cards', { cards: [] }],
    ['a missing cards list', {}],
    [
      'a card without a card type',
      { cards: [{ front: 'Hello', canonicalAnswer: 'Ciao' }] },
    ],
    [
      'a card type other than typed recall',
      {
        cards: [
          { type: 'MULTIPLE_CHOICE', front: 'Hello', canonicalAnswer: 'Ciao' },
        ],
      },
    ],
    [
      'a blank front',
      {
        cards: [{ type: 'TYPED_RECALL', front: ' ', canonicalAnswer: 'Ciao' }],
      },
    ],
    [
      'a missing canonical answer',
      { cards: [{ type: 'TYPED_RECALL', front: 'Hello' }] },
    ],
    ['a list instead of an object', validOutput.cards],
  ])('rejects %s', (_, output) => {
    expect(cardProposalOutputSchema.safeParse(output).success).toBe(false);
  });

  it('trims fronts and canonical answers', () => {
    const parsed = cardProposalOutputSchema.parse({
      cards: [
        { type: 'TYPED_RECALL', front: ' Hello  ', canonicalAnswer: ' Ciao ' },
      ],
    });

    expect(parsed.cards[0]).toEqual({
      type: 'TYPED_RECALL',
      front: 'Hello',
      canonicalAnswer: 'Ciao',
    });
  });
});

describe('card-writing rules', () => {
  it('are what the card proposal prompt follows', () => {
    expect(buildCardProposalSystemPrompt({ reversible: false })).toContain(
      CARD_WRITING_RULES,
    );
  });

  it.each([
    [
      'cards test the subject, not the lesson',
      /never the lesson's own study advice/i,
    ],
    ['one fact per card', /tests one fact/i],
    [
      'no hints at spelling or length',
      /never hints at what the answer looks like/i,
    ],
    ['no contrast with a similar-looking word', /similar-looking word/i],
    [
      'context, not a named form, settles the form',
      /let the context settle it/i,
    ],
    ['unambiguous through meaning or context', /meaning or context/i],
    ['quantities in digits', /quantity .* in digits/i],
  ])('say %s', (_, rule) => {
    expect(CARD_WRITING_RULES).toMatch(rule);
  });
});

describe('reversible-deck rule (#84)', () => {
  it.each([
    [
      'a front is typed from its primary answer',
      /front .*type.* from its primary/i,
    ],
    ['a front is a bare term or name', /bare term or name/i],
    [
      'context is left out or moved to the answer side',
      /leave out the context.*answer side/is,
    ],
    ["the deck's subject supplies the context", /deck's subject/i],
    ['no two cards share a primary answer', /no two cards share/i],
  ])('says %s', (_, rule) => {
    expect(REVERSIBLE_DECK_RULE).toMatch(rule);
  });

  it('is given to the card proposal prompt for a reversible Course Deck, after the card-writing rules', () => {
    const system = buildCardProposalSystemPrompt({ reversible: true });

    expect(system).toContain(
      `${CARD_WRITING_RULES}\n\n${REVERSIBLE_DECK_RULE}`,
    );
  });

  it('is left out for a deck studied one way', () => {
    expect(buildCardProposalSystemPrompt({ reversible: false })).not.toContain(
      REVERSIBLE_DECK_RULE,
    );
  });
});
