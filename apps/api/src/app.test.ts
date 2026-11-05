import { once } from 'events';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { type AnyRouter, initTRPC, TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppRouter } from './app.js';
import { prisma } from './db.js';
import { type LogEntry } from './observability.js';

vi.mock('./db.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
  },
}));

function recordingApp(router?: AnyRouter) {
  const logged: LogEntry[] = [];
  const reported: { error: unknown; where: object }[] = [];
  const app = createApp({
    log: (entry) => logged.push(entry),
    reportError: (error, where) => reported.push({ error, where }),
    router,
  });
  return { app, logged, reported };
}

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(recordingApp().app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('tRPC healthCheck', () => {
  it('returns ok', async () => {
    const res = await request(recordingApp().app).get('/trpc/healthCheck');
    expect(res.status).toBe(200);
    expect(res.body.result.data).toEqual({ ok: true });
  });
});

describe('the limit on every request', { timeout: 30_000 }, () => {
  const REQUESTS_A_MINUTE = 300;
  let server: Server;

  /** One server for the test, as supertest would start one per request. */
  async function serve() {
    const { app } = recordingApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
  }

  function get(headers: Record<string, string> = {}) {
    return request(server).get('/health').set(headers);
  }

  async function sendRequests(count: number, headers?: Record<string, string>) {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) {
      statuses.push((await get(headers)).status);
    }
    return statuses;
  }

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('lets a client make 300 requests in a minute', async () => {
    await serve();

    const statuses = await sendRequests(REQUESTS_A_MINUTE);

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('refuses the next request with HTTP 429', async () => {
    await serve();
    await sendRequests(REQUESTS_A_MINUTE);

    expect((await get()).status).toBe(429);
  });

  it('lets a client back in once the minute is over', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-11-05T12:00:00Z'),
    });
    await serve();
    await sendRequests(REQUESTS_A_MINUTE + 1);

    vi.setSystemTime(new Date('2026-11-05T12:01:00Z'));

    expect((await get()).status).toBe(200);
  });

  it('says why, in a way the web app can read', async () => {
    await serve();
    await sendRequests(REQUESTS_A_MINUTE);
    const { port } = server.address() as AddressInfo;
    const client = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `http://127.0.0.1:${port}/trpc` })],
    });

    await expect(client.healthCheck.query()).rejects.toMatchObject({
      message: 'Too many requests. Please wait a minute and try again.',
      data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
    });
  });

  describe('in production, behind the proxy', () => {
    const clientHeaders = { 'X-Real-IP': '203.0.113.1' };

    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('counts each client by the address the proxy gives', async () => {
      await serve();
      await sendRequests(REQUESTS_A_MINUTE, clientHeaders);

      expect((await get(clientHeaders)).status).toBe(429);
      expect((await get({ 'X-Real-IP': '203.0.113.2' })).status).toBe(200);
    });

    it('limits signing up by the address the proxy gives', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', '');
      await serve();
      const signUp = (address: string) =>
        request(server)
          .post('/trpc/auth.signup')
          .set('X-Real-IP', address)
          .send({ email: 'someone@example.com', password: 'password123' });

      for (let i = 0; i < 10; i++) {
        expect((await signUp('203.0.113.20')).status).toBe(403);
      }

      const refused = await signUp('203.0.113.20');
      expect(refused.status).toBe(429);
      expect(refused.body.error.message).toBe(
        'Too many attempts. Please wait 15 minutes and try again.',
      );
      expect((await signUp('203.0.113.21')).status).toBe(403);
    });

    it('uses the connection when the proxy gives an empty address', async () => {
      vi.stubEnv('SIGNUP_ALLOWED_EMAILS', '');
      await serve();
      const signUp = () =>
        request(server)
          .post('/trpc/auth.signup')
          .set('X-Real-IP', '')
          .send({ email: 'someone@example.com', password: 'password123' });

      for (let i = 0; i < 10; i++) {
        expect((await signUp()).status).toBe(403);
      }

      expect((await signUp()).status).toBe(429);
    });

    it('ignores a forwarded-for address, which a client can write', async () => {
      await serve();
      await sendRequests(REQUESTS_A_MINUTE, clientHeaders);

      const res = await get({
        ...clientHeaders,
        'X-Forwarded-For': '198.51.100.7',
      });

      expect(res.status).toBe(429);
    });
  });

  it("doesn't take a client's word for its address outside production", async () => {
    await serve();
    await sendRequests(REQUESTS_A_MINUTE, { 'X-Real-IP': '203.0.113.1' });

    expect((await get({ 'X-Real-IP': '203.0.113.2' })).status).toBe(429);
  });
});

