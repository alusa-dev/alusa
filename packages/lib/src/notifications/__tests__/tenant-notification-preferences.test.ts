import { describe, expect, it } from 'vitest';
import {
  channelsFromTenantNotificationPreferences,
  channelsFromSelection,
} from '../tenant-notification-preferences';

describe('tenant-notification-preferences', () => {
  const tenantPrefs = [
    {
      event: 'PAYMENT_CREATED' as const,
      scheduleOffset: 0,
      enabled: true,
      emailEnabledForProvider: false,
      smsEnabledForProvider: false,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: true,
      phoneCallEnabledForCustomer: false,
    },
    {
      event: 'PAYMENT_OVERDUE' as const,
      scheduleOffset: 0,
      enabled: true,
      emailEnabledForProvider: true,
      smsEnabledForProvider: false,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: false,
      whatsappEnabledForCustomer: false,
      phoneCallEnabledForCustomer: true,
    },
  ];

  it('channelsFromSelection maps wizard values', () => {
    expect(channelsFromSelection(['EMAIL', 'SMS'])).toEqual({
      email: true,
      sms: true,
      whatsapp: false,
    });
  });

  it('aggregates fallback channels only from enabled saved preferences', () => {
    expect(channelsFromTenantNotificationPreferences([
      { ...tenantPrefs[0], enabled: false },
      { ...tenantPrefs[1], emailEnabledForCustomer: false, smsEnabledForCustomer: false },
    ])).toEqual({ email: false, sms: false, whatsapp: false });
  });
});
