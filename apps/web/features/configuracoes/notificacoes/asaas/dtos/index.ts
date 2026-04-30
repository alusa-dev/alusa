import { z } from 'zod';
import { AsaasNotificationEvent } from '@prisma/client';

export const asaasNotificationPreferenceDTOSchema = z.object({
  event: z.nativeEnum(AsaasNotificationEvent),
  scheduleOffset: z.number().int().min(0).max(60).default(0),
  enabled: z.boolean(),
  emailEnabledForProvider: z.boolean(),
  smsEnabledForProvider: z.boolean(),
  emailEnabledForCustomer: z.boolean(),
  smsEnabledForCustomer: z.boolean(),
  whatsappEnabledForCustomer: z.boolean(),
  phoneCallEnabledForCustomer: z.boolean(),
});

export type AsaasNotificationPreferenceDTO = z.infer<
  typeof asaasNotificationPreferenceDTOSchema
>;

export const updateAsaasNotificationPreferencesInputDTOSchema = z.object({
  preferences: z.array(asaasNotificationPreferenceDTOSchema).min(1),
  applyToExistingCustomers: z.boolean().optional(),
});

export type UpdateAsaasNotificationPreferencesInputDTO = z.infer<
  typeof updateAsaasNotificationPreferencesInputDTOSchema
>;

export const asaasNotificationPreferencesResultDTOSchema = z.object({
  preferences: z.array(asaasNotificationPreferenceDTOSchema),
  customerChannelDefaults: z
    .array(z.enum(['EMAIL', 'SMS', 'WHATSAPP']))
    .default([]),
});

export type AsaasNotificationPreferencesResultDTO = z.infer<
  typeof asaasNotificationPreferencesResultDTOSchema
>;

export const saveAsaasNotificationPreferencesResultDTOSchema = z.object({
  preferences: z.array(asaasNotificationPreferenceDTOSchema),
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
