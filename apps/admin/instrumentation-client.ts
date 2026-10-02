import * as Sentry from '@sentry/nextjs';
import { redactSensitiveData } from '@alusa/observability';
import { registerAdminSentryTelemetry } from './lib/observability/sentry-telemetry';

const dsn = process.env.NEXT_PUBLIC_ADMIN_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    sendDefaultPii: false,
    enableLogs: true,
    enableMetrics: true,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      return redactSensitiveData(event) as typeof event;
    },
    beforeSendLog(log) {
      return redactSensitiveData(log) as typeof log;
    },
  });
  registerAdminSentryTelemetry();
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
