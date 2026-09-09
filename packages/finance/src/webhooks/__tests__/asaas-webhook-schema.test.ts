import { describe, expect, it } from 'vitest';

import { parseAsaasWebhookPayload } from '../asaas-webhook-schema';

describe('asaasWebhookPayloadSchema', () => {
  it('aceita payload oficial e preserva campos novos do provedor', () => {
    const result = parseAsaasWebhookPayload(JSON.stringify({
      id: 'evt_1',
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: 'pay_1',
        status: 'RECEIVED',
        futureProviderField: { version: 2 },
      },
    }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.payload.payment as Record<string, unknown>).futureProviderField).toEqual({ version: 2 });
    }
  });

  it('aceita evento desconhecido sem recurso conhecido para permitir observabilidade', () => {
    const result = parseAsaasWebhookPayload(JSON.stringify({
      id: 'evt_unknown',
      event: 'NEW_PROVIDER_EVENT',
      futureResource: { id: 'resource_1' },
    }));

    expect(result.success).toBe(true);
  });

  it('rejeita JSON inválido', () => {
    expect(parseAsaasWebhookPayload('{')).toEqual({
      success: false,
      reason: 'JSON inválido',
    });
  });

  it('rejeita recurso conhecido sem id', () => {
    const result = parseAsaasWebhookPayload(JSON.stringify({
      id: 'evt_2',
      event: 'PAYMENT_UPDATED',
      payment: { status: 'PENDING' },
    }));

    expect(result).toMatchObject({
      success: false,
      reason: 'Payload inválido em payment.id',
    });
  });
});