describe('request logs and error reports', () => {
  const requestLine = {
    level: 'info',
    message: 'request',
    durationMs: expect.any(Number),
  };

  /** Once the response has closed, which is when a request is logged. */
  async function requestLines(logged: LogEntry[], count = 1) {
    await vi.waitFor(() => expect(logged.length).toBeGreaterThanOrEqual(count));
    return logged.filter((entry) => entry.message === 'request');
  }

  function logIn(app: ReturnType<typeof createApp>, email: string) {
    return request(app)
      .post('/trpc/auth.login')
      .send({ email, password: 'secret-password' });
  }

  afterEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
    vi.mocked(prisma.session.findUnique).mockReset();
  });

  it('logs one line for a request: route, status and how long it took', async () => {
    const { app, logged } = recordingApp();

    await request(app).get('/health');

    expect(await requestLines(logged)).toEqual([
      {
        ...requestLine,
        method: 'GET',
        route: '/health',
        userId: null,
        status: 200,
      },
    ]);
  });

  it('logs who made the request when they are logged in', async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'learner@example.com',
    } as never);
    const { app, logged } = recordingApp();

    await request(app)
      .get('/trpc/auth.me')
      .set('Cookie', 'session_token=secret-token');

    expect(await requestLines(logged)).toEqual([
      {
        ...requestLine,
        method: 'GET',
        route: '/trpc/auth.me',
        userId: 'user-1',
        status: 200,
      },
    ]);
  });

  it('leaves out inputs, bodies, cookies and tokens', async () => {
    const { app, logged } = recordingApp();

    await request(app)
      .get('/trpc/auth.me')
      .query({ input: JSON.stringify({ answer: 'secret-answer' }) })
      .set('Cookie', 'session_token=secret-token');
    await logIn(app, 'secret-email@example.com');

    const lines = await requestLines(logged, 2);
    expect(lines.map((line) => line.route)).toEqual([
      '/trpc/auth.me',
      '/trpc/auth.login',
    ]);
    expect(JSON.stringify(logged)).not.toContain('secret');
  });

  it('logs and reports a server error, without what it quotes', async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(
      new Error('The database refused secret-email@example.com'),
    );
    const { app, logged, reported } = recordingApp();

    const res = await logIn(app, 'secret-email@example.com');

    expect(res.status).toBe(500);
    await requestLines(logged, 2);
    expect(logged).toContainEqual({
      level: 'error',
      message: 'server error',
      procedure: 'auth.login',
      code: 'INTERNAL_SERVER_ERROR',
      errorName: 'Error',
    });
    expect(JSON.stringify(logged)).not.toContain('secret');
    expect(reported).toEqual([
      {
        error: expect.objectContaining({
          message: 'The database refused secret-email@example.com',
        }),
        where: { procedure: 'auth.login', code: 'INTERNAL_SERVER_ERROR' },
      },
    ]);
  });

  it('logs an expected refusal without reporting it', async () => {
    const { app, logged, reported } = recordingApp();

    const unauthorized = await logIn(app, 'nobody@example.com');
    const invalid = await request(app)
      .post('/trpc/auth.signup')
      .send({ email: 'not-an-email', password: 'short' });

    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    const lines = await requestLines(logged, 2);
    expect(lines.map((line) => line.status)).toEqual([401, 400]);
    expect(logged.some((entry) => entry.level === 'error')).toBe(false);
    expect(reported).toEqual([]);
  });

  it('reports what failed and where when a streamed reply fails', async () => {
    const t = initTRPC.create();
    const router = t.router({
      ask: t.procedure.mutation(async function* () {
        yield 'the start of a reply';
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: 'The AI call failed',
          cause: new Error('The model is overloaded'),
        });
      }),
    });
    const { app, logged, reported } = recordingApp(router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/trpc/ask?batch=1`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'trpc-accept': 'application/jsonl',
        },
        body: '{}',
      });
      await res.text();

      await vi.waitFor(() => expect(reported).toHaveLength(1));
      expect(reported).toEqual([
        {
          error: expect.objectContaining({
            message: 'The model is overloaded',
          }),
          where: { procedure: 'ask', code: 'BAD_GATEWAY' },
        },
      ]);
      expect(logged).toContainEqual({
        level: 'error',
        message: 'server error',
        procedure: 'ask',
        code: 'BAD_GATEWAY',
        errorName: 'Error',
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it('keeps a body that fails to parse out of the logs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, logged, reported } = recordingApp();

    const res = await request(app)
      .post('/trpc/auth.login')
      .set('content-type', 'application/json')
      .serialize((body) => body)
      .send('{"password": secret-password');

    expect(res.status).toBe(400);
    expect(res.text).not.toContain('secret');
    await requestLines(logged);
    // Express would print it a moment after responding
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stderr).not.toHaveBeenCalled();
    expect(JSON.stringify(logged)).not.toContain('secret');
    expect(reported).toEqual([]);
    stderr.mockRestore();
    vi.unstubAllEnvs();
  });

  it("doesn't report a rate limit", async () => {
    const { app, logged, reported } = recordingApp();

    for (let i = 0; i < 10; i++) {
      await logIn(app, 'hammered@example.com');
    }
    const refused = await logIn(app, 'hammered@example.com');

    expect(refused.status).toBe(429);
    await requestLines(logged, 11);
    expect(reported).toEqual([]);
  });
});

describe('which origins may call the API', () => {
  const allowedOrigin = async (origin: string) => {
    const res = await request(recordingApp().app)
      .get('/health')
      .set('Origin', origin);
    return res.headers['access-control-allow-origin'];
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows only CORS_ORIGIN in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', 'https://study.example.com');

    expect(await allowedOrigin('https://study.example.com')).toBe(
      'https://study.example.com',
    );
    expect(await allowedOrigin('https://evil.example.com')).not.toBe(
      'https://evil.example.com',
    );
  });

  it('allows nobody in production when CORS_ORIGIN is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', '');

    expect(await allowedOrigin('http://localhost:5173')).toBeUndefined();
  });

  it('falls back to localhost in dev', async () => {
    vi.stubEnv('CORS_ORIGIN', '');

    expect(await allowedOrigin('http://localhost:5173')).toBe(
      'http://localhost:5173',
    );
    expect(await allowedOrigin('https://evil.example.com')).toBeUndefined();
  });
});
