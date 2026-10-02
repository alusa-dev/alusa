import * as Sentry from '@sentry/nextjs';
import { redactSensitiveData } from '@/lib/security/sensitive-redaction';
import { registerSentryTelemetry } from '@/lib/observability/sentry-telemetry';
import { getTraceSampleRate } from '@/lib/observability/sampling';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isProduction = process.env.NEXT_PUBLIC_VERCEL_ENV === 'production';
const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
const replayAllowed =
  pathname === '/' ||
  pathname.startsWith('/privacidade') ||
  pathname.startsWith('/termos') ||
  pathname.startsWith('/cookies') ||
  pathname.startsWith('/security') ||
  pathname.startsWith('/suboperadores') ||
  pathname.startsWith('/dpa') ||
  pathname.startsWith('/direitos-lgpd');

if (dsn && isProduction) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    sendDefaultPii: false,
    enableLogs: true,
    enableMetrics: true,
    tracesSampleRate: getTraceSampleRate(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    ),

    replaysSessionSampleRate: replayAllowed ? 0.05 : 0,
    replaysOnErrorSampleRate: replayAllowed ? 0.5 : 0,

    beforeSend(event) {
      return redactSensitiveData(event);
    },
    beforeSendLog(log) {
      return redactSensitiveData(log) as typeof log;
    },

    integrations: replayAllowed
      ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })]
      : [],
  });
  registerSentryTelemetry();
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
