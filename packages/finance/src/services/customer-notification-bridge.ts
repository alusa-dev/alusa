import { logFinanceOperationalEvent } from '../foundation/operational-log';
import { loadTenantNotificationEventPreferences } from '@alusa/lib/notifications/tenant-notification-preferences';
import { syncCustomerNotificationChannels } from './customer-notification.service';

/**
 * Ponte para preferências globais de notificação do tenant ao criar/atualizar customer.
 */
export async function syncCustomerNotificationChannelsFromTenantPreferences(
  contaId: string,
  asaasCustomerId: string,
): Promise<void> {
  try {
    const preferences = await loadTenantNotificationEventPreferences(contaId);
    if (preferences.length === 0) return;

    const channelPrefs = {
      email: preferences.some((p) => p.emailEnabledForCustomer),
      sms: preferences.some((p) => p.smsEnabledForCustomer),
      whatsapp: preferences.some((p) => p.whatsappEnabledForCustomer),
    };

    await syncCustomerNotificationChannels(contaId, asaasCustomerId, channelPrefs, {
      eventPreferences: preferences,
    });
  } catch (error) {
    logFinanceOperationalEvent({
      severity: 'warn',
      eventName: 'finance.services.customer_notification_bridge.degraded',
      error: error,
      throttleMs: 60_000,
    });
  }
}
