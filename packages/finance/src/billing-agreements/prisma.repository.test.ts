import { describe, expect, it, vi } from 'vitest';

import { createPrismaBillingAgreementRepository } from './prisma.repository';

describe('createPrismaBillingAgreementRepository', () => {
  it('usa o customer Asaas canônico do alias e preserva o customer local histórico', async () => {
    const billingAgreementFindFirst = vi.fn().mockResolvedValue({
      id: 'agreement-1',
      contaId: 'conta-1',
      customerId: 'customer-historical',
      customer: { asaasCustomerId: 'cus-historical' },
      payerType: 'ALUNO',
      payerId: 'aluno-1',
      status: 'ACTIVE',
      billingType: 'PIX',
      cycle: 'MONTHLY',
      dueDay: 10,
      nextDueDate: new Date('2026-10-05T00:00:00.000Z'),
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: null,
      desiredValue: 150,
      confirmedValue: 150,
      asaasSubscriptionId: 'sub-1',
      remoteStatus: 'ACTIVE',
      version: 1,
      externalReference: 'agreement:1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      allocations: [],
      legacyStandaloneSubscriptions: [],
      legacySubscriptions: [],
    });
    const customerPayerFindUnique = vi.fn().mockResolvedValue({
      customer: { id: 'customer-canonical', asaasCustomerId: 'cus-canonical' },
    });
    const repository = createPrismaBillingAgreementRepository({
      billingAgreement: { findFirst: billingAgreementFindFirst },
      customerPayer: { findUnique: customerPayerFindUnique },
    } as never);

    const context = await repository.getAgreementContext({
      contaId: 'conta-1',
      agreementId: 'agreement-1',
    });

    expect(context?.agreement.payer).toEqual({
      type: 'ALUNO',
      id: 'aluno-1',
      customerId: 'cus-canonical',
    });
    expect(customerPayerFindUnique).toHaveBeenCalledWith({
      where: { contaId_payerType_payerId: { contaId: 'conta-1', payerType: 'ALUNO', payerId: 'aluno-1' } },
      include: { customer: true },
    });
  });

  it('faz fallback ao papel original em dados legados sem CustomerPayer', async () => {
    const repository = createPrismaBillingAgreementRepository({
      billingAgreement: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'agreement-legacy', contaId: 'conta-1', customerId: 'customer-legacy',
          customer: { asaasCustomerId: 'cus-legacy' }, payerType: 'ALUNO', payerId: 'aluno-1',
          status: 'ACTIVE', billingType: 'PIX', cycle: 'MONTHLY', dueDay: 10,
          nextDueDate: new Date('2026-10-05T00:00:00.000Z'), validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: null, desiredValue: 150, confirmedValue: 150, asaasSubscriptionId: 'sub-legacy',
          remoteStatus: 'ACTIVE', version: 1, externalReference: 'agreement:legacy',
          createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          allocations: [], legacyStandaloneSubscriptions: [], legacySubscriptions: [],
        }),
      },
      customer: {
        findUnique: vi.fn().mockResolvedValue({ asaasCustomerId: 'cus-legacy' }),
      },
    });

    const context = await repository.getAgreementContext({ contaId: 'conta-1', agreementId: 'agreement-legacy' });

    expect(context?.agreement.payer.customerId).toBe('cus-legacy');
  });
});
