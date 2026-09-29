import type { AsaasNotificationPreferenceDTO } from './dtos';

export type NotificationPreference = AsaasNotificationPreferenceDTO;
export type NotificationEvent = NotificationPreference['event'];

export type ChannelKey = keyof Pick<
  NotificationPreference,
  | 'emailEnabledForProvider'
  | 'smsEnabledForProvider'
  | 'emailEnabledForCustomer'
  | 'smsEnabledForCustomer'
  | 'whatsappEnabledForCustomer'
  | 'phoneCallEnabledForCustomer'
>;
