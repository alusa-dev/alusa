import { describe, expect, it } from 'vitest';

import {
  shouldFetchAcademicAsaasDetail,
  shouldFetchStandaloneAsaasDetail,
} from '@/src/server/finance/asaas-payment-detail-policy';

describe('shouldFetchStandaloneAsaasDetail', () => {
  const now = new Date('2026-06-17T12:00:00.000Z');

  it('não busca remoto para cobrança OPEN com snapshot local recente', () => {
    expect(
      shouldFetchStandaloneAsaasDetail({
        forceRefresh: false,
        isAsaasActive: true,
        now,
        charge: {
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          asaasStatus: 'PENDING',
          updatedAt: new Date('2026-06-17T11:58:00.000Z'),
          billingType: 'CREDIT_CARD',
        },
      }),
    ).toBe(false);
  });

  it('busca remoto quando fresh=1', () => {
    expect(
      shouldFetchStandaloneAsaasDetail({
        forceRefresh: true,
        isAsaasActive: true,
        now,
        charge: {
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          asaasStatus: 'PENDING',
          updatedAt: new Date('2026-06-17T11:58:00.000Z'),
        },
      }),
    ).toBe(true);
  });

  it('busca remoto quando não há snapshot local', () => {
    expect(
      shouldFetchStandaloneAsaasDetail({
        forceRefresh: false,
        isAsaasActive: true,
        now,
        charge: {
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          updatedAt: new Date('2026-06-17T11:58:00.000Z'),
        },
      }),
    ).toBe(true);
  });
});

describe('shouldFetchAcademicAsaasDetail', () => {
  const now = new Date('2026-06-17T12:00:00.000Z');

  it('não busca remoto para cobrança pendente com snapshot local', () => {
    expect(
      shouldFetchAcademicAsaasDetail({
        forceRefresh: false,
        isAsaasActive: true,
        now,
        cobranca: {
          asaasPaymentId: 'pay_1',
          status: 'PENDENTE',
          asaasStatus: 'PENDING',
          lastAsaasFetchAt: new Date('2026-06-17T11:59:00.000Z'),
          formaPagamento: 'CARTAO_CREDITO',
          charge: { invoiceUrl: 'https://pay.example', billingType: 'CREDIT_CARD' },
        },
      }),
    ).toBe(false);
  });
});
