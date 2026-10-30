import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { aiProcedure, protectedProcedure, router } from './trpc.js';
import { generateStructured } from '../ai/generate.js';
import {
  buildCardRevisionPrompt,
  CARD_REVISION_MODEL,
  CARD_REVISION_PROMPT_VERSION,
  CARD_REVISION_SYSTEM_PROMPT,
  cardRevisionOutputSchema,
  MAX_REVISABLE_CARDS,
  MAX_REVISION_INSTRUCTION_LENGTH,
  toProposedChanges,
} from '../ai/cardRevision.js';
import {
  deckOrder,
  editCard,
  primaryAnswerText,
  withCanonicalAnswers,
} from '../services/cards.js';
import { findCountedAttempts, isCorrect } from '../services/countedAttempts.js';
import { matchAnswer } from '../services/answerGrader.js';
import {
  assertDeckActive,
  findActiveDeck,
  findOwnedDeck,
} from '../services/decks.js';

const text = z.string().trim().min(1);
const proposalSource = z.string().min(1).max(100);
const instruction = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REVISION_INSTRUCTION_LENGTH);

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

      return deck;
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

    // Fetch counted attempt stats per deck in a single query
    const deckIds = decks.map((d) => d.id);
    const attemptsByDeck = new Map<
      string,
      { total: number; correct: number }
    >();

    if (deckIds.length > 0) {
      const attempts = await findCountedAttempts(ctx.prisma, {
        userId: ctx.userId,
        deckIds,
      });

      for (const attempt of attempts) {
        const stats = attemptsByDeck.get(attempt.deckId) ?? {
          total: 0,
          correct: 0,
        };
        stats.total++;
        if (isCorrect(attempt.recallGrade)) stats.correct++;
        attemptsByDeck.set(attempt.deckId, stats);
      }
    }

    return decks.map((deck) => {
      const stats = attemptsByDeck.get(deck.id) ?? { total: 0, correct: 0 };
      const accuracy = stats.total === 0 ? 0 : stats.correct / stats.total;

      return {
        id: deck.id,
        name: deck.name,
        description: deck.description,
        createdAt: deck.createdAt,
        updatedAt: deck.updatedAt,
        userId: deck.userId,
        course: deck.course,
        cardCount: deck._count.cards,
        totalAttempts: stats.total,
        accuracy,
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

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.id,
      });

      return ctx.prisma.deck.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
        },
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
        system: CARD_REVISION_SYSTEM_PROMPT,
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
});
