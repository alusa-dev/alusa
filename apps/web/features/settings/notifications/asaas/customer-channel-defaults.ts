export type CustomerNotificationChannel = 'WHATSAPP' | 'EMAIL' | 'SMS';

type CustomerNotificationPreferenceLike = {
  enabled: boolean;
  customerEnabled?: boolean;
  emailEnabledForCustomer: boolean;
  smsEnabledForCustomer: boolean;
  whatsappEnabledForCustomer: boolean;
};

const CHANNEL_ORDER: CustomerNotificationChannel[] = ['WHATSAPP', 'EMAIL', 'SMS'];

export function deriveCustomerNotificationChannelDefaults(
  preferences: CustomerNotificationPreferenceLike[],
): CustomerNotificationChannel[] {
  const activePreferences = preferences.filter((preference) => preference.enabled && preference.customerEnabled !== false);

  return CHANNEL_ORDER.filter((channel) => {
    if (channel === 'WHATSAPP') {
      return activePreferences.some((preference) => preference.whatsappEnabledForCustomer);
    }

    if (channel === 'EMAIL') {
      return activePreferences.some((preference) => preference.emailEnabledForCustomer);
    }

    return activePreferences.some((preference) => preference.smsEnabledForCustomer);
  });
}
