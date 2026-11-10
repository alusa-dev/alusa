import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    rematriculaItem: {
      findMany: vi.fn(),
    },
    matricula: {
      findMany: vi.fn(),
    },
    customer: {
      findMany: vi.fn(),
    },
    charge: {
      findMany: vi.fn(),
    },
    matriculaVinculoAcademico: { findMany: vi.fn() },
    cicloAcademico: { findMany: vi.fn() },
  },
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@alusa/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/domain')>();
  return {
    ...actual,
    validarElegibilidadeRematricula: vi.fn((input: { status?: string; continuidadeImediataComprovada?: boolean }) => ({
      success: input.status !== 'ENCERRADA' || input.continuidadeImediataComprovada === true,
    })),
  };
});

vi.mock('./renewal-financial-policy.service', () => ({
  buildFinancialSnapshot: vi.fn(() => ({
    openChargesCount: 0,
    overdueChargesCount: 0,
    financialStatus: 'REGULAR',
  })),
  evaluateCanonicalRematriculaDecision: vi.fn(() => ({
    eligibilityStatus: 'ELEGIVEL',
    actionStatus: 'LIBERADA',
    blockReason: 'SEM_BLOQUEIO',
    message: 'Liberada',
    canCurrentUserOverride: false,
    requiresOverrideReason: false,
    shouldBlockNewFinancialCycle: false,
  })),
}));

const { listarRematriculasElegiveis } = await import('./renewal.service');

