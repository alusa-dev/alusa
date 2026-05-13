import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

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

    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [Sentry.replayIntegration()],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
