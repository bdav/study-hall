import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestPrisma } from '../test-helpers.js';
import { appRouter } from './index.js';
import { createFakeAiProvider } from '../ai/fakeProvider.js';
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../auth/password.js';

let prisma: PrismaClient;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const testDb = createTestPrisma();
  prisma = testDb.prisma;
  cleanup = testDb.cleanup;
});

afterAll(async () => {
  await cleanup();
});

/** Create an unauthenticated caller (no session). */
function createPublicCaller() {
  const cookies: Record<string, string> = {};
  return {
    caller: appRouter.createCaller({
      prisma,
      userId: null,
      sessionToken: null,
      ai: createFakeAiProvider(),
      setCookie: (name: string, value: string) => {
        cookies[name] = value;
      },
      clearCookie: (name: string) => {
        delete cookies[name];
      },
    }),
    cookies,
  };
}

/** Create an authenticated caller for a given userId, optionally with a session token. */
function createAuthenticatedCaller(
  userId: string,
  options?: {
    sessionToken?: string;
    cookies?: Record<string, string>;
  },
) {
  const cookies = options?.cookies ?? {};
  return {
    caller: appRouter.createCaller({
      prisma,
      userId,
      sessionToken: options?.sessionToken ?? null,
      ai: createFakeAiProvider(),
      setCookie: (name: string, value: string) => {
        cookies[name] = value;
      },
      clearCookie: (name: string) => {
        delete cookies[name];
      },
    }),
    cookies,
  };
}

describe('auth router', () => {
  describe('signup', () => {
    it('creates a user and returns user data', async () => {
      const { caller, cookies } = createPublicCaller();
      const result = await caller.auth.signup({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.user.id).toBeDefined();
      expect(result.user).not.toHaveProperty('passwordHash');
      // Session cookie should be set with a crypto-random token (64 hex chars)
      expect(cookies.session_token).toBeDefined();
      expect(cookies.session_token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects duplicate email', async () => {
      // Explicitly create the user so this test is self-contained
      const hash = await hashPassword('password123');
      await prisma.user.upsert({
        where: { email: 'duplicate@example.com' },
        update: {},
        create: { email: 'duplicate@example.com', passwordHash: hash },
      });

      const { caller } = createPublicCaller();
      await expect(
        caller.auth.signup({
          email: 'duplicate@example.com',
          password: 'password456',
        }),
      ).rejects.toThrow(/already exists/i);
    });

    it('rejects invalid email', async () => {
      const { caller } = createPublicCaller();
      await expect(
        caller.auth.signup({
          email: 'not-an-email',
          password: 'password123',
        }),
      ).rejects.toThrow();
    });

    it('rejects password shorter than 8 characters', async () => {
      const { caller } = createPublicCaller();
      await expect(
        caller.auth.signup({
          email: 'short@example.com',
          password: 'short',
        }),
      ).rejects.toThrow();
    });
  });

  describe('login', () => {
    it('logs in with correct credentials and sets session cookie', async () => {
      const hash = await hashPassword('mypassword');
      const user = await prisma.user.create({
        data: {
          email: 'login@example.com',
          passwordHash: hash,
        },
      });

      const { caller, cookies } = createPublicCaller();
      const result = await caller.auth.login({
        email: 'login@example.com',
        password: 'mypassword',
      });

      expect(result.user.email).toBe('login@example.com');
      expect(result.user.id).toBe(user.id);
      expect(cookies.session_token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects invalid email', async () => {
      const { caller } = createPublicCaller();
      await expect(
        caller.auth.login({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(/invalid email or password/i);
    });

    it('rejects wrong password', async () => {
      const hash = await hashPassword('correctpassword');
      await prisma.user.create({
        data: {
          email: 'wrongpass@example.com',
          passwordHash: hash,
        },
      });

      const { caller } = createPublicCaller();
      await expect(
        caller.auth.login({
          email: 'wrongpass@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(/invalid email or password/i);
    });
  });

  describe('me', () => {
    it('returns current user when authenticated', async () => {
      const hash = await hashPassword('testpass');
      const user = await prisma.user.create({
        data: {
          email: 'me@example.com',
          passwordHash: hash,
        },
      });

      const { caller } = createAuthenticatedCaller(user.id);
      const result = await caller.auth.me();

      expect(result.user?.email).toBe('me@example.com');
      expect(result.user?.id).toBe(user.id);
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('returns null when not authenticated', async () => {
      const { caller } = createPublicCaller();
      const result = await caller.auth.me();

      expect(result.user).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears the session cookie and deletes only the current session', async () => {
      // Signup to create a session
      const { caller: signupCaller, cookies } = createPublicCaller();
      await signupCaller.auth.signup({
        email: 'logout@example.com',
        password: 'password123',
      });

      const sessionToken = cookies.session_token;
      expect(sessionToken).toBeDefined();

      // Verify session exists in DB
      const sessionBefore = await prisma.session.findUnique({
        where: { token: sessionToken },
      });
      expect(sessionBefore).not.toBeNull();

      // Create a second session for the same user (simulating another device)
      const secondSession = await prisma.session.create({
        data: {
          token: 'other-device-token',
          userId: sessionBefore!.userId,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      });

      // Logout with the first session token
      const { caller: logoutCaller, cookies: logoutCookies } =
        createAuthenticatedCaller(sessionBefore!.userId, {
          sessionToken,
          cookies,
        });

      await logoutCaller.auth.logout();

      // First session should be deleted
      const sessionAfter = await prisma.session.findUnique({
        where: { token: sessionToken },
      });
      expect(sessionAfter).toBeNull();

      // Second session should still exist
      const secondSessionAfter = await prisma.session.findUnique({
        where: { id: secondSession.id },
      });
      expect(secondSessionAfter).not.toBeNull();

      // Cookie should be cleared
      expect(logoutCookies.session_token).toBeUndefined();
    });
  });

  describe('protected procedure rejection', () => {
    it('rejects unauthenticated access to protected procedures', async () => {
      const { caller } = createPublicCaller();
      await expect(caller.deck.list()).rejects.toThrow(/logged in/i);
    });
  });
});
