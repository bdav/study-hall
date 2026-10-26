import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from './trpc.js';
import {
  addAcceptedVariant,
  createCards,
  deckOrder,
  editCard,
  primaryAnswerText,
  removeAcceptedVariant,
  withCanonicalAnswers,
} from '../services/cards.js';

const front = z.string().trim().min(1);
const canonicalAnswer = z.string().trim().min(1);
const variantText = z.string().trim().min(1);

export const cardRouter = router({
  create: protectedProcedure
    .input(z.object({ deckId: z.string(), front, canonicalAnswer }))
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

      const duplicate = await ctx.prisma.card.findFirst({
        where: {
          deckId: input.deckId,
          front: { equals: input.front, mode: 'insensitive' },
        },
        include: withCanonicalAnswers,
      });

      return ctx.prisma.$transaction(async (tx) => {
        if (duplicate) {
          const answer = primaryAnswerText(duplicate);
          if (answer.toLowerCase() === input.canonicalAnswer.toLowerCase()) {
            return duplicate;
          }
          return editCard(tx, {
            cardId: duplicate.id,
            canonicalAnswer: input.canonicalAnswer,
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
          canonicalAnswer: canonicalAnswer.optional(),
        })
        .refine(
          (d) => d.front !== undefined || d.canonicalAnswer !== undefined,
          {
            message:
              'At least one of front or canonical answer must be provided',
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const card = await ctx.prisma.card.findUnique({
        where: { id: input.cardId },
        include: { deck: { select: { userId: true } } },
      });

      if (!card || card.deck.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Card not found',
        });
      }

      return ctx.prisma.$transaction((tx) => editCard(tx, input));
    }),

  delete: protectedProcedure
    .input(z.object({ cardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const card = await ctx.prisma.card.findUnique({
        where: { id: input.cardId },
        include: { deck: { select: { userId: true } } },
      });

      if (!card || card.deck.userId !== ctx.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Card not found',
        });
      }

      await ctx.prisma.card.delete({
        where: { id: input.cardId },
      });

      return { success: true };
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

      return ctx.prisma.card.findMany({
        where: { deckId: input.deckId },
        orderBy: deckOrder,
        include: withCanonicalAnswers,
      });
    }),

  importCards: protectedProcedure
    .input(
      z.object({
        deckId: z.string(),
        new: z.array(z.object({ front, canonicalAnswer })),
        update: z.array(z.object({ cardId: z.string(), canonicalAnswer })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deck = await ctx.prisma.deck.findUnique({
        where: { id: input.deckId, userId: ctx.userId },
      });

      if (!deck) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deck not found',
        });
      }

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
          await editCard(tx, card);
        }

        return {
          createdCount: input.new.length,
          updatedCount: input.update.length,
        };
      });
    }),

  addVariant: protectedProcedure
    .input(z.object({ canonicalAnswerId: z.string(), text: variantText }))
    .mutation(async ({ ctx, input }) => {
      const answer = await ctx.prisma.canonicalAnswer.findFirst({
        where: {
          id: input.canonicalAnswerId,
          card: { deck: { userId: ctx.userId } },
        },
      });

      if (!answer) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Canonical answer not found',
        });
      }

      return addAcceptedVariant(ctx.prisma, input);
    }),

  removeVariant: protectedProcedure
    .input(z.object({ variantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const variant = await ctx.prisma.acceptedVariant.findFirst({
        where: {
          id: input.variantId,
          canonicalAnswer: { card: { deck: { userId: ctx.userId } } },
        },
      });

      if (!variant) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Accepted variant not found',
        });
      }

      return removeAcceptedVariant(ctx.prisma, input);
    }),
});
