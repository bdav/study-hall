import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { generateStructured } from '../ai/generate.js';
import {
  buildCardRevisionPrompt,
  CARD_REVISION_MODEL,
  CARD_REVISION_PROMPT_VERSION,
  buildCardRevisionSystemPrompt,
  cardRevisionOutputSchema,
  MAX_REVISABLE_CARDS,
  MAX_REVISION_INSTRUCTION_LENGTH,
  toProposedChanges,
} from '../ai/cardRevision.js';
import {
  buildCardGenerationPrompt,
  CARD_GENERATION_MODEL,
  CARD_GENERATION_PROMPT_VERSION,
  buildCardGenerationSystemPrompt,
  cardGenerationOutputSchema,
  MAX_GENERATED_CARDS,
  MAX_GENERATION_INSTRUCTION_LENGTH,
} from '../ai/cardGeneration.js';
import { cardProposalSchema } from '../ai/cardProposal.js';
import {
  createCards,
  deckOrder,
  editCard,
  primaryAnswerText,
  withCanonicalAnswers,
} from '../services/cards.js';
import {
  accuracy,
  addAnswers,
  answerCount,
  countRetiredCards,
  readCardStanding,
} from '../services/cardStanding.js';
import { matchAnswer } from '../services/answerGrader.js';
import {
  buildDirectionLabelsPrompt,
  DIRECTION_LABELS_CARD_SAMPLE,
  DIRECTION_LABELS_MODEL,
  DIRECTION_LABELS_PROMPT_VERSION,
  DIRECTION_LABELS_SYSTEM_PROMPT,
  directionLabelsOutputSchema,
} from '../ai/directionLabels.js';
import {
  assertDeckActive,
  assertStudiesIn,
  hasLabelToSuggest,
  MAX_DIRECTION_LABEL_LENGTH,
  saveSuggestedLabels,
  findActiveDeck,
  findOwnedDeck,
} from '../services/decks.js';
import { liveCramDate } from '../services/cramDate.js';

const text = z.string().trim().min(1);
const proposalSource = z.string().min(1).max(100);
const instruction = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REVISION_INSTRUCTION_LENGTH);

const generationInstruction = z
  .string()
  .trim()
  .min(1)
  .max(MAX_GENERATION_INSTRUCTION_LENGTH);

/**
 * A Cram Date (#87): a date with no time ("2027-06-01"), stored as the
 * start of its day in UTC, and today at the earliest.
 */
const cramDate = z.iso
  .date()
  .transform((date) => new Date(date))
  .refine((date) => liveCramDate(date, new Date()), {
    message: 'Choose a date from today on',
  });

/** A Direction Label, blank for none, when Forward or Reverse stands in. */
const directionLabel = z
  .string()
  .trim()
  .max(MAX_DIRECTION_LABEL_LENGTH)
  .transform((label) => label || null)
  .nullable()
  .optional();

function changesEachCardOnce(cardIds: string[]) {
  return new Set(cardIds).size === cardIds.length;
}

/** A revision that names a card the deck no longer has. */
function cardNotInDeck() {
  return new TRPCError({
    code: 'NOT_FOUND',
    message:
      'A card in this revision is no longer in the deck. Please revise again.',
  });
}

/**
 * A proposal being refined, as the learner left it: the instructions it
 * came from, oldest first, and its changes as edited, ticked or not.
 */
const refiningInput = z.object({
  instructions: z.array(instruction).min(1),
  changes: z
    .array(
      z.discriminatedUnion('action', [
        z.object({
          cardId: z.string(),
          action: z.literal('EDIT'),
          front: text,
          canonicalAnswer: text,
          included: z.boolean(),
        }),
        z.object({
          cardId: z.string(),
          action: z.literal('DELETE'),
          included: z.boolean(),
        }),
      ]),
    )
    .max(MAX_REVISABLE_CARDS)
    .refine(
      (changes) => changesEachCardOnce(changes.map((change) => change.cardId)),
      { message: 'A revision changes each card once' },
    ),
});

