import { describe, expect, it } from 'vitest';

import { resolveChargeDisplayStatus } from '../asaas-display-status';

describe('resolvePaymentDriftIssueType (snapshot semantics)', () => {
  it('treats missing persisted asaasStatus as stale snapshot display fallback', () => {
    expect(
      resolveChargeDisplayStatus({
        localStatus: 'PAGO',
        asaasStatus: null,
        liquidacaoStatus: 'PENDENTE',
        hasAsaasLink: true,
      }).label,
    ).toBe('Confirmada');
  });

  it('prefers remote asaas status over local PAGO for display', () => {
    expect(
      resolveChargeDisplayStatus({
        localStatus: 'PAGO',
        asaasStatus: 'RECEIVED',
        liquidacaoStatus: 'PENDENTE',
        hasAsaasLink: true,
      }),
    ).toMatchObject({ label: 'Recebida', source: 'asaas' });
  });
});
