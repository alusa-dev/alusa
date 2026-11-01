import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { asaasNotificationPreferenceDTOSchema, normalizeAsaasNotificationPreferencesForRead, notificationPreferenceArraySchema } from '@/features/settings/notifications/asaas/dtos';

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

  it('normaliza lembretes legados na leitura priorizando habilitado e, em empate, maior intervalo', () => {
    const preferences = [
      { ...preference, id: 'due', event: 'PAYMENT_DUEDATE_WARNING' as const, scheduleOffset: 0 },
      { ...preference, id: 'five', event: 'PAYMENT_DUEDATE_WARNING' as const, scheduleOffset: 5, enabled: true },
      { ...preference, id: 'ten', event: 'PAYMENT_DUEDATE_WARNING' as const, scheduleOffset: 10, enabled: true },
      { ...preference, id: 'other', event: 'PAYMENT_CREATED' as const, scheduleOffset: 0 },
    ];

    const normalized = normalizeAsaasNotificationPreferencesForRead(preferences);

    expect(normalized.map(({ id }) => id)).toEqual(['due', 'ten', 'other']);
    expect(normalized.filter(({ event, scheduleOffset }) => event === 'PAYMENT_DUEDATE_WARNING' && scheduleOffset > 0)).toHaveLength(1);
    expect(normalized.find(({ id }) => id === 'other')).toEqual(preferences[3]);
    expect(notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema).safeParse(normalized).success).toBe(true);
    expect(notificationPreferenceArraySchema(asaasNotificationPreferenceDTOSchema).safeParse(preferences).success).toBe(false);
  });

  it('prioriza o lembrete habilitado mesmo quando há um intervalo maior desabilitado', () => {
    const normalized = normalizeAsaasNotificationPreferencesForRead([
      { ...preference, event: 'PAYMENT_DUEDATE_WARNING' as const, scheduleOffset: 5, enabled: true },
      { ...preference, event: 'PAYMENT_DUEDATE_WARNING' as const, scheduleOffset: 10, enabled: false },
    ]);

    expect(normalized.map(({ scheduleOffset }) => scheduleOffset)).toEqual([5]);
  });
});