export const deckRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.id, userId: ctx.userId },
        include: {
          cards: {
            orderBy: deckOrder,
            include: withCanonicalAnswers,
          },
          // Set on a Course Deck
          course: { select: { id: true, title: true, archivedAt: true } },
        },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      // How many of its cards are retired, every way it's studied, as
      // they retire together, so Review retired is offered only on a deck
      // with some (#86)
      const retiredCount = await countRetiredCards(ctx.prisma, {
        userId: ctx.userId,
        deckId: deck.id,
      });

      return {
        ...deck,
        cramUntil: liveCramDate(deck.cramUntil, new Date()),
        retiredCount,
      };
    }),

  /** The learner's decks in Flashcards: those not archived. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const decks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, title: true, archivedAt: true } },
        _count: { select: { cards: true } },
        studySessions: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { startedAt: true },
        },
      },
    });

    // Each deck's Counted Answers, from one read of its cards' standing
    const { cards } = await readCardStanding(ctx.prisma, {
      userId: ctx.userId,
      deckIds: decks.map((deck) => deck.id),
    });
    const answersOf = (deckId: string) =>
      addAnswers(
        cards
          .filter((card) => card.deckId === deckId)
          .map((card) => card.countedAnswers),
      );

    return decks.map((deck) => {
      const answers = answersOf(deck.id);

      return {
        id: deck.id,
        name: deck.name,
        description: deck.description,
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        userId: deck.userId,
        course: deck.course,
        cardCount: deck._count.cards,
        totalAttempts: answerCount(answers),
        accuracy: accuracy(answers),
        lastStudied: deck.studySessions[0]?.startedAt ?? null,
      };
    });
  }),

  /** The learner's archived decks, most recently archived first. */
  listArchived: protectedProcedure.query(async ({ ctx }) => {
    const decks = await ctx.prisma.deck.findMany({
      where: { userId: ctx.userId, archivedAt: { not: null } },
      orderBy: { archivedAt: 'desc' },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        course: { select: { id: true, title: true, archivedAt: true } },
        _count: { select: { cards: true } },
      },
    });

    return decks.map(({ _count, ...deck }) => ({
      ...deck,
      cardCount: _count.cards,
    }));
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.deck.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          userId: ctx.userId,
        },
      });
    }),

  /**
   * Changes a deck's name, description, or whether it's a Reversible Deck
   * and its Direction Labels (ADR-0011). Turning reversibility off hides
   * Reverse and keeps its history, abandoning a Reverse Study Session under
   * way; turning it back on picks up where it left off.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        reversible: z.boolean().optional(),
        forwardLabel: directionLabel,
        reverseLabel: directionLabel,
        cramUntil: cramDate.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.id,
      });

      return ctx.prisma.$transaction(async (tx) => {
        if (input.reversible === false) {
          // Its own unfinished sessions in Reverse, and a Today's Review
          // still to ask one of its cards in Reverse
          await tx.studySession.updateMany({
            where: {
              status: 'ACTIVE',
              OR: [
                { deckId: input.id, direction: 'REVERSE' },
                {
                  items: {
                    some: {
                      direction: 'REVERSE',
                      status: 'PENDING',
                      card: { deckId: input.id },
                    },
                  },
                },
              ],
            },
            data: { status: 'ABANDONED', endedAt: new Date() },
          });
        }
        return tx.deck.update({
          where: { id: input.id },
          data: {
            name: input.name,
            description: input.description,
            reversible: input.reversible,
            cramUntil: input.cramUntil,
            // A label the learner sets is theirs, which suggestions leave
            // alone (#83)
            ...(input.forwardLabel !== undefined && {
              forwardLabel: input.forwardLabel,
              forwardLabelSuggested: false,
            }),
            ...(input.reverseLabel !== undefined && {
              reverseLabel: input.reverseLabel,
              reverseLabelSuggested: false,
            }),
          },
        });
      });
    }),

  /**
   * Archives a deck (#77, ADR-0003): it leaves Flashcards and keeps its
   * cards, Card Versions, attempts, progress and Study Sessions. A Course
   * Deck goes with its course, so it can't be archived on its own while
   * the course is active.
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deck = await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.id,
      });

      // Checked as it's archived, so a course restored meanwhile wins
      const archived = await ctx.prisma.deck.updateMany({
        where: {
          id: deck.id,
          archivedAt: null,
          OR: [{ courseId: null }, { course: { archivedAt: { not: null } } }],
        },
        data: { archivedAt: new Date() },
      });
      if (archived.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            "A course's deck goes with its course: archive the course instead.",
        });
      }

      return { success: true };
    }),

  /** Puts an archived deck back in Flashcards as it was. */
  restore: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deck = await findOwnedDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.id,
      });

      const restored = await ctx.prisma.deck.updateMany({
        where: { id: deck.id, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (restored.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This deck is not archived',
        });
      }

      return { success: true };
    }),

  /**
   * Deletes an archived deck for good, with its cards and their whole
   * history: the only way to remove a deck, and only once it's archived.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deck = await findOwnedDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.id,
      });

      const deleted = await ctx.prisma.deck.deleteMany({
        where: { id: deck.id, archivedAt: { not: null } },
      });
      if (deleted.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Archive a deck before deleting it permanently',
        });
      }

      return { success: true };
    }),

  /**
   * Suggests a Reversible Deck's Direction Labels (#83) from its name,
   * description and first DIRECTION_LABELS_CARD_SAMPLE cards, front and
   * primary answer, in one Haiku-class call, and saves them where the
   * learner hasn't typed their own (`saveSuggestedLabels`). When both
   * labels are the learner's, nothing is asked. Returns the deck's labels
   * as they then are, and whether a suggestion was taken.
   */
  suggestDirectionLabels: aiProcedure
    .input(z.object({ deckId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deck = await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });
      // Only a Reversible Deck has directions to name
      assertStudiesIn(deck, 'REVERSE');
      if (!hasLabelToSuggest(deck)) {
        return {
          forwardLabel: deck.forwardLabel,
          reverseLabel: deck.reverseLabel,
          suggested: false,
        };
      }
      const cards = await ctx.prisma.card.findMany({
        where: { deckId: deck.id },
        orderBy: deckOrder,
        take: DIRECTION_LABELS_CARD_SAMPLE,
        include: withCanonicalAnswers,
      });

      const { output } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'DIRECTION_LABELS',
        model: DIRECTION_LABELS_MODEL,
        promptVersion: DIRECTION_LABELS_PROMPT_VERSION,
        system: DIRECTION_LABELS_SYSTEM_PROMPT,
        prompt: buildDirectionLabelsPrompt({
          name: deck.name,
          description: deck.description,
          cards: cards.map((card) => ({
            front: card.front,
            canonicalAnswer: primaryAnswerText(card),
          })),
        }),
        outputSchema: directionLabelsOutputSchema,
      });

      const labels = await saveSuggestedLabels(ctx.prisma, {
        deckId: deck.id,
        labels: output,
      });
      return { ...labels, suggested: true };
    }),

  /**
   * Proposes edits to and deletions of the deck's cards from the learner's
   * instruction (ADR-0007), for the cards it concerns. When refining, the
   * earlier instructions and the proposal as the learner left it come too,
   * and the whole revision is proposed again. Nothing changes: the learner
   * approves the changes they want with `applyRevision`.
   */
  proposeRevision: aiProcedure
    .input(
      z.object({
        deckId: z.string(),
        instruction,
        refining: refiningInput.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
        include: {
          cards: { orderBy: deckOrder, include: withCanonicalAnswers },
        },
      });

      if (!deck) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
      }
      assertDeckActive(deck);
      if (deck.cards.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This deck has no cards to revise.',
        });
      }
      // Batching larger decks comes later
      if (deck.cards.length > MAX_REVISABLE_CARDS) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Revising works on decks of up to ${MAX_REVISABLE_CARDS} cards, and this one has ${deck.cards.length}.`,
        });
      }
      // The prompt names cards by their number in the deck
      const cardNumbers = new Map(
        deck.cards.map((card, i) => [card.id, i + 1]),
      );
      const refiningChanges = input.refining?.changes.map(
        ({ cardId, ...change }) => {
          const card = cardNumbers.get(cardId);
          if (card === undefined) throw cardNotInDeck();
          return { card, ...change };
        },
      );

      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'CARD_REVISION',
        model: CARD_REVISION_MODEL,
        promptVersion: CARD_REVISION_PROMPT_VERSION,
        system: buildCardRevisionSystemPrompt(deck),
        prompt: buildCardRevisionPrompt({
          instructions: [
            ...(input.refining?.instructions ?? []),
            input.instruction,
          ],
          cards: deck.cards.map((card) => ({
            front: card.front,
            canonicalAnswers: card.canonicalAnswers.map((a) => a.text),
          })),
          refining: refiningChanges,
        }),
        outputSchema: cardRevisionOutputSchema,
      });

      const cards = deck.cards.map((card) => ({
        id: card.id,
        front: card.front,
        canonicalAnswer: primaryAnswerText(card),
        acceptedVariants: (
          card.canonicalAnswers[0]?.acceptedVariants ?? []
        ).map((variant) => variant.text),
      }));
      return {
        model,
        promptVersion,
        changes: toProposedChanges(output.changes, cards),
        note: output.note || null,
      };
    }),

  /**
   * Applies the changes the learner approved from a revision proposal, as
   * they edited them, in one transaction. An edit sets a card's front and/or
   * primary Canonical Answer through `editCard`, so it resets the card's
   * progress and keeps its attempts (ADR-0004), and its new Card Version
   * records the proposing model and prompt version. A deletion deletes the
   * card as the Cards tab does. A change to a card outside the deck is
   * refused, and nothing is applied.
   */
  applyRevision: protectedProcedure
    .input(
      z
        .object({
          deckId: z.string(),
          model: proposalSource,
          promptVersion: proposalSource,
          edits: z
            .array(
              z
                .object({
                  cardId: z.string(),
                  front: text.optional(),
                  canonicalAnswer: text.optional(),
                })
                .refine(
                  (edit) =>
                    edit.front !== undefined ||
                    edit.canonicalAnswer !== undefined,
                  { message: 'An edit changes the front, the answer or both' },
                ),
            )
            .max(MAX_REVISABLE_CARDS),
          deletions: z.array(z.string()).max(MAX_REVISABLE_CARDS),
        })
        .refine(({ edits, deletions }) => edits.length + deletions.length > 0, {
          message: 'A revision changes at least one card',
        })
        .refine(
          ({ edits, deletions }) =>
            changesEachCardOnce([
              ...edits.map((edit) => edit.cardId),
              ...deletions,
            ]),
          { message: 'A revision changes each card once' },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
        include: {
          cards: { include: withCanonicalAnswers },
        },
      });

      if (!deck) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
      }
      assertDeckActive(deck);

      const cards = new Map(deck.cards.map((card) => [card.id, card]));
      const changed = [...input.edits.map((e) => e.cardId), ...input.deletions];
      if (changed.some((cardId) => !cards.has(cardId))) {
        throw cardNotInDeck();
      }
      // Grading couldn't tell a new primary from the card's other answers,
      // and saying which card beats editCard's general refusal
      for (const edit of input.edits) {
        const card = cards.get(edit.cardId)!;
        const taken = edit.canonicalAnswer
          ? card.canonicalAnswers
              .slice(1)
              .find(
                (answer) =>
                  matchAnswer(edit.canonicalAnswer!, answer.text) === 'exact',
              )
          : undefined;
        if (taken) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `“${card.front}” already has the answer “${taken.text}”`,
          });
        }
      }

      const source = { model: input.model, promptVersion: input.promptVersion };
      await ctx.prisma.$transaction(
        async (tx) => {
          for (const edit of input.edits) {
            const card = cards.get(edit.cardId)!;
            // A new primary answer takes the place of the old; the others,
            // and their variants, stay
            const canonicalAnswers =
              edit.canonicalAnswer === undefined
                ? undefined
                : card.canonicalAnswers.map(({ id, text }, i) => ({
                    id,
                    text: i === 0 ? edit.canonicalAnswer! : text,
                  }));
            await editCard(tx, {
              cardId: card.id,
              front: edit.front,
              canonicalAnswers,
              source,
            });
          }
          await tx.card.deleteMany({
            where: { id: { in: input.deletions }, deckId: deck.id },
          });
        },
        // Up to MAX_REVISABLE_CARDS edits, each several queries
        { timeout: 60_000 },
      );

      return {
        editedCount: input.edits.length,
        deletedCount: input.deletions.length,
      };
    }),
  /**
   * Proposes new cards for the deck from the learner's description of the
   * cards they want (ADR-0010), never more than the number asked for. When
   * refining, the follow-up instructions and the proposal as the learner
   * left it come too, and the whole set is proposed again, up to
   * MAX_GENERATED_CARDS. Nothing is added: the learner confirms the cards
   * they want with `addGeneratedCards`.
   */
  proposeCards: aiProcedure
    .input(
      z.object({
        deckId: z.string(),
        description: generationInstruction,
        count: z.number().int().min(1).max(MAX_GENERATED_CARDS),
        refining: z
          .object({
            /** Follow-up instructions, oldest first, the newest last. */
            instructions: z.array(generationInstruction).min(1),
            cards: z
              .array(
                z.object({
                  front: text,
                  canonicalAnswer: text,
                  included: z.boolean(),
                }),
              )
              .max(MAX_GENERATED_CARDS),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
        include: {
          cards: { orderBy: deckOrder, include: withCanonicalAnswers },
        },
      });

      if (!deck) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
      }
      assertDeckActive(deck);

      const existingCards = deck.cards.map((card) => ({
        id: card.id,
        front: card.front,
        canonicalAnswer: primaryAnswerText(card),
      }));

      const { output, model, promptVersion } = await generateStructured(ctx, {
        userId: ctx.userId,
        purpose: 'CARD_GENERATION',
        model: CARD_GENERATION_MODEL,
        promptVersion: CARD_GENERATION_PROMPT_VERSION,
        system: buildCardGenerationSystemPrompt(deck),
        prompt: buildCardGenerationPrompt({
          instructions: [
            input.description,
            ...(input.refining?.instructions ?? []),
          ],
          count: input.count,
          deck: { name: deck.name, description: deck.description },
          existingCards,
          refining: input.refining?.cards,
        }),
        outputSchema: cardGenerationOutputSchema,
      });

      // A refinement may ask for more or fewer cards than the first round
      const limit = input.refining ? MAX_GENERATED_CARDS : input.count;
      return {
        model,
        promptVersion,
        cards: output.cards.slice(0, limit),
        note: output.note || null,
        existingCards,
      };
    }),

  /**
   * Adds the cards the learner confirmed from a generated proposal, as
   * edited, at the end of the deck in one transaction: NEW cards with no
   * Source Lesson, each recording the model and prompt version that
   * proposed it.
   */
  addGeneratedCards: protectedProcedure
    .input(
      z.object({
        deckId: z.string(),
        model: proposalSource,
        promptVersion: proposalSource,
        cards: z.array(cardProposalSchema).min(1).max(MAX_GENERATED_CARDS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deck = await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });

      // Typed Recall is the only card type, and the cards the app makes
      const cards = input.cards.map(({ front, canonicalAnswer }) => ({
        front,
        canonicalAnswers: [canonicalAnswer],
      }));
      await ctx.prisma.$transaction(
        (tx) =>
          createCards(tx, {
            deckId: deck.id,
            userId: ctx.userId,
            cards,
            source: { model: input.model, promptVersion: input.promptVersion },
          }),
        // Up to MAX_GENERATED_CARDS cards, each several inserts
        { timeout: 60_000 },
      );

      return { createdCount: cards.length };
    }),
});
