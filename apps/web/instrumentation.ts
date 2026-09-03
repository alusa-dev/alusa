import * as Sentry from '@sentry/nextjs';

import { assertProductionSecurityEnv } from './lib/security/production-env-guard';

export async function register() {
  assertProductionSecurityEnv();

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = (...args: Parameters<typeof Sentry.captureRequestError>) => {
  if (process.env.VERCEL_ENV === 'production') {
    Sentry.captureRequestError(...args);
  }
};
