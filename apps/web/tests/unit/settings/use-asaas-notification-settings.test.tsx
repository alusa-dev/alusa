import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAsaasNotificationSettings } from '@/features/settings/notifications/asaas/hooks/useAsaasNotificationSettings';

describe('useAsaasNotificationSettings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks an individual customerEnabled change as dirty so Save becomes available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      preferences: [{
        event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true, customerEnabled: true,
        emailEnabledForProvider: false, smsEnabledForProvider: false,
        emailEnabledForCustomer: true, smsEnabledForCustomer: true,
        whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
      }],
      policy: {
        customerNotificationsEnabled: true,
        customerEmailNotificationsEnabled: true,
        customerWhatsAppNotificationsEnabled: true,
        customerSmsNotificationsEnabled: true,
        contractWhatsAppNotificationsEnabled: true,
        contractNotificationsEnabled: true,
        contractEmailNotificationsEnabled: false,
        version: 1,
      },
      synchronization: { pending: 0, failed: 0, legacyPreferenceUnknown: 0 },
      customerChannelDefaults: ['EMAIL', 'SMS'],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    const { result } = renderHook(() => useAsaasNotificationSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasChanges).toBe(false);

    act(() => result.current.updatePreference('PAYMENT_CREATED', 0, { customerEnabled: false }));

    expect(result.current.hasChanges).toBe(true);
  });
});
