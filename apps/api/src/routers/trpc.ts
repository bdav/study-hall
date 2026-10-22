import { initTRPC, TRPCError } from '@trpc/server';
import { type Context } from '../context.js';
import { AI_ACCESS_DENIED_MESSAGE, canUseAI } from '../ai/access.js';

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

/**
 * Procedure for AI-backed capabilities: requires an authenticated user who
 * passes `canUseAI`. Throws FORBIDDEN otherwise.
 */
export const aiProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { email: true },
  });

  if (!user || !canUseAI(user)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: AI_ACCESS_DENIED_MESSAGE,
    });
  }

  return next();
});
