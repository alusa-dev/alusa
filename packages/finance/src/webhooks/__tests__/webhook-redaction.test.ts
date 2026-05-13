import { describe, expect, it } from 'vitest';

import { redactWebhookLogObject, redactWebhookString } from '../webhook-redaction';

describe('webhook-redaction', () => {
  it('mascara token, CPF/CNPJ, email e telefone em strings', () => {
    const value = 'token whsec_abcdefghijklmnopqrstuvwxyz123 email user@test.com cpf 123.456.789-09 tel (11) 98888-7777';

    const redacted = redactWebhookString(value);

    expect(redacted).not.toContain('whsec_abcdefghijklmnopqrstuvwxyz123');
    expect(redacted).not.toContain('user@test.com');
    expect(redacted).not.toContain('123.456.789-09');
    expect(redacted).not.toContain('98888-7777');
  });

  it('mascara chaves sensíveis e payload bruto em objetos de log', () => {
    const redacted = redactWebhookLogObject({
      contaId: 'conta-1',
      token: 'raw-token-with-enough-length',
      payload: {
        customer: {
          name: 'Maria Silva',
          email: 'maria@example.com',
          cpfCnpj: '12345678909',
        },
      },
      error: new Error('Falha para maria@example.com usando raw-token-with-enough-length'),
    });

    const serialized = JSON.stringify(redacted);
    expect(serialized).toContain('conta-1');
    expect(serialized).not.toContain('raw-token-with-enough-length');
    expect(serialized).not.toContain('maria@example.com');
    expect(serialized).not.toContain('Maria Silva');
    expect(serialized).not.toContain('12345678909');
    expect(redacted.payload).toBe('[REDACTED]');
  });
});
