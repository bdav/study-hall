import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc';
import { appRouter } from './routers/index.js';
import { createContext } from './context.js';
import { clientIpOf, createRateLimiter } from './rateLimit.js';

const REQUESTS_A_MINUTE = 300;

export function createApp() {
  const app = express();
  const allowRequest = createRateLimiter({
    limit: REQUESTS_A_MINUTE,
    windowMs: 60_000,
  });

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN
    : /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.use(cors({ origin: corsOrigin, credentials: true }));

  // After CORS, so a browser can read the refusal and preflights don't count.
  // A tRPC error, so the web app can read it, the tutor's stream aside
  app.use((req, res, next) => {
    if (allowRequest(clientIpOf(req))) return next();
    res.status(429).json({
      error: {
        message: 'Too many requests. Please wait a minute and try again.',
        code: TRPC_ERROR_CODES_BY_KEY.TOO_MANY_REQUESTS,
        data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
      },
    });
  });

  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    '/trpc',
    createExpressMiddleware({ router: appRouter, createContext }),
  );

  return app;
}

export type AppRouter = typeof appRouter;
