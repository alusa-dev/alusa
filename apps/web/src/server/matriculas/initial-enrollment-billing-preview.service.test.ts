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
      ]),
    );
  });
});
