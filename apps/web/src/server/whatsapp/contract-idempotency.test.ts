import { describe, expect, it } from 'vitest';
import { buildContractTemplateIdempotencyKey } from './contract-idempotency';

describe('buildContractTemplateIdempotencyKey', () => {
  const base = {
    phoneNumberId: 'phone-1',
    notificationId: 'notification-1',
    attempt: 1,
    contaId: 'conta-1',
    contratoId: 'contract-1',
    recipientPhone: '5597999999999',
    templateName: 'contrato_matricula_maior_18',
  };

  it('mantém a mesma chave para a mesma tentativa', () => {
    expect(buildContractTemplateIdempotencyKey(base)).toBe(buildContractTemplateIdempotencyKey(base));
  });

  it('gera uma nova chave quando a notificação é reprocessada', () => {
    expect(buildContractTemplateIdempotencyKey(base)).not.toBe(
      buildContractTemplateIdempotencyKey({ ...base, attempt: 2 }),
    );
  });
});
