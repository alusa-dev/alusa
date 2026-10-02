jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/react-native';

import { reportMobileNotificationFailure } from './notification-telemetry';

describe('reportMobileNotificationFailure', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('deduplicates each stable event for one minute and sends no error details', () => {
    const now = jest.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(61_001);
    const eventName = 'mobile.notifications.feed.load_failed';

    expect(reportMobileNotificationFailure(eventName)).toBe(true);
    expect(reportMobileNotificationFailure(eventName)).toBe(false);
    expect(reportMobileNotificationFailure(eventName)).toBe(true);
    expect(reportMobileNotificationFailure('mobile.notifications.item.read_failed')).toBe(true);
    expect(Sentry.captureMessage).toHaveBeenNthCalledWith(1, eventName, { level: 'error' });
    expect(Sentry.captureMessage).toHaveBeenNthCalledWith(2, eventName, { level: 'error' });
    expect(Sentry.captureMessage).toHaveBeenNthCalledWith(3, 'mobile.notifications.item.read_failed', { level: 'error' });
    expect(now).toHaveBeenCalledTimes(4);
  });
});
