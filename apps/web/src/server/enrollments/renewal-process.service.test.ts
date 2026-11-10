import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

import {
  activateDueRenewalProcesses,
  buildRenewalRequestFingerprint,
  findRenewalProcessReplay,
  classifyRenewalIdempotency,
  confirmRenewalProcess,
  previewRenewalProcess,
  resolveRenewalProvisionAt,
} from './renewal-process.service';

describe('resolveRenewalProvisionAt', () => {
  it('agenda assinatura recorrente no início acadêmico da data efetiva da conta', () => {
    expect(resolveRenewalProvisionAt(new Date('2026-11-01T00:00:00.000Z'), 'America/Manaus'))
      .toEqual(new Date('2026-11-01T04:00:00.000Z'));
  });
});

describe('confirmRenewalProcess academic source selection', () => {
  it('persists REMATRICULA from the effective 2025 link when a newer 2026 enrollment was canceled before start', async () => {
    const source = {
      id: 'mat-1',
      contaId: 'conta-1',
      alunoId: 'aluno-1',
      responsavelFinanceiroId: 'resp-1',
      turmaId: 'turma-origem',
      planoId: 'plano-1',
      comboId: null,
      dataInicio: new Date('2025-01-01T00:00:00.000Z'),
      dataFimContrato: new Date('2025-12-31T00:00:00.000Z'),
      status: 'ATIVA',
      statusContrato: 'ASSINADO',
      statusFinanceiro: 'REGULAR',
      updatedAt: now,
      taxaMatricula: 0,
      taxaIsenta: true,
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
      plano: { id: 'plano-1', nome: 'Plano', valor: 150, periodicidade: 'MENSAL', contaId: 'conta-1' },
      combo: null,
      turma: { id: 'turma-origem', nome: 'Turma anterior', contaId: 'conta-1' },
      operacoes: [],
    };
    const canceledBeforeStartLink = {
      vigenciaIniciadaEm: null,
      cicloAcademico: { id: 'cycle-2026', sequencia: 2, nome: '2026' },
      transferenciaDestino: null,
      matricula: {
        id: 'mat-cancelada',
        status: 'CANCELADA',
        cancelledAt: new Date('2025-12-15T00:00:00.000Z'),
        dataInicio: new Date('2026-01-01T00:00:00.000Z'),
        rematriculaItensFuturos: [],
        operacoes: [],
      },
    };
    const effectiveSourceLink = {
      vigenciaIniciadaEm: new Date('2025-01-01T00:00:00.000Z'),
      createdAt: new Date('2025-01-02T00:00:00.000Z'),
      cicloAcademico: { id: 'cycle-2025', sequencia: 1, nome: '2025' },
      transferenciaDestino: null,
      matricula: {
        id: 'mat-1',
        status: 'ATIVA',
        cancelledAt: null,
        dataInicio: new Date('2025-01-01T00:00:00.000Z'),
        rematriculaItensFuturos: [{ targetPeriodId: '2025' }],
        operacoes: [],
      },
    };
    const olderEffectiveLinkCreatedLater = {
      vigenciaIniciadaEm: new Date('2024-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      cicloAcademico: { id: 'cycle-2024', sequencia: 0, nome: '2024' },
      transferenciaDestino: null,
      matricula: {
        id: 'mat-1', status: 'ENCERRADA', cancelledAt: null,
        dataInicio: new Date('2024-01-01T00:00:00.000Z'), rematriculaItensFuturos: [], operacoes: [],
      },
    };
    const persistedAcademicLink = vi.fn().mockResolvedValue({});
    const academicHistory = vi.fn().mockResolvedValue([
      olderEffectiveLinkCreatedLater,
      canceledBeforeStartLink,
      effectiveSourceLink,
    ]);
    const tx = {
      ...basePrisma({
        matricula: {
          findMany: vi.fn(async ({ where }) =>
            where?.id?.in?.includes('mat-1') ? [source] : [],
          ),
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({ id: 'mat-futura' }),
        },
        turma: {
          findMany: vi.fn().mockResolvedValue([{
            id: 'turma-1', nome: 'Turma 2026', capacidade: 10, modalidadeId: 'curso-1',
            cicloAcademicoId: 'cycle-2026', updatedAt: now, diasSemana: [], horaInicio: '09:00', horaFim: '10:00',
          }]),
        },
        matriculaVinculoAcademico: {
          findMany: academicHistory,
          create: persistedAcademicLink,
        },
        cicloAcademico: {
          findFirst: vi.fn().mockResolvedValue({ id: 'cycle-2026', sequencia: 2, nome: '2026' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        rematriculaProcesso: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'process-1', status: 'CONFIRMED' }),
        },
        rematriculaItem: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({ id: 'item-1' }),
          findFirst: vi.fn().mockResolvedValue({ matriculaFuturaId: 'mat-futura' }),
        },
        reservaVagaFutura: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({ id: 'reservation-1' }),
        },
        acordoFinanceiroFuturo: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'agreement-1' }),
        },
        rematriculaAuditLog: { create: vi.fn().mockResolvedValue({}) },
        conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'UTC' }) },
      }),
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const confirmInput = {
      ...input,
      targetPeriodId: '2026',
      effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
      idempotencyKey: 'academic-source-selection-test',
      previewHash: '',
      sourceVersion: '',
    };
    const preview = await previewRenewalProcess(confirmInput, { prisma: tx as never });

    await confirmRenewalProcess({
      ...confirmInput,
      previewHash: preview.previewHash,
      sourceVersion: preview.sourceVersion,
    }, { prisma: prisma as never });

    expect(persistedAcademicLink).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        matriculaId: 'mat-futura',
        cicloAcademicoId: 'cycle-2026',
        classificacao: 'REMATRICULA',
      }),
    }));
    expect(academicHistory).toHaveBeenCalled();
  });
});

vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertStudentCapacity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./renewal-governance.service', () => ({
  createRenewalPending: vi.fn().mockResolvedValue({ id: 'pending-1' }),
}));

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
    historicoAcademicoCobertura: { findFirst: vi.fn().mockResolvedValue(null) },
    aluno: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date('2020-01-01T00:00:00.000Z') }) },
    combo: { findMany: vi.fn().mockResolvedValue([]) },
    rematriculaCampanha: { findFirst: vi.fn().mockResolvedValue(null) },
    rematriculaParticipante: { findMany: vi.fn().mockResolvedValue([]) },
    rematriculaItem: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    reservaVagaFutura: { findMany: vi.fn().mockResolvedValue([]) },
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
  it('rejeita combo com ciclos conflitantes para a mesma modalidade antes do commit', async () => {
    const prisma = basePrisma({
      combo: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'combo-1', nome: 'Combo inconsistente', valor: 300, periodicidade: 'MENSAL', vagasLimite: null, updatedAt: now,
          turmas: [
            { turma: { id: 'class-cycle-1', nome: 'Turma 1', capacidade: 10, modalidadeId: 'course-1', cicloAcademicoId: 'cycle-1', diasSemana: [], horaInicio: '09:00', horaFim: '10:00' } },
            { turma: { id: 'class-cycle-2', nome: 'Turma 2', capacidade: 10, modalidadeId: 'course-1', cicloAcademicoId: 'cycle-2', diasSemana: [], horaInicio: '10:00', horaFim: '11:00' } },
          ],
        }]),
      },
    });
    const preview = await previewRenewalProcess({
      ...input,
      items: [{ ...input.items[0]!, target: { type: 'COMBO', targetId: 'combo-1', planId: 'plano-1' } }],
    }, { prisma: prisma as never });
    expect(preview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COMBO_ACADEMIC_CYCLE_CONFLICT' }),
    ]));
  });

  it('cria uma nova intenção quando não existe processo para a chave', () => {
    expect(
      classifyRenewalIdempotency({
        existing: null,
        previewHash: 'preview-1',
        sourceVersion: 'version-1',
        requestFingerprint: 'intent-1',
      }),
    ).toBe('CREATE');
  });

  it('faz replay com a mesma chave e o mesmo preview', () => {
    expect(
      classifyRenewalIdempotency({
        existing: { status: 'CONFIRMED', previewHash: 'preview-1', sourceVersion: 'version-1', requestFingerprint: 'intent-1' },
        previewHash: 'preview-after-commit',
        sourceVersion: 'version-after-commit',
        requestFingerprint: 'intent-1',
      }),
    ).toBe('REPLAY');
  });

  it('rejeita a mesma chave com payload/preview diferente', () => {
    expect(
      classifyRenewalIdempotency({
        existing: { status: 'CONFIRMED', previewHash: 'preview-1', sourceVersion: 'version-1', requestFingerprint: 'intent-1' },
        previewHash: 'preview-2',
        sourceVersion: 'version-1',
        requestFingerprint: 'intent-2',
      }),
    ).toBe('CONFLICT');
  });

  it('não deriva uma chave nova ao reutilizar processo cancelado', () => {
    expect(
      classifyRenewalIdempotency({
        existing: { status: 'CANCELLED', previewHash: 'preview-1', sourceVersion: 'version-1', requestFingerprint: 'intent-1' },
        previewHash: 'preview-1',
        sourceVersion: 'version-1',
        requestFingerprint: 'intent-1',
      }),
    ).toBe('REQUIRES_NEW_INTENT');
  });

  it('fingerprint inclui os campos semânticos da intenção e canonicaliza datas', () => {
    const first = buildRenewalRequestFingerprint({
      ...input,
      effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const sameIntent = buildRenewalRequestFingerprint({
      ...input,
      effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const changedFinancialTerm = buildRenewalRequestFingerprint({
      ...input,
      financialTerms: { paymentMethod: 'PIX' },
    });

    expect(first).toBe(sameIntent);
    expect(first).not.toBe(changedFinancialTerm);
  });

  it('reproduz processo persistido só para intenção idêntica e escopa lookup por conta/chave', async () => {
    const requestFingerprint = buildRenewalRequestFingerprint(input);
    const findFirst = vi.fn().mockResolvedValue({
      id: 'process-persisted',
      status: 'WAITING_FOR_START',
      previewHash: 'original-preview',
      sourceVersion: 'original-version',
      requestFingerprint,
      renewCount: 1,
      pendingCount: 0,
      nonRenewalCount: 0,
    });
    const prisma = { rematriculaProcesso: { findFirst } };

    await expect(findRenewalProcessReplay({ ...input, idempotencyKey: 'intent-key' }, { prisma: prisma as never }))
      .resolves.toMatchObject({ processId: 'process-persisted', idempotent: true });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: input.contaId, idempotencyKey: 'intent-key' },
    }));

    await expect(findRenewalProcessReplay({
      ...input,
      financialTerms: { paymentMethod: 'PIX' },
      idempotencyKey: 'intent-key',
    }, { prisma: prisma as never })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('não faz replay de processo legado sem fingerprint, mesmo com preview antigo', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'legacy-process',
      status: 'WAITING_FOR_START',
      previewHash: 'same-preview',
      sourceVersion: 'same-version',
      requestFingerprint: null,
    });
    const prisma = { rematriculaProcesso: { findFirst } };

    await expect(findRenewalProcessReplay({ ...input, idempotencyKey: 'legacy-key' }, { prisma: prisma as never }))
      .rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: input.contaId, idempotencyKey: 'legacy-key' },
    }));
  });

  it('resolve corrida P2002 como replay do vencedor apenas para o fingerprint idêntico', async () => {
    const requestFingerprint = buildRenewalRequestFingerprint(input);
    const winner = {
      id: 'winner-process', status: 'WAITING_FOR_START', previewHash: 'winner-preview',
      sourceVersion: 'winner-version', requestFingerprint, renewCount: 1,
      pendingCount: 0, nonRenewalCount: 0,
    };
    const uniqueError = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002', clientVersion: 'test', meta: { target: ['contaId', 'idempotencyKey'] },
    });
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const create = vi.fn().mockRejectedValue(uniqueError);
    const tx = basePrisma({
      rematriculaProcesso: { findFirst, create },
      matricula: { ...basePrisma().matricula, create: vi.fn() },
      matriculaVinculoAcademico: { create: vi.fn() },
      rematriculaItem: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      reservaVagaFutura: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      acordoFinanceiroFuturo: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    }) as ReturnType<typeof basePrisma> & {
      rematriculaProcesso: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
      matricula: ReturnType<typeof basePrisma>['matricula'] & { create: ReturnType<typeof vi.fn> };
      matriculaVinculoAcademico: { create: ReturnType<typeof vi.fn> };
      rematriculaItem: ReturnType<typeof basePrisma>['rematriculaItem'] & { create: ReturnType<typeof vi.fn> };
      reservaVagaFutura: ReturnType<typeof basePrisma>['reservaVagaFutura'] & { create: ReturnType<typeof vi.fn> };
      acordoFinanceiroFuturo: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const preview = await previewRenewalProcess({
      ...input,
    }, { prisma: tx as never });

    const result = await confirmRenewalProcess({
      ...input,
      previewHash: preview.previewHash,
      sourceVersion: preview.sourceVersion,
      idempotencyKey: 'concurrent-key',
    }, { prisma: prisma as never });

    expect(result).toMatchObject({ processId: 'winner-process', idempotent: true });
    expect(findFirst).toHaveBeenCalledTimes(2);
    // The losing transaction attempts its unique insert, then rolls back on P2002.
    // No dependent academic or financial rows may be written outside that tx.
    expect(create).toHaveBeenCalledTimes(1);
    expect(tx.matricula.create).not.toHaveBeenCalled();
    expect(tx.matriculaVinculoAcademico.create).not.toHaveBeenCalled();
    expect(tx.rematriculaItem.create).not.toHaveBeenCalled();
    expect(tx.reservaVagaFutura.create).not.toHaveBeenCalled();
    expect(tx.acordoFinanceiroFuturo.create).not.toHaveBeenCalled();
  });

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
        findMany: vi.fn().mockResolvedValueOnce([source]).mockResolvedValueOnce([]).mockResolvedValueOnce(chainRows).mockResolvedValueOnce(chainRows),
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
      reservaVagaFutura: { findMany: vi.fn().mockResolvedValue([{ matriculaFuturaId: 'mat-reservada' }]) },
    });

    const preview = await previewRenewalProcess(input, { prisma: prisma as never });

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TARGET_CLASS_FULL', sourceEnrollmentId: 'mat-1' }),
      ]),
    );
  });

  it('ignora matrícula cancelada antes da vigência e usa o vínculo efetivo anterior para preview', async () => {
    const makePrisma = (targetSequence: number) => basePrisma({
      turma: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'turma-1', nome: 'Turma 1', capacidade: 10, modalidadeId: 'curso-1',
          cicloAcademicoId: `ciclo-${targetSequence}`, updatedAt: now,
          diasSemana: [], horaInicio: '09:00', horaFim: '10:00',
        }]),
      },
      matriculaVinculoAcademico: {
        findMany: vi.fn().mockResolvedValue([
          {
            vigenciaIniciadaEm: null,
            cicloAcademico: { sequencia: 2, nome: '2026' },
            transferenciaDestino: null,
            matricula: {
              id: 'mat-cancelada-antes-da-vigencia',
              status: 'CANCELADA',
              cancelledAt: new Date('2025-12-15T00:00:00.000Z'),
              dataInicio: new Date('2026-01-01T00:00:00.000Z'),
              rematriculaItensFuturos: [],
              operacoes: [],
            },
          },
          {
            vigenciaIniciadaEm: new Date('2025-01-01T00:00:00.000Z'),
            cicloAcademico: { sequencia: 1, nome: '2025' },
            transferenciaDestino: null,
            matricula: {
              id: 'mat-1',
              status: 'ATIVA',
              cancelledAt: null,
              dataInicio: new Date('2025-01-01T00:00:00.000Z'),
              rematriculaItensFuturos: [{ targetPeriodId: '2025' }],
              operacoes: [],
            },
          },
        ]),
      },
      cicloAcademico: {
        findFirst: vi.fn().mockResolvedValue({ id: `ciclo-${targetSequence}`, sequencia: targetSequence, nome: String(2024 + targetSequence) }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    });

    const gapPreview = await previewRenewalProcess(input, { prisma: makePrisma(3) as never });
    expect(gapPreview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_CYCLE_NOT_IMMEDIATE_SUCCESSOR', sourceEnrollmentId: 'mat-1' }),
    ]));

    const nextCyclePreview = await previewRenewalProcess(input, { prisma: makePrisma(2) as never });
    expect(nextCyclePreview.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_CYCLE_NOT_IMMEDIATE_SUCCESSOR' }),
    ]));
  });

  it('infere continuidade anual e semestral pelas datas/período sem depender de ciclo na turma', async () => {
    const previewFor = async (targetPeriodId: string, sourceStart: string) => {
      const prisma = basePrisma({
        turma: { findMany: vi.fn().mockResolvedValue([{
          id: 'turma-1', nome: 'Turma 1', capacidade: 10, modalidadeId: 'curso-1',
          cicloAcademicoId: null, updatedAt: now, diasSemana: [], horaInicio: '09:00', horaFim: '10:00',
        }]) },
        matriculaVinculoAcademico: {
          findMany: vi.fn().mockResolvedValue([{
            vigenciaIniciadaEm: new Date(sourceStart),
            cicloAcademico: null,
            transferenciaDestino: null,
            matricula: {
              id: 'mat-1', status: 'ATIVA', cancelledAt: null, dataInicio: new Date(sourceStart),
              rematriculaItensFuturos: [], operacoes: [],
            },
          }]),
        },
        cicloAcademico: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
      });
      return previewRenewalProcess({ ...input, targetPeriodId }, { prisma: prisma as never });
    };

    const lateAnnualEntry = await previewFor('2027', '2026-11-20T00:00:00.000Z');
    expect(lateAnnualEntry.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_CYCLE_NOT_IMMEDIATE_SUCCESSOR' }),
      expect.objectContaining({ code: 'ACADEMIC_HISTORY_RECONCILIATION_REQUIRED' }),
    ]));

    const semester = await previewFor('2026.2', '2026-03-10T00:00:00.000Z');
    expect(semester.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_CYCLE_NOT_IMMEDIATE_SUCCESSOR' }),
      expect.objectContaining({ code: 'ACADEMIC_HISTORY_RECONCILIATION_REQUIRED' }),
    ]));
  });

  it('trata entrada tardia no ano como continuidade anual do ciclo seguinte sem ciclo legado explícito', async () => {
    const prisma = basePrisma({
      turma: { findMany: vi.fn().mockResolvedValue([{
        id: 'turma-1', nome: 'Turma 2027', capacidade: 10, modalidadeId: 'curso-1',
        cicloAcademicoId: null, updatedAt: now, diasSemana: [], horaInicio: '09:00', horaFim: '10:00',
      }]) },
      matriculaVinculoAcademico: { findMany: vi.fn().mockResolvedValue([{
        vigenciaIniciadaEm: new Date('2026-10-10T00:00:00.000Z'),
        cicloAcademico: null,
        transferenciaDestino: null,
        matricula: {
          id: 'mat-1', status: 'ATIVA', cancelledAt: null,
          dataInicio: new Date('2026-10-10T00:00:00.000Z'),
          dataFimContrato: new Date('2026-12-31T00:00:00.000Z'),
          rematriculaItensFuturos: [], operacoes: [],
        },
      }]) },
      cicloAcademico: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    });

    const preview = await previewRenewalProcess({
      ...input,
      targetPeriodId: '2027',
      effectiveAt: new Date('2027-01-01T00:00:00.000Z'),
    }, { prisma: prisma as never });

    expect(preview.blockers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_CYCLE_NOT_IMMEDIATE_SUCCESSOR' }),
      expect.objectContaining({ code: 'ACADEMIC_HISTORY_RECONCILIATION_REQUIRED' }),
    ]));
  });

  it('mantém períodos customizados ambíguos e bloqueia lacunas anuais conhecidas', async () => {
    const previewFor = async (targetPeriodId: string, sourceStart: string) => {
      const prisma = basePrisma({
        turma: { findMany: vi.fn().mockResolvedValue([{
          id: 'turma-1', nome: 'Turma 1', capacidade: 10, modalidadeId: 'curso-1',
          cicloAcademicoId: null, updatedAt: now, diasSemana: [], horaInicio: '09:00', horaFim: '10:00',
        }]) },
        matriculaVinculoAcademico: { findMany: vi.fn().mockResolvedValue([{
          vigenciaIniciadaEm: new Date(sourceStart), cicloAcademico: null, transferenciaDestino: null,
          matricula: { id: 'mat-1', status: 'ATIVA', cancelledAt: null, dataInicio: new Date(sourceStart), rematriculaItensFuturos: [], operacoes: [] },
        }]) },
        cicloAcademico: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
      });
      return previewRenewalProcess({ ...input, targetPeriodId }, { prisma: prisma as never });
    };

    const custom = await previewFor('outono-2027', '2026-05-10T00:00:00.000Z');
    expect(custom.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_HISTORY_RECONCILIATION_REQUIRED' }),
    ]));

    const gap = await previewFor('2027', '2025-05-10T00:00:00.000Z');
    expect(gap.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_CYCLE_NOT_IMMEDIATE_SUCCESSOR' }),
    ]));
  });

  it('bloqueia vínculo legado sem vigência/ciclo até reconciliação administrativa', async () => {
    const prisma = basePrisma({
      turma: { findMany: vi.fn().mockResolvedValue([{
        id: 'turma-1', nome: 'Turma 1', capacidade: 10, modalidadeId: 'curso-1',
        cicloAcademicoId: 'ciclo-2', updatedAt: now, diasSemana: [], horaInicio: '09:00', horaFim: '10:00',
      }]) },
      matriculaVinculoAcademico: { findMany: vi.fn().mockResolvedValue([{ vigenciaIniciadaEm: null, cicloAcademico: null, transferenciaDestino: null, matricula: { status: 'ATIVA', cancelledAt: null, dataInicio: new Date('2025-01-01'), rematriculaItensFuturos: [], operacoes: [] } }]) },
      cicloAcademico: { findFirst: vi.fn().mockResolvedValue({ sequencia: 2 }) },
    });
    const preview = await previewRenewalProcess(input, { prisma: prisma as never });
    expect(preview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_HISTORY_RECONCILIATION_REQUIRED', sourceEnrollmentId: 'mat-1' }),
    ]));
  });

  it('bloqueia rematrícula de origem encerrada formalmente e orienta nova matrícula', async () => {
    const closedSource = sourceEnrollment({
      status: 'CANCELADA',
      cancelledAt: new Date('2025-12-15T00:00:00.000Z'),
      operacoes: [{ observacao: 'Encerramento definitivo solicitado pela família.' }],
    });
    const prisma = basePrisma({
      matricula: {
        ...basePrisma().matricula,
        findMany: vi.fn().mockResolvedValueOnce([closedSource]).mockResolvedValue([]),
      },
    });
    const preview = await previewRenewalProcess(input, { prisma: prisma as never });
    expect(preview.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACADEMIC_ENROLLMENT_FORMALLY_CLOSED', sourceEnrollmentId: 'mat-1' }),
    ]));
  });

  it('expõe acordo futuro compatível para escolher unificação ou cobrança separada', async () => {
    const prisma = basePrisma({
      acordoFinanceiroFuturo: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'acordo-existente',
            processoId: 'processo-anterior',
            status: 'SCHEDULED',
            monthlyTotal: 300,
            enrollmentFeeTotal: 0,
            effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
            matriculaFuturaId: 'mat-futura-anterior',
            snapshot: {},
            processo: {
              itens: [
                {
                  matriculaFutura: {
                    aluno: { nome: 'Aluno anterior' },
                    plano: { periodicidade: 'MENSAL' },
                    combo: null,
                  },
                },
              ],
            },
          },
        ]),
      },
    });

    const preview = await previewRenewalProcess(input, { prisma: prisma as never });

    expect(preview.futureAgreementCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'acordo-existente',
        monthlyTotal: 300,
        canUnify: true,
        periodicity: 'MENSAL',
      }),
    ]));
  });

  it('ativa futura e encerra origem como ENCERRADA', async () => {
    const tx = {
      rematriculaProcesso: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'proc-1',
          contaId: 'conta-1',
          effectiveAt: new Date('2026-07-02T12:00:00.000Z'),
          itens: [
            {
              id: 'item-1',
              decision: 'RENEW',
              matriculaOrigemId: 'mat-origem',
              matriculaFuturaId: 'mat-futura',
            },
          ],
          reservas: [{ itemId: 'item-1', status: 'RESERVED' }],
          financeiros: [{ id: 'fin-1', status: 'ACTIVE' }],
          contratos: [],
          pendencias: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      matricula: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'mat-origem',
              dataFimContrato: new Date('2026-07-01T00:00:00.000Z'),
              status: 'ATIVA',
            },
          ])
          .mockResolvedValueOnce([{ alunoId: 'aluno-1' }]),
        findFirst: vi.fn().mockResolvedValue({ id: 'mat-origem' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      matriculaVinculoAcademico: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      reservaVagaFutura: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      contratoFuturo: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      acordoFinanceiroFuturo: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      rematriculaPendencia: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      rematriculaAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    const prisma = {
      rematriculaProcesso: {
        findMany: vi.fn().mockResolvedValue([{ id: 'proc-1' }]),
      },
      conta: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await activateDueRenewalProcesses(
      { contaId: 'conta-1', now: new Date('2026-07-02T04:00:00.000Z') },
      { prisma: prisma as never },
    );

    expect(result).toEqual([{ processId: 'proc-1', status: 'EFFECTIVE' }]);
    expect(tx.matricula.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['mat-origem'] } }),
        data: expect.objectContaining({ status: 'ENCERRADA', statusContrato: 'EXPIRADO' }),
      }),
    );
    expect(tx.matricula.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['mat-futura'] } }),
        data: expect.objectContaining({ status: 'ATIVA' }),
      }),
    );
  });

  it('ativa o ciclo futuro preenchendo a vigência e o replay do job não altera artefatos', async () => {
    const startedAt = new Date('2026-07-02T04:00:00.000Z');
    const academicLinkUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      rematriculaProcesso: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'proc-activation-replay', contaId: 'conta-1', effectiveAt: startedAt,
          itens: [{ id: 'item-1', decision: 'RENEW', matriculaOrigemId: 'mat-origem', matriculaFuturaId: 'mat-futura' }],
          reservas: [{ itemId: 'item-1', status: 'RESERVED' }], financeiros: [{ id: 'fin-1', status: 'ACTIVE' }],
          contratos: [], pendencias: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      matricula: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 'mat-origem', dataFimContrato: new Date('2026-07-01T00:00:00.000Z'), status: 'ATIVA' }])
          .mockResolvedValueOnce([{ alunoId: 'aluno-1' }]),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      matriculaVinculoAcademico: { updateMany: academicLinkUpdate },
      reservaVagaFutura: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      contratoFuturo: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      acordoFinanceiroFuturo: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      rematriculaPendencia: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      rematriculaAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const findDue = vi.fn().mockResolvedValueOnce([{ id: 'proc-activation-replay' }]).mockResolvedValueOnce([]);
    const prisma = {
      rematriculaProcesso: { findMany: findDue },
      conta: { findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }) },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const first = await activateDueRenewalProcesses({ contaId: 'conta-1', now: startedAt }, { prisma: prisma as never });
    const replay = await activateDueRenewalProcesses({ contaId: 'conta-1', now: startedAt }, { prisma: prisma as never });

    expect(first).toEqual([{ processId: 'proc-activation-replay', status: 'EFFECTIVE' }]);
    expect(replay).toEqual([]);
    expect(academicLinkUpdate).toHaveBeenCalledTimes(1);
    expect(academicLinkUpdate).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', matriculaId: { in: ['mat-futura'] }, vigenciaIniciadaEm: null },
      data: { vigenciaIniciadaEm: startedAt },
    });
    expect(tx.matricula.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.rematriculaProcesso.update).toHaveBeenCalledTimes(1);
  });

  it('nao efetiva rematricula com contrato aguardando assinatura', async () => {
    const tx = {
      rematriculaProcesso: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'proc-1',
          contaId: 'conta-1',
          effectiveAt: new Date('2026-07-02T00:00:00.000Z'),
          itens: [{ id: 'item-1', decision: 'RENEW', matriculaOrigemId: 'origem', matriculaFuturaId: 'futura' }],
          reservas: [{ itemId: 'item-1', status: 'RESERVED' }],
          financeiros: [{ id: 'fin-1', status: 'ACTIVE' }],
          contratos: [{ id: 'cf-1', status: 'WAITING_SIGNATURE' }],
          pendencias: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      matricula: {
        findMany: vi.fn().mockResolvedValue([{ id: 'origem', dataFimContrato: new Date('2026-07-01T00:00:00.000Z'), status: 'ATIVA' }]),
        updateMany: vi.fn(),
      },
      rematriculaAuditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      rematriculaProcesso: { findMany: vi.fn().mockResolvedValue([{ id: 'proc-1' }]) },
      conta: {
        findUnique: vi.fn().mockResolvedValue({ timezone: 'America/Sao_Paulo' }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    const result = await activateDueRenewalProcesses(
      { contaId: 'conta-1', now: new Date('2026-07-02T12:00:00.000Z') },
      { prisma: prisma as never },
    );

    expect(result).toEqual([{ processId: 'proc-1', status: 'REQUIRES_ATTENTION' }]);
    expect(tx.matricula.updateMany).not.toHaveBeenCalled();
    expect(tx.rematriculaProcesso.update).toHaveBeenCalledWith({
      where: { id: 'proc-1' },
      data: { status: 'REQUIRES_ATTENTION' },
    });
  });
});
