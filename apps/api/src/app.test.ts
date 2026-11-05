import { type Server } from 'http';
import { type AddressInfo } from 'net';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppRouter } from './app.js';

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('tRPC healthCheck', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/trpc/healthCheck');
    expect(res.status).toBe(200);
    expect(res.body.result.data).toEqual({ ok: true });
  });
});

describe('the limit on every request', { timeout: 30_000 }, () => {
  const REQUESTS_A_MINUTE = 300;
  let server: Server;

  /** One server for the test, as supertest would start one per request. */
  async function serve() {
    const app = createApp();
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
