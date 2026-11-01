import { z } from 'zod';
import { AsaasNotificationEvent } from '@prisma/client';

const scheduleOffsetSchema = z.number().int().min(0).max(60);

export const asaasNotificationPreferenceDTOSchema = z.object({
  event: z.nativeEnum(AsaasNotificationEvent),
  scheduleOffset: scheduleOffsetSchema.default(0),
  enabled: z.boolean(),
  customerEnabled: z.boolean().default(true),
  emailEnabledForProvider: z.boolean(),
  smsEnabledForProvider: z.boolean(),
  emailEnabledForCustomer: z.boolean(),
  smsEnabledForCustomer: z.boolean(),
  whatsappEnabledForCustomer: z.boolean(),
  phoneCallEnabledForCustomer: z.boolean(),
});

const allowedOffsets: Partial<Record<AsaasNotificationEvent, number[]>> = {
  PAYMENT_DUEDATE_WARNING: [0, 5, 10, 15, 30],
  PAYMENT_OVERDUE: [0, 1, 7, 15, 30],
};

export function notificationPreferenceArraySchema<T extends z.ZodTypeAny>(itemSchema: T, options: { singleScheduledOffset?: boolean } = {}) {
  return z.array(itemSchema).min(1).superRefine((preferences, context) => {
    const scheduledOffsets = new Map<string, number[]>();
    const combinations = new Set<string>();
    preferences.forEach((preference, index) => {
      const combination = `${String(preference.event)}:${String(preference.scheduleOffset ?? 0)}`;
      if (combinations.has(combination)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'scheduleOffset'], message: 'Notificação repetida para este evento e intervalo.' });
      }
      combinations.add(combination);
      const allowed = allowedOffsets[preference.event as AsaasNotificationEvent];
      if (allowed && !allowed.includes(preference.scheduleOffset as number)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'scheduleOffset'], message: 'Intervalo de notificação inválido.' });
      }
      if ((preference.scheduleOffset as number) > 0) {
        const offsets = scheduledOffsets.get(String(preference.event)) ?? [];
        offsets.push(index);
        scheduledOffsets.set(String(preference.event), offsets);
      }
    });
    for (const indexes of options.singleScheduledOffset === false ? [] : scheduledOffsets.values()) {
      if (indexes.length > 1) {
        indexes.slice(1).forEach((index) => context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'scheduleOffset'],
          message: 'Configure apenas um intervalo de lembrete por evento.',
        }));
      }
    }
  });
}

export const asaasNotificationPolicySchema = z.object({
  customerNotificationsEnabled: z.boolean(),
  customerEmailNotificationsEnabled: z.boolean(),
  customerWhatsAppNotificationsEnabled: z.boolean(),
  customerSmsNotificationsEnabled: z.boolean(),
  contractWhatsAppNotificationsEnabled: z.boolean(),
  contractNotificationsEnabled: z.boolean(),
  contractEmailNotificationsEnabled: z.boolean(),
  version: z.number().int().positive(),
});

export type AsaasNotificationPreferenceDTO = z.infer<
  typeof asaasNotificationPreferenceDTOSchema
>;

/**
 * Produces the single reminder value expected by settings controls when legacy
 * data contains several positive offsets for the same event. Prefer an enabled
 * reminder, then the largest offset (the earliest warning). This is read-only:
 * persisted preferences are never changed by a GET.
 */
export function normalizeAsaasNotificationPreferencesForRead<T extends {
  event: AsaasNotificationEvent;
  scheduleOffset: number;
  enabled: boolean;
}>(preferences: readonly T[]): T[] {
  const selectedReminderByEvent = new Map<AsaasNotificationEvent, T>();

  for (const preference of preferences) {
    if (preference.scheduleOffset <= 0) continue;
    const current = selectedReminderByEvent.get(preference.event);
    if (
      !current ||
      (preference.enabled && !current.enabled) ||
      (preference.enabled === current.enabled && preference.scheduleOffset > current.scheduleOffset)
    ) {
      selectedReminderByEvent.set(preference.event, preference);
    }
  }

  return preferences.filter((preference) =>
    preference.scheduleOffset <= 0 || selectedReminderByEvent.get(preference.event) === preference,
  );
}

export const updateAsaasNotificationPreferencesInputDTOSchema = z.object({
  preferences: notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema),
  policy: asaasNotificationPolicySchema.omit({ version: true }),
});

export type UpdateAsaasNotificationPreferencesInputDTO = z.infer<
  typeof updateAsaasNotificationPreferencesInputDTOSchema
>;

export const asaasNotificationPreferencesResultDTOSchema = z.object({
  preferences: notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema),
  policy: asaasNotificationPolicySchema,
  synchronization: z.object({ pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), legacyPreferenceUnknown: z.number().int().nonnegative() }),
  customerChannelDefaults: z
    .array(z.enum(['EMAIL', 'SMS', 'WHATSAPP']))
    .default([]),
});

export type AsaasNotificationPreferencesResultDTO = z.infer<
  typeof asaasNotificationPreferencesResultDTOSchema
>;

export const saveAsaasNotificationPreferencesResultDTOSchema = z.object({
  preferences: notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema),
  policy: asaasNotificationPolicySchema,
  enqueued: z.number().int().nonnegative(),
  synchronization: z.object({ pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), legacyPreferenceUnknown: z.number().int().nonnegative() }),
  resync: z
    .object({
      processed: z.number().int().nonnegative(),
      successes: z.number().int().nonnegative(),
      failures: z.number().int().nonnegative(),
    })
    .optional(),
});

export type SaveAsaasNotificationPreferencesResultDTO = z.infer<
  typeof saveAsaasNotificationPreferencesResultDTOSchema
>;

export const mobileAsaasNotificationPreferenceDTOSchema = z.object({
  id: z.string().trim().optional(),
  event: z.nativeEnum(AsaasNotificationEvent),
  scheduleOffset: scheduleOffsetSchema,
  enabled: z.boolean(),
  customerEnabled: z.boolean().optional().default(true),
  emailEnabledForCustomer: z.boolean(),
  smsEnabledForCustomer: z.boolean(),
  whatsappEnabledForCustomer: z.boolean(),
  phoneCallEnabledForCustomer: z.boolean(),
});

export const saveMobileAsaasNotificationPreferencesInputDTOSchema = z.object({
  preferences: notificationPreferenceArraySchema(mobileAsaasNotificationPreferenceDTOSchema, { singleScheduledOffset: false }),
});

export type MobileAsaasNotificationPreferenceDTO = z.infer<
  typeof mobileAsaasNotificationPreferenceDTOSchema
>;

export type SaveMobileAsaasNotificationPreferencesInputDTO = z.infer<
  typeof saveMobileAsaasNotificationPreferencesInputDTOSchema
>;
