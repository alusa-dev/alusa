import * as Sentry from '@sentry/nextjs';
import { redactSensitiveData } from '@alusa/observability';
import { registerAdminSentryTelemetry } from './lib/observability/sentry-telemetry';

const dsn = process.env.ADMIN_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.SENTRY_RELEASE,
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
