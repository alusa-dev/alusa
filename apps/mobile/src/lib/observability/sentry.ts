import * as Sentry from '@sentry/react-native';

import { mobileEnv } from '@/config/env';

export function initSentry() {
  if (!mobileEnv.sentryDsn) return;

  Sentry.init({
    dsn: mobileEnv.sentryDsn,
    environment: mobileEnv.environment,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.Cookie;
      }
      return event;
    },
  });
}
