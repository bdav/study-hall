import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import {
  type AnyRouter,
  getTRPCErrorFromUnknown,
  type TRPCError,
} from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc';
import { appRouter } from './routers/index.js';
import { createContext } from './context.js';
import { type ErrorReporter, type Logger } from './observability.js';
import { clientIpOf, createRateLimiter } from './rateLimit.js';

const REQUESTS_A_MINUTE = 300;

/** Failing part-way through a stream, the real error comes wrapped by tRPC. */
function withoutStreamWrapper(error: TRPCError): TRPCError {
  const cause = error.cause as { error?: unknown } | undefined;
  return cause?.error === undefined
    ? error
    : getTRPCErrorFromUnknown(cause.error);
}

export function createApp({
  log,
  reportError,
  router = appRouter,
}: {
  log: Logger;
  reportError: ErrorReporter;
  router?: AnyRouter;
}) {
  const app = express();

  function recordServerError(procedure: string, code: string, failure: Error) {
    log({
      level: 'error',
      message: 'server error',
      procedure,
      code,
      errorName: failure.name,
    });
    reportError(failure, { procedure, code });
  }

  const allowRequest = createRateLimiter({
    limit: REQUESTS_A_MINUTE,
    windowMs: 60_000,
  });

  // The path alone: a query string can hold a procedure's input. On close,
  // which also comes when a client leaves during a streamed reply
  app.use((req, res, next) => {
    const { method, path: route } = req;
    const startedAt = performance.now();
    res.once('close', () => {
      log({
        level: 'info',
        message: 'request',
        method,
        route,
        userId: res.locals.userId ?? null,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });

  const localhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const corsOrigin =
    process.env.CORS_ORIGIN ||
    (process.env.NODE_ENV === 'production' ? false : localhost);
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
    createExpressMiddleware({
      router,
      createContext: async (options) => {
        const context = await createContext(options);
        options.res.locals.userId = context.userId;
        return context;
      },
      onError: ({ error, path, req }) => {
        const failure = withoutStreamWrapper(error);
        if (getHTTPStatusCodeFromError(failure) < 500) return;

        // A stream's failure has no path, and only the URL says which it was
        const procedure = path ?? req.url.split('?')[0]!.slice(1);
        recordServerError(procedure, failure.code, failure.cause ?? failure);
      },
    }),
  );

  // Instead of Express's own, which prints errors to stderr, and the message
  // of a body that won't parse quotes the body
  const handleError: ErrorRequestHandler = (error, req, res, next) => {
    if (res.headersSent) return next(error);

    const status: number = error.status ?? 500;
    if (status >= 500) {
      recordServerError(req.path, 'INTERNAL_SERVER_ERROR', error);
    }
    res.status(status).json({
      error: { message: status < 500 ? 'Bad request' : 'Something went wrong' },
    });
  };
  app.use(handleError);

  return app;
}

export type AppRouter = typeof appRouter;
