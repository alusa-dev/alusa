import { describe, expect, it } from 'vitest';

import { normalizeAsaasPaymentSnapshotStatus } from '../asaas-payment-snapshot-status';

describe('normalizeAsaasPaymentSnapshotStatus', () => {
  it('prioriza deleted=true como DELETED mesmo com status pendente', () => {
    expect(
      normalizeAsaasPaymentSnapshotStatus({
        eventName: 'PAYMENT_DELETED',
        status: 'PENDING',
        deleted: true,
      }),
    ).toBe('DELETED');
  });

  it('normaliza recebimento em dinheiro enviado como PAYMENT_RECEIVED + RECEIVED', () => {
    expect(
      normalizeAsaasPaymentSnapshotStatus({
        eventName: 'PAYMENT_RECEIVED',
        status: 'RECEIVED',
        billingType: 'RECEIVED_IN_CASH',
      }),
    ).toBe('RECEIVED_IN_CASH');
  });

  it('normaliza polling de dinheiro quando o status remoto ja esta recebido', () => {
    expect(
      normalizeAsaasPaymentSnapshotStatus({
        status: 'RECEIVED',
        billingType: 'RECEIVED_IN_CASH',
      }),
    ).toBe('RECEIVED_IN_CASH');
  });

  it('nao transforma PENDING em dinheiro sem evento de recebimento', () => {
    expect(
      normalizeAsaasPaymentSnapshotStatus({
        status: 'PENDING',
        billingType: 'RECEIVED_IN_CASH',
      }),
    ).toBe('PENDING');
  });

  it('nao transforma desfazer recebimento em dinheiro em recebido', () => {
    expect(
      normalizeAsaasPaymentSnapshotStatus({
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        status: 'PENDING',
        billingType: 'RECEIVED_IN_CASH',
      }),
    ).toBe('PENDING');
  });
});
