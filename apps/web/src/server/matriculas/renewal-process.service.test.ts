import { describe, expect, it, vi } from 'vitest';

import { previewRenewalProcess } from './renewal-process.service';

const now = new Date('2026-01-10T00:00:00.000Z');

function basePrisma(overrides: Record<string, unknown> = {}) {
  return {
    matricula: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'mat-1',
          contaId: 'conta-1',
          alunoId: 'aluno-1',
          responsavelFinanceiroId: 'resp-1',
          turmaId: 'turma-atual',
          planoId: 'plano-atual',
          comboId: null,
          dataInicio: new Date('2025-01-01T00:00:00.000Z'),
          dataFimContrato: new Date('2026-01-31T00:00:00.000Z'),
          status: 'ATIVA',
          statusContrato: 'ASSINADO',
          statusFinanceiro: 'REGULAR',
          updatedAt: now,
          taxaMatricula: 100,
          taxaIsenta: false,
          taxaJustificativa: null,
          formaPagamento: 'BOLETO',
          formaPagamentoTaxa: 'BOLETO',
          vencimentoDia: 10,
          jurosMensal: null,
          multaPercentual: null,
          descontoAntecipado: null,
          prazoDesconto: null,
          billingMode: 'INDIVIDUAL',
          aluno: { id: 'aluno-1', nome: 'Aluno', contaId: 'conta-1' },
          responsavelFinanceiro: { id: 'resp-1', nome: 'Resp', contaId: 'conta-1' },
          plano: { id: 'plano-atual', nome: 'Atual', valor: 100, periodicidade: 'MENSAL', contaId: 'conta-1' },
          combo: null,
          turma: { id: 'turma-atual', nome: 'Atual', contaId: 'conta-1' },
        },
      ]),
      count: vi.fn().mockResolvedValue(0),
    },
    plano: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'plano-1', nome: 'Plano', valor: 150, periodicidade: 'MENSAL', updatedAt: now },
      ]),
    },
    turma: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'turma-1', nome: 'Turma 1', capacidade: 2, updatedAt: now },
      ]),
    },
    combo: { findMany: vi.fn().mockResolvedValue([]) },
    rematriculaCampanha: { findFirst: vi.fn().mockResolvedValue(null) },
    rematriculaParticipante: { findMany: vi.fn().mockResolvedValue([]) },
    rematriculaItem: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    reservaVagaFutura: { count: vi.fn().mockResolvedValue(0) },
    ...overrides,
  };
}

const input = {
  contaId: 'conta-1',
  actorId: 'user-1',
  origin: 'STANDALONE' as const,
  targetPeriodId: '2026',
  holderType: 'RESPONSIBLE' as const,
  holderId: 'resp-1',
  effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
  items: [
    {
      decision: 'RENEW' as const,
      sourceEnrollmentId: 'mat-1',
      target: { type: 'CLASS' as const, targetId: 'turma-1', planId: 'plano-1' },
    },
  ],
};

describe('renewal-process.service', () => {
  it('bloqueia campanha sem participante elegivel', async () => {
    const prisma = basePrisma({
      rematriculaCampanha: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'camp-1',
          status: 'ACTIVE',
          version: 1,
          updatedAt: now,
        }),
      },
    });

    const preview = await previewRenewalProcess(
      { ...input, origin: 'CAMPAIGN', campaignId: 'camp-1' },
      { prisma: prisma as never },
    );

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CAMPAIGN_PARTICIPANT_REQUIRED', sourceEnrollmentId: 'mat-1' }),
      ]),
    );
  });

  it('bloqueia duplicidade ativa para o mesmo vinculo e periodo', async () => {
    const prisma = basePrisma({
      rematriculaItem: {
        findMany: vi.fn().mockResolvedValue([{ matriculaOrigemId: 'mat-1', processoId: 'proc-existente' }]),
        count: vi.fn().mockResolvedValue(0),
      },
    });

    const preview = await previewRenewalProcess(input, { prisma: prisma as never });

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DUPLICATE_SOURCE_TARGET_PERIOD', sourceEnrollmentId: 'mat-1' }),
      ]),
    );
  });

  it('bloqueia turma futura sem capacidade considerando reservas existentes', async () => {
    const prisma = basePrisma({
      matricula: {
        ...basePrisma().matricula,
        count: vi.fn().mockResolvedValue(1),
      },
      reservaVagaFutura: { count: vi.fn().mockResolvedValue(1) },
    });

    const preview = await previewRenewalProcess(input, { prisma: prisma as never });

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TARGET_CLASS_FULL', sourceEnrollmentId: 'mat-1' }),
      ]),
    );
  });
});
