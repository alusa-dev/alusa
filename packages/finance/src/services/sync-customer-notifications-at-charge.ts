import {
  channelsFromSelection,
  channelsFromTenantNotificationPreferences,
  loadTenantNotificationEventPreferences,
  type TenantNotificationEventPreference,
} from '@alusa/lib/notifications/tenant-notification-preferences';
import { prisma } from '@alusa/database';

import {
  syncCustomerNotificationChannels,
  type NotificationChannelPreferences,
  type SyncNotificationResult,
} from './customer-notification.service';
import { enqueueAsaasNotificationPreferenceSync } from './asaas-notification-preference-outbox.service';
import { getAsaasNotificationPreferences } from './asaas-notification-preferences.service';

function preferenceSnapshot(preferences: TenantNotificationEventPreference[]): string {
  return JSON.stringify([...preferences]
    .sort((a, b) => a.event.localeCompare(b.event) || a.scheduleOffset - b.scheduleOffset)
    .map(({ event, scheduleOffset, enabled, customerEnabled, emailEnabledForProvider, smsEnabledForProvider,
      emailEnabledForCustomer, smsEnabledForCustomer, whatsappEnabledForCustomer,
      phoneCallEnabledForCustomer }) => ({ event, scheduleOffset, enabled, customerEnabled,
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
  const [accountPolicy, storedPreferences] = await Promise.all([
    prisma.conta.findUnique({ where: { id: contaId }, select: {
      customerNotificationsEnabled: true,
      customerEmailNotificationsEnabled: true,
      customerWhatsAppNotificationsEnabled: true,
      customerSmsNotificationsEnabled: true,
    } }),
    loadTenantNotificationEventPreferences(contaId),
  ]);
  const tenantPreferences = storedPreferences.length > 0
    ? storedPreferences
    : (accountPolicy?.customerNotificationsEnabled === false
      ? (await getAsaasNotificationPreferences(contaId)).map(({ event, scheduleOffset, enabled, customerEnabled,
          emailEnabledForProvider, smsEnabledForProvider, emailEnabledForCustomer, smsEnabledForCustomer,
          whatsappEnabledForCustomer, phoneCallEnabledForCustomer }) => ({ event, scheduleOffset, enabled,
          customerEnabled, emailEnabledForProvider, smsEnabledForProvider, emailEnabledForCustomer,
          smsEnabledForCustomer, whatsappEnabledForCustomer, phoneCallEnabledForCustomer }))
      : storedPreferences);
  const initialSnapshot = preferenceSnapshot(tenantPreferences);
  const customerNotificationsEnabled = accountPolicy?.customerNotificationsEnabled ?? true;
  const effectivePreferences = tenantPreferences.map((preference) => ({
    ...preference,
    customerEnabled: customerNotificationsEnabled && preference.customerEnabled,
    emailEnabledForCustomer: accountPolicy?.customerEmailNotificationsEnabled ?? preference.emailEnabledForCustomer,
    whatsappEnabledForCustomer: accountPolicy?.customerWhatsAppNotificationsEnabled ?? preference.whatsappEnabledForCustomer,
    smsEnabledForCustomer: accountPolicy?.customerSmsNotificationsEnabled ?? preference.smsEnabledForCustomer,
  }));
  const result = effectivePreferences.length === 0
    ? await syncCustomerNotificationChannels(contaId, customerId, {
      email: customerNotificationsEnabled && (accountPolicy?.customerEmailNotificationsEnabled ?? channels.email),
      sms: customerNotificationsEnabled && (accountPolicy?.customerSmsNotificationsEnabled ?? channels.sms),
      whatsapp: customerNotificationsEnabled && (accountPolicy?.customerWhatsAppNotificationsEnabled ?? channels.whatsapp),
    })
    : await syncCustomerNotificationChannels(
      contaId,
      customerId,
      channelsFromTenantNotificationPreferences(effectivePreferences),
      { eventPreferences: effectivePreferences },
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
