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
 * Aplica a seleção explícita de canais do usuário (wizard/modal) sobre a régua
 * global por evento, preservando enabled, scheduleOffset e canais do provedor
 * (admin).
 *
 * A seleção explícita do wizard é a fonte de verdade para os canais do cliente.
 * Os valores de canal da régua global são apenas os defaults exibidos antes da
 * confirmação e não podem impedir uma escolha feita pelo usuário.
 */
export function deriveEventPreferencesForChannelSelection(
  tenantPreferences: TenantNotificationEventPreference[],
  channels: NotificationChannelSelection,
): TenantNotificationEventPreference[] {
  return tenantPreferences.map((pref) => ({
    ...pref,
    emailEnabledForCustomer: pref.enabled && channels.email,
    smsEnabledForCustomer: pref.enabled && channels.sms,
    whatsappEnabledForCustomer: pref.enabled && channels.whatsapp,
  }));
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
