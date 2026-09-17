import { describe, expect, it } from 'vitest';

import { policyBlockedError } from '../mutation-errors';

describe('cobrancas mutation errors', () => {
  it('preserva o contrato 409 para bloqueio de cobrança paga', async () => {
    const response = policyBlockedError({
      action: 'EDIT',
      source: 'ASAAS',
      status: 'RECEIVED',
      decision: {
        allowed: false,
        code: 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE',
        reason: 'Cobrança já foi paga.',
        hint: 'Use o fluxo de estorno.',
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'EDIT_NOT_ALLOWED_FOR_PAID_CHARGE',
      error: 'Cobrança já foi paga.',
      asaasStatus: 'RECEIVED',
      hint: 'Use o fluxo de estorno.',
    });
  });

  it('usa o fallback legado quando a decisão não possui código', async () => {
    const response = policyBlockedError({
      action: 'CANCEL',
      source: 'LOCAL',
      status: 'PENDENTE',
      decision: { allowed: false },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      code: 'CANCEL_NOT_ALLOWED_FOR_CHARGE_STATUS',
      error: 'Não é possível cancelar cobrança com status PENDENTE.',
      status: 'PENDENTE',
    });
  });
});
