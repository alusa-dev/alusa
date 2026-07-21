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
      targetLabel: 'Assinatura de Aluno atual',
    });
  });

  it('bloqueia unificação no próximo ciclo sem processador financeiro', async () => {
    const preview = await previewInitialEnrollmentBilling(
      {
        ...baseInput,
        strategy: 'UNIFY_NEXT_CYCLE',
        existingFamilyGroupId: 'family:fam-1',
      },
      { prisma: buildPrisma() as never },
    );

    expect(preview.compatibility.compatible).toBe(false);
    expect(preview.compatibility.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNIFICACAO_PROXIMO_CICLO_NAO_SUPORTADA' }),
      ]),
    );
  });
});
