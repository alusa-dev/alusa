import {
  channelsFromSelection,
  deriveEventPreferencesForChannelSelection,
  loadTenantNotificationEventPreferences,
} from '@alusa/lib';

import {
  syncCustomerNotificationChannels,
  type NotificationChannelPreferences,
  type SyncNotificationResult,
} from './customer-notification.service';

/**
 * Sincroniza notificações do customer no Asaas quando o usuário escolheu canais
 * no wizard/modal. Preserva a régua global por evento, limitando canais do cliente
 * aos toggles selecionados.
 */
export async function syncCustomerNotificationsForUserSelection(
  contaId: string,
  customerId: string,
  channels: NotificationChannelPreferences,
): Promise<SyncNotificationResult> {
  const tenantPreferences = await loadTenantNotificationEventPreferences(contaId);

  if (tenantPreferences.length === 0) {
    return syncCustomerNotificationChannels(contaId, customerId, channels);
  }

  const eventPreferences = deriveEventPreferencesForChannelSelection(tenantPreferences, channels);

  return syncCustomerNotificationChannels(contaId, customerId, channels, {
    eventPreferences,
  });
}

export function channelPreferencesFromWizardSelection(
  selected: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>,
): NotificationChannelPreferences {
  return channelsFromSelection(selected);
}
