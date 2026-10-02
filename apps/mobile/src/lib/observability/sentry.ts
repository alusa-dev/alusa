import * as Sentry from '@sentry/react-native';
import { redactSensitiveData } from '@alusa/observability';

import { mobileEnv } from '@/config/env';

export function initSentry() {
  if (!mobileEnv.sentryDsn) return;

  Sentry.init({
    dsn: mobileEnv.sentryDsn,
    environment: mobileEnv.environment,
    sendDefaultPii: false,
    tracesSampleRate: mobileEnv.sentryTracesSampleRate,
    tracePropagationTargets: [mobileEnv.apiUrl],
    propagateTraceparent: true,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.Cookie;
      }
      return redactSensitiveData(event) as typeof event;
    },
  });
}
