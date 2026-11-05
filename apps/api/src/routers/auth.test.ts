import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
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
function createPublicCaller(clientIp?: string) {
  const cookies: Record<string, string> = {};
  return {
    caller: appRouter.createCaller({
      prisma,
      userId: null,
      sessionToken: null,
      clientIp,
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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('signup', () => {
    beforeEach(() => {
      vi.stubEnv(
        'SIGNUP_ALLOWED_EMAILS',
        'test@example.com,duplicate@example.com',
      );
    });

    it('refuses an email off the signup allowlist, creating nothing', async () => {
      const { caller, cookies } = createPublicCaller();

      await expect(
        caller.auth.signup({
          email: 'stranger@example.com',
          password: 'password123',
        }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Signup is by invitation only.',
      });

      expect(
        await prisma.user.count({ where: { email: 'stranger@example.com' } }),
      ).toBe(0);
      expect(cookies.session_token).toBeUndefined();
    });

    it('stores an email in lowercase, however it was typed', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', 'Stored.Lower@Example.com');
      const { caller } = createPublicCaller();

      const { user } = await caller.auth.signup({
        email: 'STORED.lower@example.COM',
        password: 'password123',
      });

      expect(user.email).toBe('stored.lower@example.com');
    });

    it('treats an email in another case as the same account', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', 'ONE.account@Example.com');
      const { caller } = createPublicCaller();
      await caller.auth.signup({
        email: 'One.Account@example.com',
        password: 'password123',
      });

      await expect(
        caller.auth.signup({
          email: 'one.account@example.com',
          password: 'password456',
        }),
      ).rejects.toThrow(/already exists/i);
    });

    it('refuses everyone while the signup allowlist is unset', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', undefined);
      const { caller } = createPublicCaller();

      await expect(
        caller.auth.signup({
          email: 'test@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Signup is by invitation only.');
    });

    it('matches the signup allowlist ignoring case and whitespace', async () => {
      vi.stubEnv(
        'SIGNUP_ALLOWED_EMAILS',
        ' first@example.com ,  Mixed.Case@Example.com,,',
      );
      const { caller } = createPublicCaller();

      await expect(
        caller.auth.signup({
          email: 'first@example.com',
          password: 'password123',
        }),
      ).resolves.toBeDefined();
      await expect(
        caller.auth.signup({
          email: 'mixed.CASE@example.com',
          password: 'password123',
        }),
      ).resolves.toBeDefined();
    });

    it("doesn't say whether a refused email has an account", async () => {
      await prisma.user.create({
        data: { email: 'existing@example.com', passwordHash: 'hash' },
      });
      const { caller } = createPublicCaller();

      await expect(
        caller.auth.signup({
          email: 'existing@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Signup is by invitation only.');
    });

    it('never treats the AI allowlist as an invitation', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', undefined);
      vi.stubEnv('AI_ALLOWED_EMAILS', 'ai-only@example.com');
      const { caller } = createPublicCaller();

      await expect(
        caller.auth.signup({
          email: 'ai-only@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Signup is by invitation only.');
    });

    it('never gives an invited email AI access', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', 'invited@example.com');
      vi.stubEnv('AI_ALLOWED_EMAILS', undefined);
      const { caller } = createPublicCaller();

      const { user } = await caller.auth.signup({
        email: 'invited@example.com',
        password: 'password123',
      });

      const me = await createAuthenticatedCaller(user.id).caller.auth.me();
      expect(me.user?.canUseAI).toBe(false);
    });

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
    it('finds an account whatever the case of the email', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', 'Any.CASE@Example.com');
      const { caller, cookies } = createPublicCaller();
      await caller.auth.signup({
        email: 'Any.Case@example.com',
        password: 'password123',
      });
      delete cookies.session_token;

      const { user } = await caller.auth.login({
        email: 'ANY.CASE@EXAMPLE.COM',
        password: 'password123',
      });

      expect(user.email).toBe('any.case@example.com');
      expect(cookies.session_token).toBeDefined();
    });

    it('gives the same message for a wrong password as an unknown email, in any case', async () => {
      await prisma.user.create({
        data: {
          email: 'same.message@example.com',
          passwordHash: await hashPassword('mypassword'),
        },
      });
      const { caller } = createPublicCaller();

      await expect(
        caller.auth.login({
          email: 'SAME.MESSAGE@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('Invalid email or password');
      await expect(
        caller.auth.login({
          email: 'NOBODY@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('Invalid email or password');
    });

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

  describe('limits on attempts', () => {
    const TOO_MANY = 'Too many attempts. Please wait 15 minutes and try again.';

    async function failLogins(
      count: number,
      attempt: (i: number) => { email: string; clientIp?: string },
    ) {
      for (let i = 0; i < count; i++) {
        const { email, clientIp } = attempt(i);
        await expect(
          createPublicCaller(clientIp).caller.auth.login({
            email,
            password: 'wrongpassword',
          }),
        ).rejects.toThrow('Invalid email or password');
      }
    }

    async function createLearner(email: string) {
      await prisma.user.create({
        data: { email, passwordHash: await hashPassword('mypassword') },
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('refuses an email past 10 logins, even with the right password', async () => {
      await createLearner('limited@example.com');
      await failLogins(10, () => ({ email: 'limited@example.com' }));

      await expect(
        createPublicCaller().caller.auth.login({
          email: 'limited@example.com',
          password: 'mypassword',
        }),
      ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', message: TOO_MANY });
    });

    it('allows the 10th login for an email', async () => {
      await createLearner('tenth@example.com');
      await failLogins(9, () => ({ email: 'tenth@example.com' }));

      await expect(
        createPublicCaller().caller.auth.login({
          email: 'tenth@example.com',
          password: 'mypassword',
        }),
      ).resolves.toBeDefined();
    });

    it('counts an email whatever its case, from any address', async () => {
      await failLogins(10, (i) => ({
        email: i % 2 ? 'SPREAD@example.com' : 'spread@example.com',
        clientIp: `192.0.2.${i}`,
      }));

      await expect(
        createPublicCaller('192.0.2.200').caller.auth.login({
          email: 'spread@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(TOO_MANY);
    });

    it('refuses an address past 30 logins, across any emails', async () => {
      const clientIp = '198.51.100.1';
      await failLogins(30, (i) => ({
        email: `guess-${i}@example.com`,
        clientIp,
      }));

      await expect(
        createPublicCaller(clientIp).caller.auth.login({
          email: 'one-more-guess@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(TOO_MANY);
      await expect(
        createPublicCaller('198.51.100.2').caller.auth.login({
          email: 'one-more-guess@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('Invalid email or password');
    });

    it("doesn't count refused addresses against an email", async () => {
      const clientIp = '198.51.100.3';
      await failLogins(30, (i) => ({
        email: `noise-${i}@example.com`,
        clientIp,
      }));
      await createLearner('bystander@example.com');
      for (let i = 0; i < 10; i++) {
        await expect(
          createPublicCaller(clientIp).caller.auth.login({
            email: 'bystander@example.com',
            password: 'wrongpassword',
          }),
        ).rejects.toThrow(TOO_MANY);
      }

      await expect(
        createPublicCaller('198.51.100.4').caller.auth.login({
          email: 'bystander@example.com',
          password: 'mypassword',
        }),
      ).resolves.toBeDefined();
    });

    it('lets logins back in 15 minutes later', async () => {
      vi.useFakeTimers({
        toFake: ['Date'],
        now: new Date('2026-11-05T12:00:00Z'),
      });
      await failLogins(10, () => ({ email: 'patient@example.com' }));

      vi.setSystemTime(new Date('2026-11-05T12:15:00Z'));

      await expect(
        createPublicCaller().caller.auth.login({
          email: 'patient@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow('Invalid email or password');
    });

    describe('signing up', () => {
      async function refusedSignups(count: number, clientIp: string) {
        for (let i = 0; i < count; i++) {
          await expect(
            createPublicCaller(clientIp).caller.auth.signup({
              email: `uninvited-${i}@example.com`,
              password: 'password123',
            }),
          ).rejects.toThrow('Signup is by invitation only.');
        }
      }

      beforeEach(() => {
        vi.stubEnv('SIGNUP_ALLOWED_EMAILS', 'Patient.Signup@example.com');
      });

      it('refuses an address past 10 signups, even for an invited email', async () => {
        await refusedSignups(10, '203.0.113.10');

        await expect(
          createPublicCaller('203.0.113.10').caller.auth.signup({
            email: 'patient.signup@example.com',
            password: 'password123',
          }),
        ).rejects.toMatchObject({
          code: 'TOO_MANY_REQUESTS',
          message: TOO_MANY,
        });
      });

      it('allows another address, and the same one 15 minutes later', async () => {
        vi.useFakeTimers({
          toFake: ['Date'],
          now: new Date('2026-11-05T12:00:00Z'),
        });
        await refusedSignups(10, '203.0.113.11');

        await expect(
          createPublicCaller('203.0.113.12').caller.auth.signup({
            email: 'uninvited@example.com',
            password: 'password123',
          }),
        ).rejects.toThrow('Signup is by invitation only.');

        vi.setSystemTime(new Date('2026-11-05T12:15:00Z'));

        await expect(
          createPublicCaller('203.0.113.11').caller.auth.signup({
            email: 'uninvited@example.com',
            password: 'password123',
          }),
        ).rejects.toThrow('Signup is by invitation only.');
      });
    });
  });

  describe('expired login sessions', () => {
    const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);
    const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

    async function createUserWithPassword(email: string) {
      return prisma.user.create({
        data: { email, passwordHash: await hashPassword('mypassword') },
      });
    }

    async function tokensLeft(tokens: string[]) {
      const sessions = await prisma.session.findMany({
        where: { token: { in: tokens } },
      });
      return sessions.map((session) => session.token).sort();
    }

    it('are cleared by a login, whoever they belong to, leaving unexpired ones', async () => {
      const learner = await createUserWithPassword('cleanup@example.com');
      const other = await createUserWithPassword('cleanup-other@example.com');
      await prisma.session.createMany({
        data: [
          { token: 'own-expired', userId: learner.id, expiresAt: anHourAgo() },
          { token: 'own-live', userId: learner.id, expiresAt: inOneHour() },
          { token: 'other-expired', userId: other.id, expiresAt: anHourAgo() },
          { token: 'other-live', userId: other.id, expiresAt: inOneHour() },
        ],
      });

      await createPublicCaller().caller.auth.login({
        email: 'cleanup@example.com',
        password: 'mypassword',
      });

      expect(
        await tokensLeft([
          'own-expired',
          'own-live',
          'other-expired',
          'other-live',
        ]),
      ).toEqual(['other-live', 'own-live']);
    });

    it('stay when a login fails', async () => {
      const learner = await createUserWithPassword('failed-login@example.com');
      await prisma.session.create({
        data: {
          token: 'still-expired',
          userId: learner.id,
          expiresAt: anHourAgo(),
        },
      });

      await expect(
        createPublicCaller().caller.auth.login({
          email: 'failed-login@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow();

      expect(await tokensLeft(['still-expired'])).toEqual(['still-expired']);
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
    beforeEach(() => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', 'logout@example.com');
    });

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
