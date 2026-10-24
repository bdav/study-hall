import { initTRPC, TRPCError } from '@trpc/server';
import { type PrismaClient } from '@prisma/client';
import { type Context } from '../context.js';
import { AI_ACCESS_DENIED_MESSAGE, userCanUseAI } from '../ai/access.js';
import { AI_PAUSED_MESSAGE, isAiPaused } from '../ai/spend.js';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Procedure that requires an authenticated user.
 * Throws UNAUTHORIZED if no valid session is present.
 * Narrows ctx.userId from `string | null` to `string`.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId, // narrowed to string
    },
  });
});

/** Throws FORBIDDEN unless the user passes `canUseAI`. */
export async function assertCanUseAI(
  prisma: PrismaClient,
  userId: string,
  message = AI_ACCESS_DENIED_MESSAGE,
) {
  if (!(await userCanUseAI(prisma, userId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}

/**
 * Throws TOO_MANY_REQUESTS once this month's AI spend reaches the cap, so
 * no model call is made.
 */
export async function assertAiNotPaused(prisma: PrismaClient) {
  if (await isAiPaused(prisma)) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: AI_PAUSED_MESSAGE,
    });
  }
}

/**
 * Procedure for users who pass `canUseAI`; throws FORBIDDEN otherwise. For
 * AI information, such as spend against the cap, that stays readable while
 * AI is paused.
 */
export const aiAccessProcedure = protectedProcedure.use(
  async ({ ctx, next }) => {
    await assertCanUseAI(ctx.prisma, ctx.userId);
    return next();
  },
);

/**
 * Procedure for AI-backed capabilities: requires an authenticated user who
 * passes `canUseAI`, and throws FORBIDDEN otherwise. Once this month's AI
 * spend reaches the cap it throws TOO_MANY_REQUESTS before any model call.
 */
export const aiProcedure = aiAccessProcedure.use(async ({ ctx, next }) => {
  await assertAiNotPaused(ctx.prisma);
  return next();
});
