import * as Sentry from '@sentry/nextjs';
import { redactSensitiveData } from './lib/security/sensitive-redaction';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.SENTRY_RELEASE,

    sendDefaultPii: false,

    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

    includeLocalVariables: process.env.NODE_ENV === 'development',

    beforeSend(event) {
      return redactSensitiveData(event);
    },
  });
}
