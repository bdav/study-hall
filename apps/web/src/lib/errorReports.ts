import * as Sentry from '@sentry/react';
import { type RootOptions } from 'react-dom/client';

/**
 * Reports uncaught errors and React render errors to Sentry, and returns the
 * options for `createRoot` that do the latter. Without `VITE_SENTRY_DSN` it
 * does nothing, so dev and tests send nothing and React logs errors as usual.
 * Its integrations are listed, not the defaults, so it sends crashes alone:
 * breadcrumbs would keep the URLs fetched, which hold tRPC inputs, and the
 * console's messages, and sessions would ping on every page load.
 */
export function startErrorReports(): RootOptions {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return {};

  Sentry.init({
    dsn,
    defaultIntegrations: false,
    integrations: [
      Sentry.globalHandlersIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.dedupeIntegration(),
      Sentry.httpContextIntegration(),
    ],
  });

  const report = Sentry.reactErrorHandler();
  return { onCaughtError: report, onUncaughtError: report };
}
