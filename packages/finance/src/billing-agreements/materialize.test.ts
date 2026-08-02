import { describe, expect, it, vi } from 'vitest';

import { materializeBillingAgreement } from './materialize';

vi.mock('@alusa/database', () => ({ prisma: {} }));

describe('materializeBillingAgreement', () => {
  it('usa fim exclusivo no dia seguinte para a alocação da taxa de matrícula', async () => {
    const competence = new Date('2099-01-10T12:00:00.000Z');
    const billingAllocationCreate = vi.fn().mockResolvedValue({ id: 'allocation-1' });
    const tx = {
      subscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'subscription-1',
          contaId: 'conta-1',
          matriculaId: 'matricula-1',
          externalReference: 'subscription:matricula-1',
          status: 'ACTIVE',
          asaasSubscriptionId: 'asaas-subscription-1',
          matricula: {
            id: 'matricula-1',
            alunoId: 'aluno-1',
            responsavelFinanceiroId: null,
            vencimentoDia: 10,
            dataInicio: competence,
            dataFimContrato: new Date('2099-12-10T12:00:00.000Z'),
            cobrancas: [{ tipo: 'TAXA_MATRICULA', charge: { id: 'charge-1' } }],
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customer: {
        findUnique: vi.fn().mockResolvedValue({ id: 'customer-1' }),
      },
      billingAgreement: {
        upsert: vi.fn().mockResolvedValue({ id: 'agreement-1' }),
      },
      familyFinancialAllocation: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'legacy-fee-1',
            alunoId: 'aluno-1',
            matriculaId: 'matricula-1',
            chargeKind: 'TAXA_MATRICULA',
            amount: 80,
            baseAmount: 80,
            discountAmount: 0,
            competenceStart: competence,
            competenceEnd: competence,
            sourceChargeId: null,
            billingAllocationId: null,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingAllocation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: billingAllocationCreate,
      },
    };

    await materializeBillingAgreement(
      {
        kind: 'INDIVIDUAL',
        contaId: 'conta-1',
        subscriptionId: 'subscription-1',
        actorId: 'user-1',
        value: 150,
        billingType: 'PIX',
        cycle: 'MONTHLY',
        nextDueDate: '2099-01-10',
        validUntil: '2099-12-10',
      },
      { tx: tx as never },
    );

    expect(billingAllocationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'ENROLLMENT_FEE',
        recurring: false,
        validFrom: competence,
        validUntil: new Date('2099-01-11T12:00:00.000Z'),
        prorationPolicy: 'MANUAL',
      }),
    });
  });

  it('converte o fim inclusivo da mensalidade familiar em limite exclusivo', async () => {
    const competenceStart = new Date('2099-01-10T12:00:00.000Z');
    const competenceEnd = new Date('2099-12-10T12:00:00.000Z');
    const billingAllocationCreate = vi.fn().mockResolvedValue({ id: 'allocation-family-1', status: 'ACTIVE' });
    const billingAgreementUpsert = vi.fn().mockResolvedValue({ id: 'agreement-family-1' });
    const tx = {
      standaloneSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'standalone-1', contaId: 'conta-1', familyGroupId: 'family-1',
          customerId: 'customer-1', customer: { payerType: 'RESPONSAVEL', payerId: 'payer-1' },
          externalReference: 'family:family-1', status: 'ACTIVE', asaasSubscriptionId: 'asaas-family-1',
          billingType: 'PIX', cycle: 'MONTHLY', nextDueDate: competenceStart,
          validFrom: competenceStart, validUntil: null, endDate: competenceEnd,
          value: 150, remoteStatus: 'ACTIVE', createdAt: competenceStart,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingAgreement: { upsert: billingAgreementUpsert },
      familyFinancialAllocation: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'legacy-family-1', alunoId: 'aluno-1', matriculaId: 'matricula-1',
          chargeKind: 'MENSALIDADE', amount: 150, baseAmount: 150, discountAmount: 0,
          competenceStart, competenceEnd, sourceChargeId: null, billingAllocationId: null,
        }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      billingAllocation: { findFirst: vi.fn().mockResolvedValue(null), create: billingAllocationCreate },
    };

    await materializeBillingAgreement({
      kind: 'FAMILY', contaId: 'conta-1', standaloneSubscriptionId: 'standalone-1', familyGroupId: 'family-1',
    }, { tx: tx as never });

    expect(billingAllocationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      kind: 'TUITION', recurring: true, validUntil: new Date('2099-12-11T12:00:00.000Z'),
    }) });
    expect(billingAgreementUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ validUntil: new Date('2099-12-11T12:00:00.000Z') }),
      update: expect.objectContaining({ validUntil: new Date('2099-12-11T12:00:00.000Z') }),
    }));
  });
});
