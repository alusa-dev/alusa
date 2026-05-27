import { describe, expect, it } from 'vitest';

import { sanitizeRejectedWebhookPayload, sanitizeWebhookPayload } from './webhook-payload-sanitizer';

describe('webhook payload sanitizer', () => {
  it('redige PII, tokens e dados bancarios sem remover correlacoes financeiras', () => {
    const sanitized = sanitizeWebhookPayload({
      event: 'TRANSFER_DONE',
      id: 'evt_1',
      payment: {
        id: 'pay_1',
        customer: 'cus_1',
        name: 'Maria Responsavel',
        email: 'maria@example.com',
        cpfCnpj: '123.456.789-00',
      },
      transfer: {
        id: 'tr_1',
        bankAccount: {
          ownerName: 'Maria Responsavel',
          cpfCnpj: '12345678900',
          pixAddressKey: 'maria@example.com',
          bank: { name: 'Banco Exemplo', code: '001' },
        },
      },
      authorization: 'Bearer secret-token',
    }) as {
      event: string;
      payment: { id: string; email: string; cpfCnpj: string };
      transfer: { bankAccount: string };
      authorization: string;
    };

    expect(sanitized.event).toBe('TRANSFER_DONE');
    expect(sanitized.payment.id).toBe('pay_1');
    expect(sanitized.payment.email).toBe('[REDACTED]');
    expect(sanitized.payment.cpfCnpj).toBe('[REDACTED]');
    expect(sanitized.transfer.bankAccount).toBe('[REDACTED]');
    expect(sanitized.authorization).toBe('[REDACTED]');
  });

  it('nao persiste rejeicao bruta invalida', () => {
    const sanitized = sanitizeRejectedWebhookPayload('cpf 123.456.789-00 token Bearer abc');
    expect(JSON.stringify(sanitized)).not.toContain('123.456.789-00');
    expect(JSON.stringify(sanitized)).not.toContain('Bearer abc');
  });
});