describe('listarRematriculasElegiveis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.rematriculaItem.findMany.mockResolvedValue([]);
    prismaMock.matricula.findMany.mockResolvedValue([]);
    prismaMock.customer.findMany.mockResolvedValue([]);
    prismaMock.charge.findMany.mockResolvedValue([]);
    prismaMock.matriculaVinculoAcademico.findMany.mockResolvedValue([]);
    prismaMock.cicloAcademico.findMany.mockResolvedValue([]);
  });

  function matriculaFixture(overrides: Record<string, unknown> = {}) {
    return {
      id: 'mat-1',
      status: 'ATIVA',
      statusContrato: 'ASSINADO',
      dataInicio: new Date('2026-01-01T00:00:00.000Z'),
      dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      rematriculadaDeId: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      formaPagamentoTaxa: 'BOLETO',
      vencimentoDia: 10,
      taxaMatricula: 100,
      taxaIsenta: false,
      taxaJustificativa: null,
      multaPercentual: null,
      jurosMensal: null,
      descontoAntecipado: null,
      prazoDesconto: null,
      integrationStatus: 'SINCRONIZADO',
      statusFinanceiro: 'REGULAR',
      responsavelFinanceiroId: null,
      matriculaFamiliarId: null,
      aluno: { id: 'aluno-1', nome: 'Aluno', cpf: null, foto: null },
      responsavelFinanceiro: null,
      plano: { id: 'plano-1', nome: 'Plano' },
      turma: { id: 'turma-1', nome: 'Turma', diasSemana: [], horaInicio: '08:00', horaFim: '09:00' },
      combo: null,
      cobrancas: [],
      descontos: [],
      ...overrides,
    };
  }

  it('exclui candidatos cuja cadeia ja possui rematricula ativa para o periodo alvo', async () => {
    const matricula = matriculaFixture({ id: 'mat-ja-rematriculada' });
    prismaMock.matricula.findMany
      .mockResolvedValueOnce([matricula])
      .mockResolvedValueOnce([
        {
          id: 'mat-ja-rematriculada',
          alunoId: 'aluno-1',
          rematriculadaDeId: null,
          status: 'ATIVA',
          dataInicio: matricula.dataInicio,
          dataFimContrato: matricula.dataFimContrato,
          createdAt: matricula.createdAt,
        },
      ]);
    prismaMock.rematriculaItem.findMany.mockResolvedValue([
      { matriculaOrigemId: 'mat-ja-rematriculada', matriculaFuturaId: null },
    ]);

    const result = await listarRematriculasElegiveis({
      contaId: 'conta-1',
      targetPeriodId: '2027',
      referencia: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(prismaMock.rematriculaItem.findMany).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        targetPeriodId: '2027',
        processo: {
          status: { notIn: ['CANCELLED'] },
        },
      },
      select: { matriculaOrigemId: true, matriculaFuturaId: true },
    });
    expect(result.itens).toHaveLength(0);
  });

  it('lista apenas a matricula mais recente da cadeia do aluno', async () => {
    const antiga = matriculaFixture({
      id: 'mat-2026',
      dataInicio: new Date('2026-01-01T00:00:00.000Z'),
      dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const futura = matriculaFixture({
      id: 'mat-2027',
      status: 'AGUARDANDO_CONFIRMACAO',
      rematriculadaDeId: 'mat-2026',
      dataInicio: new Date('2027-01-01T00:00:00.000Z'),
      dataFimContrato: new Date('2027-12-31T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    prismaMock.matricula.findMany.mockResolvedValueOnce([antiga, futura]).mockResolvedValueOnce([
      {
        id: 'mat-2026',
        alunoId: 'aluno-1',
        rematriculadaDeId: null,
        status: 'ATIVA',
        dataInicio: antiga.dataInicio,
        dataFimContrato: antiga.dataFimContrato,
        createdAt: antiga.createdAt,
      },
      {
        id: 'mat-2027',
        alunoId: 'aluno-1',
        rematriculadaDeId: 'mat-2026',
        status: 'AGUARDANDO_CONFIRMACAO',
        dataInicio: futura.dataInicio,
        dataFimContrato: futura.dataFimContrato,
        createdAt: futura.createdAt,
      },
    ]);

    const result = await listarRematriculasElegiveis({
      contaId: 'conta-1',
      referencia: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(result.itens).toHaveLength(1);
    expect(result.itens[0]?.id).toBe('mat-2027');
  });

  it.each([
    { source: '2026', target: '2027', sourceSequence: 2, targetSequence: 3, classification: 'REMATRICULA', expected: true },
    { source: '2026', target: '2027', sourceSequence: 2, targetSequence: 3, classification: 'REMATRICULA', effective: false, expected: false },
    { source: '2025', target: '2027', sourceSequence: 1, targetSequence: 3, classification: 'REMATRICULA', expected: false },
    { source: '2026', target: '2027', sourceSequence: 2, targetSequence: 3, classification: 'RETORNO', expected: false },
    { source: '2027.1', target: '2027.2', sourceSequence: null, targetSequence: null, classification: 'REMATRICULA', expected: true },
    { source: '2027.1', target: '2028.1', sourceSequence: null, targetSequence: null, classification: 'REMATRICULA', expected: false },
  ])('só inclui encerrada com vínculo efetivo no sucessor imediato: $source → $target', async (scenario) => {
    const closed = matriculaFixture({ id: 'mat-closed', status: 'ENCERRADA' });
    prismaMock.matricula.findMany
      .mockResolvedValueOnce([closed])
      .mockResolvedValueOnce([{
        id: closed.id,
        alunoId: 'aluno-1',
        rematriculadaDeId: null,
        status: 'ENCERRADA',
        dataInicio: closed.dataInicio,
        dataFimContrato: closed.dataFimContrato,
        createdAt: closed.createdAt,
      }]);
    prismaMock.matriculaVinculoAcademico.findMany.mockResolvedValue(scenario.effective === false ? [] : [{
      matriculaId: closed.id,
      classificacao: scenario.classification,
      modalidadeId: 'curso-1',
      cicloAcademico: { sequencia: scenario.sourceSequence, nome: scenario.source },
    }]);
    prismaMock.cicloAcademico.findMany.mockResolvedValue([{
      modalidadeId: 'curso-1', sequencia: scenario.targetSequence, nome: scenario.target,
    }]);

    const result = await listarRematriculasElegiveis({
      contaId: 'conta-1',
      targetPeriodId: scenario.target,
      referencia: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(result.itens.find((item) => item.id === closed.id)?.podeRenovar ?? false).toBe(scenario.expected);
    expect(prismaMock.matriculaVinculoAcademico.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vigenciaIniciadaEm: { not: null } }),
    }));
  });
});
