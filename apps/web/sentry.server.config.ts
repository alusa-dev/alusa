import * as Sentry from '@sentry/nextjs';
import { redactSensitiveData } from './lib/security/sensitive-redaction';
import { registerSentryTelemetry } from './lib/observability/sentry-telemetry';
import { getTraceSampleRate } from './lib/observability/sampling';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
const isProduction = process.env.VERCEL_ENV === 'production';

if (dsn && isProduction) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.SENTRY_RELEASE,

    sendDefaultPii: false,
    enableLogs: true,
    enableMetrics: true,
    tracesSampleRate: getTraceSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, process.env.NODE_ENV),

    includeLocalVariables: process.env.NODE_ENV === 'development',

    beforeSend(event) {
      return redactSensitiveData(event);
    },
    beforeSendLog(log) {
      return redactSensitiveData(log) as typeof log;
    },
  });
  registerSentryTelemetry();
}
