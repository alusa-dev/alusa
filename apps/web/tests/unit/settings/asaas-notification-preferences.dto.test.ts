import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asaasNotificationPreferenceDTOSchema, notificationPreferenceArraySchema } from '@/features/settings/notifications/asaas/dtos';

const preference = {
  event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 15, enabled: true,
  emailEnabledForProvider: false, smsEnabledForProvider: false,
  emailEnabledForCustomer: true, smsEnabledForCustomer: true,
  whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
};

describe('Asaas notification preference DTO', () => {
  it('permite os intervalos de aviso antes do vencimento', () => {
    for (const scheduleOffset of [0, 5, 10, 15, 30]) {
      expect(notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema).safeParse([
        { ...preference, scheduleOffset },
      ]).success).toBe(true);
    }
  });

  it('rejeita intervalos não suportados e mantém o objeto extensível para rotas de cliente', () => {
    expect(notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema).safeParse([
      { ...preference, scheduleOffset: 3 },
    ]).success).toBe(false);
    expect(asaasNotificationPreferenceDTOSchema.extend({ id: z.string().optional() }).safeParse(preference).success).toBe(true);
    expect(notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema).safeParse([
      { ...preference, scheduleOffset: 5 }, { ...preference, scheduleOffset: 15 },
    ]).success).toBe(false);
  });
});
