import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createErrorReporter, jsonLinesLogger } from './observability.js';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('createErrorReporter', () => {
  it('sends nothing without a DSN', () => {
    vi.stubEnv('SENTRY_DSN', '');

    createErrorReporter()(new Error('boom'), { procedure: 'p', code: 'c' });

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports to Sentry with a DSN, saying where it happened', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.example.com/1');
    const error = new Error('boom');

    createErrorReporter()(error, {
      procedure: 'lesson.open',
      code: 'BAD_GATEWAY',
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        procedure: 'lesson.open',
        code: 'BAD_GATEWAY',
      },
    });
  });

  it('leaves off the integrations that would attach requests', () => {
    vi.stubEnv('SENTRY_DSN', 'https://key@sentry.example.com/1');

    createErrorReporter();

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ defaultIntegrations: false }),
    );
  });
});

describe('jsonLinesLogger', () => {
  it('writes each entry to stdout as one line of JSON', () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const entry = {
      level: 'error',
      message: 'server error',
      procedure: 'auth.login',
      code: 'INTERNAL_SERVER_ERROR',
      errorName: 'Error',
    } as const;

    jsonLinesLogger(entry);

    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual(entry);
  });
});
