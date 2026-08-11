import { describe, expect, it, vi } from 'vitest';

import { previewInitialEnrollmentBilling } from './initial-enrollment-billing-preview.service';

const updatedAt = new Date('2026-01-01T12:00:00.000Z');

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    aluno: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'aluno-1', nome: 'Ana', updatedAt },
      ]),
    },
    plano: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'plano-1',
          nome: 'Mensal',
          valor: 200,
          periodicidade: 'MENSAL',
          updatedAt,
        },
      ]),
    },
    combo: { findMany: vi.fn().mockResolvedValue([]) },
    desconto: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'desc-1', tipo: 'FIXO', valor: 20, updatedAt },
      ]),
    },
    responsavel: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'resp-1',
        nome: 'Responsavel',
        cpf: '12345678909',
        email: 'resp@example.com',
        telefone: '11999999999',
        asaasCustomerId: null,
      }),
    },
    matriculaFamiliar: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    subscription: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    familyFinancialAllocation: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    ...overrides,
  };
}

const baseInput = {
  contaId: 'conta-1',
  strategy: 'CREATE_SEPARATE' as const,
  responsavelFinanceiroId: 'resp-1',
  existingFamilyGroupId: null,
  dataInicio: new Date('2026-02-01T12:00:00.000Z'),
  dataFimContrato: new Date('2026-12-31T12:00:00.000Z'),
  formaPagamento: 'PIX',
  vencimentoDia: 10,
  descontoIds: ['desc-1'],
  items: [
    {
      alunoId: 'aluno-1',
      planoId: 'plano-1',
      turmaId: 'turma-1',
      taxaMatricula: 100,
    },
  ],
};

function existingSubscription(options: {
  status?: string;
  paymentStatus?: string;
  asaasStatus?: string | null;
  agreementNextDueDate?: Date;
  dataFimContrato?: Date;
} = {}) {
  return {
    id: 'sub-local-1',
    asaasSubscriptionId: 'sub_asaas_1',
    status: options.status ?? 'ACTIVE',
    updatedAt,
    billingAgreement: options.agreementNextDueDate
      ? {
          status: 'ACTIVE',
          remoteStatus: 'ACTIVE',
          nextDueDate: options.agreementNextDueDate,
          validUntil: null,
        }
      : null,
    matricula: {
      id: 'mat-atual',
      alunoId: 'aluno-atual',
      responsavelFinanceiroId: 'resp-1',
      formaPagamento: 'PIX',
      vencimentoDia: 10,
      dataInicio: new Date('2026-01-01T12:00:00.000Z'),
      dataFimContrato: options.dataFimContrato ?? baseInput.dataFimContrato,
      aluno: { id: 'aluno-atual', nome: 'Aluno atual' },
      plano: { valor: 200, periodicidade: 'MENSAL' },
      combo: null,
      cobrancas:
        options.paymentStatus || options.asaasStatus
          ? [
              {
                id: 'cobranca-atual',
                status: options.paymentStatus ?? 'A_VENCER',
                asaasStatus: options.asaasStatus ?? null,
                vencimento: new Date('2026-02-10T12:00:00.000Z'),
                competenciaInicio: new Date('2026-02-01T12:00:00.000Z'),
                competenciaFim: new Date('2026-02-28T12:00:00.000Z'),
              },
            ]
          : [],
    },
  };
}

