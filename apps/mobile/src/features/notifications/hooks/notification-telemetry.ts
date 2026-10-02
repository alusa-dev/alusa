import * as Sentry from '@sentry/react-native';

const COOLDOWN_MS = 60_000;
const lastReportedAt = new Map<string, number>();

export const MOBILE_NOTIFICATION_FAILURE_EVENTS = [
  'mobile.notifications.unread_count.failed',
  'mobile.notifications.feed.load_failed',
  'mobile.notifications.item.read_failed',
  'mobile.notifications.feed.read_all_failed',
  'mobile.notifications.item.delete_failed',
] as const;

export type MobileNotificationFailureEvent = (typeof MOBILE_NOTIFICATION_FAILURE_EVENTS)[number];

/** Report one stable notification event at most once per minute across hook instances. */
export function reportMobileNotificationFailure(eventName: MobileNotificationFailureEvent): boolean {
  const now = Date.now();
  const lastReported = lastReportedAt.get(eventName);
  if (lastReported !== undefined && now - lastReported < COOLDOWN_MS) return false;

  lastReportedAt.set(eventName, now);
  Sentry.captureMessage(eventName, { level: 'error' });
  return true;
}
