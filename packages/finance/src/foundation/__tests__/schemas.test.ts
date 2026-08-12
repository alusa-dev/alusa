import { describe, expect, it } from 'vitest';

import { createWebhookPayloadDto } from '../schemas';

describe('createWebhookPayloadDto', () => {
  const basePayload = {
    name: 'Alusa webhook',
    url: 'https://app.alusa.com.br/api/webhooks/asaas',
    email: 'financeiro@alusa.com.br',
    events: ['PAYMENT_CREATED'],
  };

  it('segue o mínimo de 32 caracteres exigido pelo Asaas para authToken', () => {
    expect(createWebhookPayloadDto.safeParse({ ...basePayload, authToken: 'a'.repeat(31) }).success).toBe(false);
    expect(createWebhookPayloadDto.safeParse({ ...basePayload, authToken: 'a'.repeat(32) }).success).toBe(true);
  });
});
