import * as Sentry from '@sentry/node';

/**
 * What the API logs: one line per request, and one more for a server error.
 * Never a body, an answer, a password, a cookie, a token or a query string,
 * nor an error's message, which can quote what caused it. Sentry has those.
 */
export type LogEntry =
  | {
      level: 'info';
      message: 'request';
      method: string;
      route: string;
      userId: string | null;
      status: number;
      durationMs: number;
    }
  | {
      level: 'error';
      message: 'server error';
      procedure: string;
      code: string;
      errorName: string;
    };

export type Logger = (entry: LogEntry) => void;

export type ErrorReporter = (
  error: unknown,
  where: { procedure: string; code: string },
) => void;

/** Logs JSON lines to stdout, which Railway keeps. */
export const jsonLinesLogger: Logger = (entry) => {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

/**
 * Reports to Sentry, or does nothing without `SENTRY_DSN`, so dev and tests
 * send nothing. Its default integrations stay off: they'd attach requests,
 * with their headers and bodies, and nothing here uses the rest.
 */
export function createErrorReporter(): ErrorReporter {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return () => {};

  Sentry.init({ dsn, defaultIntegrations: false });
  return (error, where) => {
    Sentry.captureException(error, { tags: where });
  };
}
