import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from './trpc.js';
import {
  createCards,
  deckOrder,
  editCard,
  markCardsKnown,
  restoreCardVersion,
  withCanonicalAnswers,
} from '../services/cards.js';
import { cardHistory } from '../services/cardHistory.js';
import { isKnown } from '../services/progressUpdater.js';
import { assertCanChangeCards, findActiveDeck } from '../services/decks.js';

const front = z.string().trim().min(1);
const answerText = z.string().trim().min(1);
// A card's Canonical Answers, primary first
const canonicalAnswers = z.array(answerText).min(1);
const variantText = z.string().trim().min(1);
// Cards acted on together: one, or a selection from the Cards tab
const cardIds = z.array(z.string()).min(1).max(1000);

export const cardRouter = router({
  create: protectedProcedure
    .input(z.object({ deckId: z.string(), front, canonicalAnswers }))
    .mutation(async ({ ctx, input }) => {
      await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });

      const duplicate = await ctx.prisma.card.findFirst({
        where: {
          deckId: input.deckId,
          front: { equals: input.front, mode: 'insensitive' },
        },
        include: withCanonicalAnswers,
      });

      return ctx.prisma.$transaction(async (tx) => {
        if (duplicate) {
          const sameAnswers = (answers: string[]) =>
            answers.map((answer) => answer.toLowerCase()).join('\n');
          if (
            sameAnswers(duplicate.canonicalAnswers.map((a) => a.text)) ===
            sameAnswers(input.canonicalAnswers)
          ) {
            return duplicate;
          }
          return editCard(tx, {
            cardId: duplicate.id,
            canonicalAnswers: input.canonicalAnswers.map((text) => ({ text })),
          });
        }

        const [card] = await createCards(tx, {
          deckId: input.deckId,
          userId: ctx.userId,
          cards: [input],
        });
        return card;
      });
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          cardId: z.string(),
          front: front.optional(),
          // In full, primary first; an existing answer by its id, with all
          // its Accepted Variants when listed
          canonicalAnswers: z
            .array(
              z.object({
                id: z.string().optional(),
                text: answerText,
                acceptedVariants: z.array(variantText).optional(),
              }),
            )
            .min(1)
            .optional(),
        })
        .refine(
          (d) => d.front !== undefined || d.canonicalAnswers !== undefined,
          {
            message:
              'At least one of front or canonical answers must be provided',
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanChangeCards(ctx.prisma, {
        userId: ctx.userId,
        cardIds: [input.cardId],
      });

      return ctx.prisma.$transaction((tx) => editCard(tx, input));
    }),

  delete: protectedProcedure
    .input(z.object({ cardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanChangeCards(ctx.prisma, {
        userId: ctx.userId,
        cardIds: [input.cardId],
      });

      await ctx.prisma.card.delete({
        where: { id: input.cardId },
      });

      return { success: true };
    }),

  /**
   * Marks cards known (ADR-0009): a timing adjustment, not a grade, so it
   * records no attempt (`markCardsKnown`).
   */
  markKnown: protectedProcedure
    .input(z.object({ cardIds }))
    .mutation(async ({ ctx, input }) => {
      await assertCanChangeCards(ctx.prisma, {
        userId: ctx.userId,
        cardIds: input.cardIds,
      });
      return markCardsKnown(ctx.prisma, {
        userId: ctx.userId,
        cardIds: input.cardIds,
      });
    }),

  /** Deletes several cards, as `delete` deletes one. */
  deleteMany: protectedProcedure
    .input(z.object({ cardIds }))
    .mutation(async ({ ctx, input }) => {
      await assertCanChangeCards(ctx.prisma, {
        userId: ctx.userId,
        cardIds: input.cardIds,
      });
      const { count } = await ctx.prisma.card.deleteMany({
        where: { id: { in: input.cardIds } },
      });
      return { deletedCount: count };
    }),

  // The learner's answers to a card, by Card Version, and its progress
  history: protectedProcedure
    .input(z.object({ cardId: z.string() }))
    .query(({ ctx, input }) =>
      cardHistory(ctx.prisma, { userId: ctx.userId, cardId: input.cardId }),
    ),

  /** Puts a card back to asking what an earlier Card Version asked (#54). */
  restoreVersion: protectedProcedure
    .input(z.object({ cardId: z.string(), versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanChangeCards(ctx.prisma, {
        userId: ctx.userId,
        cardIds: [input.cardId],
      });
      return ctx.prisma.$transaction((tx) => restoreCardVersion(tx, input));
    }),

  listByDeck: protectedProcedure
    .input(z.object({ deckId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      const cards = await ctx.prisma.card.findMany({
        where: { deckId: input.deckId },
        orderBy: deckOrder,
        include: {
          ...withCanonicalAnswers,
          progress: {
            where: { userId: ctx.userId },
            select: { lifecycleState: true },
          },
        },
      });
      // Whether each card is known already, so marking it known does nothing
      return cards.map(({ progress: [progress], ...card }) => ({
        ...card,
        isKnown: progress ? isKnown(progress.lifecycleState) : false,
      }));
    }),

  importCards: protectedProcedure
    .input(
      z.object({
        deckId: z.string(),
        new: z.array(z.object({ front, canonicalAnswers })),
        update: z.array(z.object({ cardId: z.string(), canonicalAnswers })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await findActiveDeck(ctx.prisma, {
        userId: ctx.userId,
        deckId: input.deckId,
      });

      // Validate that all update cards belong to this deck
      if (input.update.length > 0) {
        const updateIds = input.update.map((c) => c.cardId);
        const existingCards = await ctx.prisma.card.findMany({
          where: { id: { in: updateIds } },
        });
        const existingByDeck = new Set(
          existingCards
            .filter((c) => c.deckId === input.deckId)
            .map((c) => c.id),
        );
        for (const id of updateIds) {
          if (!existingByDeck.has(id)) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Card does not belong to this deck',
            });
          }
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        await createCards(tx, {
          deckId: input.deckId,
          userId: ctx.userId,
          cards: input.new,
        });

        for (const card of input.update) {
          await editCard(tx, {
            cardId: card.cardId,
            canonicalAnswers: card.canonicalAnswers.map((text) => ({ text })),
          });
        }

        return {
          createdCount: input.new.length,
          updatedCount: input.update.length,
        };
      });
    }),
});
