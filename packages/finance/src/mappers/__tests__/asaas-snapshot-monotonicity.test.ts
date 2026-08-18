import { describe, expect, it } from 'vitest';

import {
  hasAsaasSnapshotDrift,
  resolveMonotonicAsaasPaymentStatus,
} from '../asaas-snapshot-monotonicity';
import { resolveChargeDisplayStatus } from '../asaas-display-status';

describe('resolveMonotonicAsaasPaymentStatus', () => {
  it('não regride CONFIRMED para PENDING quando charge local já está PAID', () => {
    expect(
      resolveMonotonicAsaasPaymentStatus({
        currentAsaasStatus: 'CONFIRMED',
        incoming: 'PENDING',
        localChargeStatus: 'PAID',
      }),
    ).toBe('CONFIRMED');
  });

  it('não regride CONFIRMED para PENDING quando cobranca local já está PAGO', () => {
    expect(
      resolveMonotonicAsaasPaymentStatus({
        currentAsaasStatus: 'CONFIRMED',
        incoming: 'PENDING',
        localCobrancaStatus: 'PAGO',
      }),
    ).toBe('CONFIRMED');
  });

  it('permite avançar de PENDING para CONFIRMED', () => {
    expect(
      resolveMonotonicAsaasPaymentStatus({
        currentAsaasStatus: 'PENDING',
        incoming: 'CONFIRMED',
        localChargeStatus: 'OPEN',
      }),
    ).toBe('CONFIRMED');
  });

  it('permite transição terminal para REFUNDED mesmo após pagamento', () => {
    expect(
      resolveMonotonicAsaasPaymentStatus({
        currentAsaasStatus: 'CONFIRMED',
        incoming: 'REFUNDED',
        localChargeStatus: 'PAID',
      }),
    ).toBe('REFUNDED');
  });

  it('não regride snapshot pago para OVERDUE quando local está PAID', () => {
    expect(
      resolveMonotonicAsaasPaymentStatus({
        currentAsaasStatus: 'CONFIRMED',
        incoming: 'OVERDUE',
        localChargeStatus: 'PAID',
      }),
    ).toBe('CONFIRMED');
  });
});

describe('hasAsaasSnapshotDrift', () => {
  it('detecta drift quando local está pago e snapshot Asaas ainda é PENDING', () => {
    expect(
      hasAsaasSnapshotDrift({
        asaasStatus: 'PENDING',
        localChargeStatus: 'PAID',
      }),
    ).toBe(true);
  });

  it('não sinaliza drift quando snapshot e local estão alinhados', () => {
    expect(
      hasAsaasSnapshotDrift({
        asaasStatus: 'CONFIRMED',
        localChargeStatus: 'PAID',
      }),
    ).toBe(false);
  });
});

describe('resolveChargeDisplayStatus with stale asaas snapshot', () => {
  it('mantém cancelamento local mesmo quando o snapshot do Asaas está pendente', () => {
    expect(
      resolveChargeDisplayStatus({
        localStatus: 'CANCELED',
        asaasStatus: 'PENDING',
        liquidacaoStatus: 'PENDENTE',
        hasAsaasLink: true,
      }),
    ).toMatchObject({
      status: 'CANCELED',
      label: 'Cancelada',
      source: 'local',
    });
  });

  it('ignora asaasStatus PENDING stale e usa fallback de pagamento local', () => {
    expect(
      resolveChargeDisplayStatus({
        localStatus: 'PAID',
        asaasStatus: 'PENDING',
        liquidacaoStatus: 'PENDENTE',
        hasAsaasLink: true,
      }),
    ).toMatchObject({
      label: 'Confirmada',
      source: 'liquidacao',
    });
  });
});
