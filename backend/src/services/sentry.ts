import type { Express } from 'express';
import * as Sentry from '@sentry/node';

const SENTRY_DSN = process.env.SENTRY_DSN;
let initialized = false;

export function initSentry(app: Express): void {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [Sentry.expressIntegration(), Sentry.httpIntegration()],
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  });
  initialized = true;
}

export function setupSentryErrorHandler(app: Express): void {
  if (initialized) {
    Sentry.setupExpressErrorHandler(app);
  }
}

export function captureException(err: Error, context?: Record<string, unknown>): void {
  Sentry.captureException(err, { extra: context });
}
