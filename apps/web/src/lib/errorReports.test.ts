import * as Sentry from '@sentry/react';
import { startErrorReports } from './errorReports';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  reactErrorHandler: vi.fn(() => vi.fn()),
  globalHandlersIntegration: () => ({ name: 'GlobalHandlers' }),
  linkedErrorsIntegration: () => ({ name: 'LinkedErrors' }),
  dedupeIntegration: () => ({ name: 'Dedupe' }),
  httpContextIntegration: () => ({ name: 'HttpContext' }),
}));

const DSN = 'https://key@sentry.example.com/1';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('startErrorReports', () => {
  it('sends nothing without a DSN, leaving React its own handling', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');

    expect(startErrorReports()).toEqual({});
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('reports caught and uncaught render errors with a DSN', () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    const report = vi.fn();
    vi.mocked(Sentry.reactErrorHandler).mockReturnValue(report);

    const options = startErrorReports();

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN }),
    );
    expect(options).toEqual({ onCaughtError: report, onUncaughtError: report });
  });

  it('sends crashes alone: no breadcrumbs, console or session pings', () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);

    startErrorReports();

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultIntegrations: false,
        integrations: [
          { name: 'GlobalHandlers' },
          { name: 'LinkedErrors' },
          { name: 'Dedupe' },
          { name: 'HttpContext' },
        ],
      }),
    );
  });
});