describe('previewInitialEnrollmentBilling', () => {
  it('gera preview compatível com hash, sourceVersion e allocations por matrícula', async () => {
    const prisma = buildPrisma();

    const preview = await previewInitialEnrollmentBilling(baseInput, {
      prisma: prisma as never,
    });

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.sourceVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(preview.billingStrategy).toEqual({ kind: 'SEPARATE' });
    expect(preview.totals).toEqual({
      monthlyTotal: 180,
      enrollmentFeeTotal: 100,
      itemCount: 1,
    });
    expect(preview.billingImpact).toEqual({
      currentMonthlyAmount: 0,
      addedMonthlyAmount: 180,
      resultingMonthlyAmount: 180,
      enrollmentFeeAmount: 100,
      application: 'SEPARATE',
      updatesPendingPayments: false,
      currentCycleAction: 'CREATE_SEPARATE',
      currentChargeState: 'NOT_GENERATED',
      currentChargeId: null,
      currentChargeDueDate: null,
      nextCycleDate: expect.any(String),
      operationalMessage: 'Será criada uma cobrança recorrente separada para esta matrícula.',
      targetLabel: null,
    });
    expect(preview.groups[0]?.allocations[0]).toEqual(
      expect.objectContaining({
        alunoId: 'aluno-1',
        alunoNome: 'Ana',
        planoId: 'plano-1',
        turmaId: 'turma-1',
        baseAmount: 200,
        amount: 180,
        discountAmount: 20,
        enrollmentFeeAmount: 100,
      }),
    );
  });

  it('bloqueia inclusão em agrupamento existente quando pagador e vencimento são incompatíveis', async () => {
    const prisma = buildPrisma({
      matriculaFamiliar: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fam-1',
          responsavelId: 'resp-2',
          formaPagamento: 'BOLETO',
          diaVencimento: 5,
          dataInicio: new Date('2026-01-01T12:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T12:00:00.000Z'),
          valorMensalidadeTotal: 200,
          status: 'ATIVO',
          updatedAt,
        }),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'fam-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(false);
    expect(preview.billingStrategy).toEqual({
      kind: 'JOIN_EXISTING_CURRENT_CYCLE',
      financialGroupId: 'fam-1',
      effectiveAt: baseInput.dataInicio.toISOString(),
    });
    expect(preview.compatibility.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        'PAGADOR_INCOMPATIVEL',
        'FORMA_PAGAMENTO_INCOMPATIVEL',
        'VENCIMENTO_INCOMPATIVEL',
        'AGRUPAMENTO_FAMILIAR_NAO_SUPORTADO',
      ]),
    );
  });

  it('mostra valor atual, acréscimo e total ao incluir em assinatura existente', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'sub-local-1',
          asaasSubscriptionId: 'sub_asaas_1',
          status: 'ACTIVE',
          updatedAt,
          matricula: {
            id: 'mat-atual',
            alunoId: 'aluno-atual',
            responsavelFinanceiroId: 'resp-1',
            formaPagamento: 'PIX',
            vencimentoDia: 10,
            dataInicio: new Date('2026-01-01T12:00:00.000Z'),
            dataFimContrato: baseInput.dataFimContrato,
            aluno: { id: 'aluno-atual', nome: 'Aluno atual' },
            plano: { valor: 200, periodicidade: 'MENSAL' },
            combo: null,
            cobrancas: [
              {
                id: 'cobranca-1',
                status: 'A_VENCER',
                asaasStatus: 'PENDING',
                vencimento: new Date('2026-02-10T12:00:00.000Z'),
                competenciaInicio: new Date('2026-02-01T12:00:00.000Z'),
                competenciaFim: new Date('2026-02-28T12:00:00.000Z'),
              },
            ],
          },
        }),
      },
      familyFinancialAllocation: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 50 } }),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.billingImpact).toEqual({
      currentMonthlyAmount: 250,
      addedMonthlyAmount: 180,
      resultingMonthlyAmount: 430,
      enrollmentFeeAmount: 100,
      application: 'CURRENT_CYCLE',
      updatesPendingPayments: true,
      currentCycleAction: 'UPDATE_PENDING',
      currentChargeState: 'PENDING',
      currentChargeId: 'cobranca-1',
      currentChargeDueDate: '2026-02-10T12:00:00.000Z',
      nextCycleDate: '2026-02-10T12:00:00.000Z',
      operationalMessage:
        'A cobrança pendente do ciclo atual poderá ser atualizada para o novo valor após confirmação do preflight.',
      targetLabel: 'Assinatura de Aluno atual',
    });
  });

  it('permite unificação no próximo ciclo quando o agrupamento de destino está provisionado', async () => {
    const prisma = buildPrisma({
      matriculaFamiliar: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fam-1',
          responsavelId: 'resp-1',
          formaPagamento: 'PIX',
          diaVencimento: 10,
          dataInicio: new Date('2026-01-01T12:00:00.000Z'),
          dataFimContrato: baseInput.dataFimContrato,
          valorMensalidadeTotal: 250,
          status: 'ATIVO',
          billingProvisionStatus: 'PROVISIONADO',
          standaloneSubscriptionId: 'standalone-1',
          updatedAt,
        }),
      },
      standaloneSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'standalone-1',
          status: 'ACTIVE',
          asaasSubscriptionId: 'sub_asaas_family_1',
          value: 250,
          version: 1,
          updatedAt,
        }),
      },
    });
    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'UNIFY_NEXT_CYCLE',
        existingFamilyGroupId: 'family:fam-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.billingImpact).toEqual(
      expect.objectContaining({
        currentMonthlyAmount: 250,
        addedMonthlyAmount: 180,
        resultingMonthlyAmount: 430,
        application: 'NEXT_CYCLE',
        updatesPendingPayments: false,
      }),
    );
  });

  it('preserva o preço agregado promocional do plano familiar sem multiplicar por aluno', async () => {
    const prisma = buildPrisma({
      aluno: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'aluno-1', nome: 'Ana', updatedAt },
          { id: 'aluno-2', nome: 'Bia', updatedAt },
        ]),
      },
      matriculaFamiliar: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'fam-1',
          responsavelId: 'resp-1',
          formaPagamento: 'PIX',
          diaVencimento: 10,
          ciclo: 'MONTHLY',
          dataInicio: new Date('2026-01-01T12:00:00.000Z'),
          dataFimContrato: baseInput.dataFimContrato,
          valorMensalidadeTotal: 300,
          status: 'ATIVO',
          billingProvisionStatus: 'PROVISIONADO',
          standaloneSubscriptionId: 'standalone-1',
          billingVersion: 2,
          updatedAt,
        }),
      },
      standaloneSubscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'standalone-1',
          status: 'ACTIVE',
          asaasSubscriptionId: 'sub_asaas_1',
          value: 300,
          version: 2,
          updatedAt,
        }),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        enrollmentMode: 'FAMILY',
        familyPricingMode: 'AGGREGATE_PLAN',
        aggregateMonthlyAmount: 150,
        billingStrategy: {
          kind: 'JOIN_EXISTING_CURRENT_CYCLE',
          financialGroupId: 'family:fam-1',
          effectiveAt: baseInput.dataInicio.toISOString(),
        },
        items: [
          baseInput.items[0]!,
          { ...baseInput.items[0]!, alunoId: 'aluno-2', turmaId: 'turma-2' },
        ],
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.totals.monthlyTotal).toBe(150);
    expect(preview.billingImpact).toEqual(
      expect.objectContaining({
        currentMonthlyAmount: 300,
        addedMonthlyAmount: 150,
        resultingMonthlyAmount: 450,
      }),
    );
  });

  it('não promete alterar cobrança já confirmada e prevê complemento no ciclo atual', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue(
          existingSubscription({ paymentStatus: 'PAGO', asaasStatus: 'CONFIRMED' }),
        ),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.billingImpact).toEqual(
      expect.objectContaining({
        currentCycleAction: 'CREATE_COMPLEMENT',
        currentChargeState: 'PAID',
        updatesPendingPayments: false,
      }),
    );
    expect(preview.billingImpact.operationalMessage).toContain('já foi paga e não será alterada');
  });

  it('encaminha cobrança vencida para revisão em vez de tentar atualizá-la', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue(
          existingSubscription({ paymentStatus: 'ATRASADO', asaasStatus: 'OVERDUE' }),
        ),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(false);
    expect(preview.billingImpact.currentCycleAction).toBe('MANUAL_REVIEW');
    expect(preview.billingImpact.updatesPendingPayments).toBe(false);
    expect(preview.compatibility.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'COBRANCA_ATUAL_VENCIDA_REQUER_REVISAO' }),
      ]),
    );
  });

  it('bloqueia unificação em assinatura expirada', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue(existingSubscription({ status: 'EXPIRED' })),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(false);
    expect(preview.compatibility.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ASSINATURA_EXISTENTE_INDISPONIVEL' }),
      ]),
    );
  });

  it('bloqueia snapshot local ativo quando o Asaas informa assinatura expirada', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue(existingSubscription({ status: 'ACTIVE' })),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      {
        prisma: prisma as never,
        getRemoteSubscription: vi.fn().mockResolvedValue({ status: 'EXPIRED', deleted: false }),
      },
    );

    expect(preview.compatibility.blockers).toContainEqual(
      expect.objectContaining({ code: 'ASSINATURA_REMOTA_INDISPONIVEL' }),
    );
  });

  it('bloqueia próximo ciclo quando a matrícula termina antes da aplicação', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue(
          existingSubscription({ agreementNextDueDate: new Date('2026-03-10T12:00:00.000Z') }),
        ),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        dataFimContrato: new Date('2026-02-28T12:00:00.000Z'),
        strategy: 'UNIFY_NEXT_CYCLE',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(false);
    expect(preview.billingImpact.currentCycleAction).toBe('SCHEDULE_NEXT_CYCLE');
    expect(preview.compatibility.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CONTRATO_TERMINA_ANTES_PROXIMO_CICLO' }),
      ]),
    );
  });

  it('aceita vigências diferentes e mantém a data por alocação', async () => {
    const prisma = buildPrisma({
      subscription: {
        findFirst: vi.fn().mockResolvedValue(
          existingSubscription({
            dataFimContrato: new Date('2027-12-31T12:00:00.000Z'),
            paymentStatus: 'A_VENCER',
            asaasStatus: 'PENDING',
          }),
        ),
      },
    });

    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'INCLUDE_EXISTING',
        existingFamilyGroupId: 'subscription:sub-local-1',
      },
      { prisma: prisma as never },
    );

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.compatibility.blockers.map((blocker) => blocker.code)).not.toContain(
      'VIGENCIA_INCOMPATIVEL',
    );
    expect(preview.compatibility.warnings.join(' ')).toContain('vigência própria');
    expect(preview.validityImpact).toEqual(
      expect.objectContaining({
        addedEndDate: '2026-12-31T12:00:00.000Z',
        resultingEndDate: '2027-12-31T12:00:00.000Z',
        isDifferent: true,
      }),
    );
  });

  it('classifica contrato curto separado como cobrança avulsa', async () => {
    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        dataInicio: new Date('2099-02-01T12:00:00.000Z'),
        dataFimContrato: new Date('2099-02-05T12:00:00.000Z'),
      },
      { prisma: buildPrisma() as never },
    );

    expect(preview.compatibility.compatible).toBe(true);
    expect(preview.billingImpact.currentCycleAction).toBe('CREATE_ONE_TIME_CHARGE');
    expect(preview.billingImpact.operationalMessage).toContain('cobrança avulsa');
  });
});
