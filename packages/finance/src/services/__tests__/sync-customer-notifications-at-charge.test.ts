import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadPreferences: vi.fn(),
  syncChannels: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('@alusa/lib/notifications/tenant-notification-preferences', () => ({
  channelsFromSelection: (selected: string[]) => ({
    email: selected.includes('EMAIL'), sms: selected.includes('SMS'), whatsapp: selected.includes('WHATSAPP'),
  }),
  channelsFromTenantNotificationPreferences: (preferences: Array<Record<string, unknown>>) => ({
    email: preferences.some((preference) => preference.enabled && preference.emailEnabledForCustomer),
    sms: preferences.some((preference) => preference.enabled && preference.smsEnabledForCustomer),
    whatsapp: preferences.some((preference) => preference.enabled && preference.whatsappEnabledForCustomer),
  }),
  loadTenantNotificationEventPreferences: mocks.loadPreferences,
}));
vi.mock('../customer-notification.service', () => ({
  syncCustomerNotificationChannels: mocks.syncChannels,
}));
vi.mock('../asaas-notification-preference-outbox.service', () => ({
  enqueueAsaasNotificationPreferenceSync: mocks.enqueue,
}));

const { syncCustomerNotificationsForUserSelection } = await import('../sync-customer-notifications-at-charge');

const savedPreference = {
  event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
  emailEnabledForProvider: false, smsEnabledForProvider: false,
  emailEnabledForCustomer: true, smsEnabledForCustomer: false,
  whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
};

describe('syncCustomerNotificationsForUserSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncChannels.mockResolvedValue({ success: true, applied: {}, warnings: [] });
    mocks.enqueue.mockResolvedValue({});
  });

  it('uses saved school preferences over conflicting charge channels', async () => {
    mocks.loadPreferences.mockResolvedValue([savedPreference]);

    await syncCustomerNotificationsForUserSelection('conta-a', 'cus-a', {
      email: false, sms: true, whatsapp: true,
    });

    expect(mocks.syncChannels).toHaveBeenCalledWith('conta-a', 'cus-a', {
      email: true, sms: false, whatsapp: false,
    }, { eventPreferences: [savedPreference] });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('re-enqueues current school preferences if they change during the charge sync', async () => {
    mocks.loadPreferences
      .mockResolvedValueOnce([savedPreference])
      .mockResolvedValueOnce([{ ...savedPreference, emailEnabledForCustomer: false, smsEnabledForCustomer: true }]);

    await syncCustomerNotificationsForUserSelection('conta-a', 'cus-a', {
      email: false, sms: true, whatsapp: false,
    });

    expect(mocks.enqueue).toHaveBeenCalledWith({
      contaId: 'conta-a', asaasCustomerId: 'cus-a', reason: 'TENANT_PREFERENCES_CHANGED_DURING_CHARGE_SYNC',
    });
  });

  it('uses charge channels only when no saved school preferences exist', async () => {
    mocks.loadPreferences.mockResolvedValue([]);

    await syncCustomerNotificationsForUserSelection('conta-a', 'cus-a', {
      email: false, sms: true, whatsapp: false,
    });

    expect(mocks.syncChannels).toHaveBeenCalledWith('conta-a', 'cus-a', {
      email: false, sms: true, whatsapp: false,
    });
  });
});
