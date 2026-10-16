import type { AsaasNotificationEvent } from '@prisma/client';
import { prisma } from '../prisma';

export type TenantNotificationEventPreference = {
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
  emailEnabledForProvider: boolean;
  smsEnabledForProvider: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
  phoneCallEnabledForCustomer: boolean;
};

export type NotificationChannelSelection = {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
};

export async function loadTenantNotificationEventPreferences(
  contaId: string,
): Promise<TenantNotificationEventPreference[]> {
  const rows = await prisma.asaasNotificationPreference.findMany({
    where: { contaId },
    select: {
      event: true,
      scheduleOffset: true,
      enabled: true,
      emailEnabledForProvider: true,
      smsEnabledForProvider: true,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: true,
      phoneCallEnabledForCustomer: true,
    },
  });

  return rows.map((row) => ({
    event: row.event,
    scheduleOffset: row.scheduleOffset,
    enabled: row.enabled,
    emailEnabledForProvider: row.emailEnabledForProvider,
    smsEnabledForProvider: row.smsEnabledForProvider,
    emailEnabledForCustomer: row.emailEnabledForCustomer,
    smsEnabledForCustomer: row.smsEnabledForCustomer,
    whatsappEnabledForCustomer: row.whatsappEnabledForCustomer,
    phoneCallEnabledForCustomer: row.phoneCallEnabledForCustomer,
  }));
}

/**
 * Retorna os canais agregados das preferências salvas da Conta, considerando
 * somente eventos habilitados. São usados como fallback para eventos remotos
 * sem entrada correspondente na régua local.
 */
export function channelsFromTenantNotificationPreferences(
  tenantPreferences: TenantNotificationEventPreference[],
): NotificationChannelSelection {
  const enabledPreferences = tenantPreferences.filter((preference) => preference.enabled);
  return {
    email: enabledPreferences.some((preference) => preference.emailEnabledForCustomer),
    sms: enabledPreferences.some((preference) => preference.smsEnabledForCustomer),
    whatsapp: enabledPreferences.some((preference) => preference.whatsappEnabledForCustomer),
  };
}

export function channelsFromSelection(
  selected: Array<'EMAIL' | 'SMS' | 'WHATSAPP'>,
): NotificationChannelSelection {
  return {
    email: selected.includes('EMAIL'),
    sms: selected.includes('SMS'),
    whatsapp: selected.includes('WHATSAPP'),
  };
}

export { formatNotificationWarningsForUi } from './format-notification-warnings-for-ui';
