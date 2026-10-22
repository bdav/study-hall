import { type PrismaClient } from '@prisma/client';
import { prisma } from './db.js';
import { type AiProvider } from './ai/provider.js';
import { createAnthropicProvider } from './ai/anthropicProvider.js';

export type Context = {
  prisma: PrismaClient;
  userId: string | null;
  /** The current session token, if authenticated. Used for single-session logout. */
  sessionToken: string | null;
  /** Every model call goes through this. Tests supply a fake. */
  ai: AiProvider;
  /** Set a cookie on the response. Only available in HTTP context (not in test callers). */
  setCookie?: (name: string, value: string, options: CookieOptions) => void;
  /** Clear a cookie on the response. Only available in HTTP context. */
  clearCookie?: (name: string, options: CookieOptions) => void;
};

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  /** Cookie max-age in milliseconds. Express converts to seconds for the Set-Cookie header. */
  maxAge?: number;
  path?: string;
};

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ai = createAnthropicProvider();

/**
 * Creates tRPC context from an Express request.
 * Looks up session from the `session_token` cookie using the crypto-random token.
 */
export async function createContext({
  req,
  res,
}: {
  req: { cookies?: Record<string, string> };
  res: {
    cookie: (name: string, value: string, options: CookieOptions) => void;
    clearCookie: (name: string, options: CookieOptions) => void;
  };
}): Promise<Context> {
  const token = req.cookies?.session_token;
  let userId: string | null = null;

  if (token) {
    const session = await prisma.session.findUnique({
      where: { token },
    });

    if (session && session.expiresAt > new Date()) {
      userId = session.userId;
    }
    // TODO: Add periodic cleanup job for expired sessions (they accumulate in DB)
  }

  return {
    prisma,
    userId,
    sessionToken: token ?? null,
    ai,
    setCookie: (name, value, options) => res.cookie(name, value, options),
    clearCookie: (name, options) => res.clearCookie(name, options),
  };
}

export { SESSION_DURATION_MS };
