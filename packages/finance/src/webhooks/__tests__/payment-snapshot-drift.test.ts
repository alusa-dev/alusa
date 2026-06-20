import { describe, expect, it } from 'vitest';

import { resolveChargeDisplayStatus } from '../../mappers/asaas-display-status';
import { resolveMonotonicAsaasPaymentStatus } from '../../mappers/asaas-snapshot-monotonicity';

describe('payment snapshot drift semantics', () => {
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

  it('prefers remote asaas status over local PAGO when snapshot is consistent', () => {
    expect(
      resolveChargeDisplayStatus({
        localStatus: 'PAGO',
        asaasStatus: 'RECEIVED',
        liquidacaoStatus: 'PENDENTE',
        hasAsaasLink: true,
      }),
    ).toMatchObject({ label: 'Recebida', source: 'asaas' });
  });

  it('blocks webhook snapshot regression from CONFIRMED to PENDING on paid charge', () => {
    expect(
      resolveMonotonicAsaasPaymentStatus({
        currentAsaasStatus: 'CONFIRMED',
        incoming: 'PENDING',
        localChargeStatus: 'PAID',
      }),
    ).toBe('CONFIRMED');
  });
});
