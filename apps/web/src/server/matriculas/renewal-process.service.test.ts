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

function sourceEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    contaId: 'conta-1',
    alunoId: 'aluno-1',
    responsavelFinanceiroId: 'resp-1',
    turmaId: 'turma-atual',
    planoId: 'plano-atual',
    comboId: null,
    rematriculadaDeId: null,
    dataInicio: new Date('2025-01-01T00:00:00.000Z'),
    dataFimContrato: new Date('2026-01-31T00:00:00.000Z'),
    status: 'ATIVA',
    statusContrato: 'ASSINADO',
    statusFinanceiro: 'REGULAR',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
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
    ...overrides,
  };
}

function chainEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    alunoId: 'aluno-1',
    rematriculadaDeId: null,
    status: 'ATIVA',
    dataInicio: new Date('2025-01-01T00:00:00.000Z'),
    dataFimContrato: new Date('2026-01-31T00:00:00.000Z'),
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('renewal-process.service', () => {
  it('permite campanha ativa sem participante previo para inclusao sob demanda', async () => {
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

    expect(preview.blockers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CAMPAIGN_PARTICIPANT_REQUIRED', sourceEnrollmentId: 'mat-1' }),
      ]),
    );
    const dependencySnapshot = preview.snapshot.dependencySnapshot as {
      campaign?: { missingParticipants?: string[] };
    };
    expect(dependencySnapshot.campaign).toEqual(
      expect.objectContaining({
        missingParticipants: ['mat-1'],
      }),
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

  it('bloqueia origem antiga quando a cadeia ja possui matricula posterior', async () => {
    const source = sourceEnrollment();
    const chainRows = [
      chainEnrollment(),
      chainEnrollment({
        id: 'mat-2',
        rematriculadaDeId: 'mat-1',
        status: 'AGUARDANDO_CONFIRMACAO',
        dataInicio: new Date('2026-02-01T00:00:00.000Z'),
        dataFimContrato: new Date('2027-01-31T00:00:00.000Z'),
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
      }),
    ];
    const prisma = basePrisma({
      matricula: {
        ...basePrisma().matricula,
        findMany: vi.fn().mockResolvedValueOnce([source]).mockResolvedValueOnce(chainRows).mockResolvedValueOnce(chainRows),
      },
    });

    const preview = await previewRenewalProcess(input, { prisma: prisma as never });

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'OUTDATED_SOURCE_ENROLLMENT', sourceEnrollmentId: 'mat-1' }),
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
