import { loadTenantNotificationEventPreferences } from '@alusa/lib';
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
    console.warn('[ensureAsaasCustomerForPayer] Falha ao aplicar preferências globais', {
      contaId,
      customerId: asaasCustomerId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
