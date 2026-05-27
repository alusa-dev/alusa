import * as Sentry from '@sentry/nextjs';
import { redactSensitiveData } from '@/lib/security/sensitive-redaction';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const pathname = typeof window === 'undefined' ? '' : window.location.pathname;
const replayAllowed =
  pathname === '/' ||
  pathname.startsWith('/privacidade') ||
  pathname.startsWith('/termos') ||
  pathname.startsWith('/cookies') ||
  pathname.startsWith('/seguranca') ||
  pathname.startsWith('/suboperadores') ||
  pathname.startsWith('/dpa') ||
  pathname.startsWith('/direitos-lgpd');

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    sendDefaultPii: false,

    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

    replaysSessionSampleRate: replayAllowed ? 0.05 : 0,
    replaysOnErrorSampleRate: replayAllowed ? 0.5 : 0,

    beforeSend(event) {
      return redactSensitiveData(event);
    },

    integrations: replayAllowed
      ? [Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })]
      : [],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
