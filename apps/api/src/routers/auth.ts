import { randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from './trpc.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { SESSION_DURATION_MS } from '../context.js';
import { canUseAI } from '../ai/access.js';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  /** Cookie max-age in milliseconds. Express converts to seconds for Set-Cookie. */
  maxAge: SESSION_DURATION_MS,
};

/** Generate a cryptographically secure session token. */
function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.email(),
        password: z.string().min(8, 'Password must be at least 8 characters'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this email already exists',
        });
      }

      const passwordHash = await hashPassword(input.password);

      const user = await ctx.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
        },
      });

      const token = generateSessionToken();
      await ctx.prisma.session.create({
        data: {
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        },
      });

      ctx.setCookie?.('session_token', token, COOKIE_OPTIONS);

      return {
        user: { id: user.id, email: user.email },
      };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string(),
        password: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { email: input.email },
      });

      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        });
      }

      const valid = await verifyPassword(input.password, user.passwordHash);

      if (!valid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        });
      }

      const token = generateSessionToken();
      await ctx.prisma.session.create({
        data: {
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
        },
      });

      ctx.setCookie?.('session_token', token, COOKIE_OPTIONS);

      return {
        user: { id: user.id, email: user.email },
      };
    }),

  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.userId) {
      return { user: null };
    }

    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.userId },
    });

    if (!user) {
      return { user: null };
    }

    return {
      user: { id: user.id, email: user.email, canUseAI: canUseAI(user) },
    };
  }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    // Delete only the current session, not all sessions for this user
    if (ctx.sessionToken) {
      await ctx.prisma.session.deleteMany({
        where: { token: ctx.sessionToken },
      });
    }

    ctx.clearCookie?.('session_token', { path: '/' });

    return { success: true };
  }),
});
