import {
  channelsFromSelection,
  channelsFromTenantNotificationPreferences,
  loadTenantNotificationEventPreferences,
  type TenantNotificationEventPreference,
} from '@alusa/lib/notifications/tenant-notification-preferences';

import {
  syncCustomerNotificationChannels,
  type NotificationChannelPreferences,
  type SyncNotificationResult,
} from './customer-notification.service';
import { enqueueAsaasNotificationPreferenceSync } from './asaas-notification-preference-outbox.service';

function preferenceSnapshot(preferences: TenantNotificationEventPreference[]): string {
  return JSON.stringify([...preferences]
    .sort((a, b) => a.event.localeCompare(b.event) || a.scheduleOffset - b.scheduleOffset)
    .map(({ event, scheduleOffset, enabled, emailEnabledForProvider, smsEnabledForProvider,
      emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer,
      phoneCallEnabledForCustomer }) => ({ event, scheduleOffset, enabled,
      emailEnabledForProvider, smsEnabledForProvider, emailEnabledForCustomer,
      smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer })));
}

/**
 * Sincroniza notificações do customer no Asaas quando o usuário escolheu canais
 * no wizard/modal. Preferências salvas da escola prevalecem; os canais da cobrança
 * são usados somente quando a Conta ainda não possui uma régua salva.
 */
export async function syncCustomerNotificationsForUserSelection(
  contaId: string,
  customerId: string,
  channels: NotificationChannelPreferences,
): Promise<SyncNotificationResult> {
  const tenantPreferences = await loadTenantNotificationEventPreferences(contaId);
  const initialSnapshot = preferenceSnapshot(tenantPreferences);
  const result = tenantPreferences.length === 0
    ? await syncCustomerNotificationChannels(contaId, customerId, channels)
    : await syncCustomerNotificationChannels(
      contaId,
      customerId,
      channelsFromTenantNotificationPreferences(tenantPreferences),
      { eventPreferences: tenantPreferences },
    );

  const currentPreferences = await loadTenantNotificationEventPreferences(contaId);
  if (preferenceSnapshot(currentPreferences) !== initialSnapshot) {
    await enqueueAsaasNotificationPreferenceSync({
      contaId,
      asaasCustomerId: customerId,
      reason: 'TENANT_PREFERENCES_CHANGED_DURING_CHARGE_SYNC',
    });
  }
  return result;
}

export function channelPreferencesFromWizardSelection(
  selected: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>,
): NotificationChannelPreferences {
  return channelsFromSelection(selected);
}
