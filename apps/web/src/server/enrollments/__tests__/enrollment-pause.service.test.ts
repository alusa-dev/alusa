import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import {
  pausarMatricula,
  reativarMatricula,
  regularizarPausaVencida,
  avaliarElegibilidadeRegularizacaoPausa,
  getPausaResumo,
  PausaBusinessError,
} from '@/src/server/enrollments/enrollment-pause.service';

// ============================================================================
// Mocks
// ============================================================================

type MockPauseResponse = { success: boolean; message: string };
type MockSubscriptionResponse = { id?: string; status: 'ACTIVE' | 'INACTIVE'; deleted: boolean };
type MockSubscriptionPaymentsResponse = {
  data: Array<{
    id: string;
    status: string;
    dueDate: string;
    billingType?: string;
    value?: number;
    description?: string;
    externalReference?: string;
  }>;
  hasMore: boolean;
  totalCount: number;
};

const {
  pauseAssinaturaMock,
  ativarAssinaturaMock,
  getSubscriptionMock,
  listSubscriptionPaymentsMock,
  deletePaymentMock,
  getPaymentMock,
  updatePaymentMock,
} = vi.hoisted(() => ({
  pauseAssinaturaMock: vi.fn(async (): Promise<MockPauseResponse> => ({ success: true, message: 'ok' })),
  ativarAssinaturaMock: vi.fn(async (): Promise<MockPauseResponse> => ({ success: true, message: 'ok' })),
  getSubscriptionMock: vi.fn(async (): Promise<MockSubscriptionResponse> => ({ status: 'ACTIVE', deleted: false })),
  listSubscriptionPaymentsMock: vi.fn(async (): Promise<MockSubscriptionPaymentsResponse> => ({ data: [], hasMore: false, totalCount: 0 })),
  deletePaymentMock: vi.fn(async (): Promise<Record<string, never>> => ({})),
  getPaymentMock: vi.fn(async () => ({
    id: 'pay_1',
    status: 'PENDING',
    dueDate: '2025-07-10',
    billingType: 'BOLETO',
    value: 150,
    description: 'Mensalidade',
    externalReference: 'ref-pay-1',
  })),
  updatePaymentMock: vi.fn(async () => ({ id: 'pay_1' })),
}));

vi.mock('@alusa/finance', async () => {
  const actual = await vi.importActual<typeof import('@alusa/finance')>('@alusa/finance');
  return {
    ...actual,
    pauseAssinatura: pauseAssinaturaMock,
    ativarAssinatura: ativarAssinaturaMock,
    getSubscription: getSubscriptionMock,
    listSubscriptionPayments: listSubscriptionPaymentsMock,
    deletePayment: deletePaymentMock,
    getPayment: getPaymentMock,
    updatePayment: updatePaymentMock,
  };
});

vi.mock('@alusa/domain', async () => {
  const actual = await vi.importActual<typeof import('@alusa/domain')>('@alusa/domain');
  return { ...actual };
});

// ============================================================================
// Prisma Mock helpers
// ============================================================================

function createPrismaMock(overrides?: {
  findFirst?: unknown;
  turmaCount?: number;
  pendingOperations?: unknown[];
  pauseOperation?: unknown;
  regularizationOperations?: unknown[];
  localCharges?: unknown[];
  overdueCharges?: number;
  openEnrollmentFee?: number;
  comboCount?: number;
  transactionMatricula?: unknown;
}) {
  const tx = {
    aluno: {
      findFirst: vi.fn(async () => null),
    },
      matricula: {
      findFirst: vi.fn(async () => overrides?.transactionMatricula ?? overrides?.findFirst ?? null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async (args: { where?: { comboId?: string; OR?: unknown } }) => {
        if (args.where?.comboId) return overrides?.comboCount ?? 0;
        if (args.where?.OR) {
        const turma = (overrides?.findFirst as { turma?: { _count?: { matriculas: number } } } | undefined)?.turma;
        return overrides?.turmaCount ?? turma?._count?.matriculas ?? 0;
        }
        return 0;
      }),
      update: vi.fn(async (args: { where?: { version?: number }; data?: { version?: { increment?: number } } }) => ({
        id: 'mat-1',
        version: (args.where?.version ?? 1) + (args.data?.version?.increment ?? 0),
      })),
    },
    matriculaVinculoAcademico: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    turma: {
      findMany: vi.fn(async () => {
        const turma = (overrides?.findFirst as { turma?: { id: string; nome: string; capacidade: number } } | undefined)?.turma;
        return turma ? [{ id: turma.id, nome: turma.nome, capacidade: turma.capacidade, diasSemana: [], horaInicio: null, horaFim: null }] : [];
      }),
    },
    combo: {
      findFirst: vi.fn(async () => {
        const combo = (overrides?.findFirst as { comboCapacity?: number; comboId?: string } | undefined);
        return combo?.comboCapacity == null ? null : { id: combo.comboId ?? 'combo-1', vagasLimite: combo.comboCapacity };
      }),
    },
    cobranca: {
      count: vi.fn(async (args: { where?: { tipo?: string } }) =>
        args.where?.tipo === 'TAXA_MATRICULA'
          ? overrides?.openEnrollmentFee ?? 0
          : overrides?.overdueCharges ?? 0),
      findMany: vi.fn(async () => overrides?.localCharges ?? []),
      update: vi.fn(async () => ({ id: 'cob-1' })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    charge: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    matriculaOperacao: {
      findFirst: vi.fn(async (args: { where?: { tipo?: string } }) =>
        args.where?.tipo === 'PAUSA' ? overrides?.pauseOperation ?? null : null),
      findMany: vi.fn(async (args: { where?: { tipo?: string } }) =>
        args.where?.tipo === 'REGULARIZACAO_PAUSA' ? overrides?.regularizationOperations ?? [] : overrides?.pendingOperations ?? []),
      create: vi.fn(async () => ({ id: 'op-1', correlationId: 'corr-uuid-mock' })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    matriculaLog: {
      create: vi.fn(async () => ({ id: 'log-1' })),
    },
    conta: { findFirst: vi.fn(async () => ({ timezone: 'America/Manaus' })) },
    platformBillingAccount: {
      findUnique: vi.fn(async () => ({
        id: 'platform-account-1',
        status: 'ACTIVE',
        accessStatus: 'ACTIVE',
        restrictionReason: null,
        restrictedAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
        trialEndsAt: null,
        firstPaidAt: new Date('2025-01-01T00:00:00.000Z'),
        lastSuccessfulPaymentAt: null,
        paymentMethodStatus: 'ACTIVE',
      })),
      update: vi.fn(async () => ({})),
    },
    $executeRaw: vi.fn(async () => 1),
  };

  const root = {
    conta: { findFirst: vi.fn(async () => ({ timezone: 'America/Manaus' })) },
    billingAllocation: {
      findFirst: vi.fn(async () => null),
    },
    matricula: {
      findFirst: vi.fn().mockResolvedValue(overrides?.findFirst ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    matriculaOperacao: {
      findFirst: vi.fn(async (args: { where?: { tipo?: string } }) =>
        args.where?.tipo === 'PAUSA' ? overrides?.pauseOperation ?? null : null),
      findMany: vi.fn(async (args: { where?: { tipo?: string } }) =>
        args.where?.tipo === 'REGULARIZACAO_PAUSA' ? overrides?.regularizationOperations ?? [] : overrides?.pendingOperations ?? []),
      create: vi.fn(async () => ({
        id: 'op-1',
        correlationId: 'corr-uuid-mock',
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    cobranca: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    charge: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (fn: (_t: typeof tx) => unknown) => fn(tx)),
  };

  return { root: root as unknown as PrismaClient, tx };
}

function ativaMatricula(extra: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    alunoId: 'aluno-1',
    status: 'ATIVA',
    pausaAtiva: false,
    asaasSubscriptionId: 'sub_123',
    version: 0,
    turmaId: 'turma-1',
    ...extra,
  };
}

function pausadaMatricula(extra: Record<string, unknown> = {}) {
  return {
    id: 'mat-1',
    alunoId: 'aluno-1',
    status: 'PAUSADA',
    pausaAtiva: true,
    manterVaga: true,
    cobrarDurantePausa: false,
    asaasSubscriptionId: 'sub_123',
    version: 1,
    dataFimContrato: new Date('2026-12-31T12:00:00.000Z'),
    turmaId: 'turma-1',
    turma: {
      id: 'turma-1',
      nome: 'Turma A',
      capacidade: 20,
      _count: { matriculas: 10 },
    },
    ...extra,
  };
}

const basePausaInput = {
  matriculaId: 'mat-1',
  contaId: 'conta-1',
  actorId: 'user-1',
  motivoPausa: 'Viagem',
  dataInicioPausa: '2025-06-01',
  manterVaga: true,
  cobrarDurantePausa: false,
};

const baseReativarInput = {
  matriculaId: 'mat-1',
  contaId: 'conta-1',
  actorId: 'user-1',
  dataRetornoEfetiva: '2025-07-01',
  nextDueDate: '2025-08-01',
};

// ============================================================================
// Tests
// ============================================================================

describe('enrollment-pause.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSubscriptionMock.mockResolvedValue({ status: 'ACTIVE', deleted: false });
    getPaymentMock.mockResolvedValue({
      id: 'pay_1',
      status: 'PENDING',
      dueDate: '2025-07-10',
      billingType: 'BOLETO',
      value: 150,
      description: 'Mensalidade',
      externalReference: 'ref-pay-1',
    });
  });

  // -----------------------------------------------------------------------
  // PAUSAR
  // -----------------------------------------------------------------------
  describe('pausarMatricula', () => {
    it('pausa matrícula ativa com assinatura, inativando no Asaas', async () => {
      const { root, tx } = createPrismaMock({
        findFirst: ativaMatricula(),
        localCharges: [{ id: 'cob-1', asaasPaymentId: 'pay_1' }],
      });

      listSubscriptionPaymentsMock.mockResolvedValueOnce({
        data: [
          { id: 'pay_1', status: 'PENDING', dueDate: '2025-07-01' },
          { id: 'pay_2', status: 'RECEIVED', dueDate: '2025-05-01' },
        ],
        hasMore: false,
        totalCount: 2,
      });

      const result = await pausarMatricula({ prisma: root, ...basePausaInput });

      expect(result.newStatus).toBe('PAUSADA');
      expect(result.asaasAction).toBe('SUBSCRIPTION_INACTIVATED');
      expect(result.integrationStatus).toBe('PENDENTE_SINCRONISMO');
      expect(result.cobrancasFuturasRemovidas).toBe(1);
      expect(pauseAssinaturaMock).toHaveBeenCalledWith({
        subscriptionId: 'sub_123',
        contaId: 'conta-1',
      });
      expect(deletePaymentMock).toHaveBeenCalledTimes(1);
      expect(tx.cobranca.findMany).toHaveBeenCalledWith({
        where: {
          matriculaId: 'mat-1',
          vencimento: { gte: new Date('2025-06-01T12:00:00.000Z') },
          status: { in: ['PENDENTE', 'A_VENCER', 'ATRASADO', 'PROCESSANDO', 'CANCELAMENTO_PENDENTE'] },
        },
        select: {
          id: true,
          asaasPaymentId: true,
        },
      });
      expect(tx.cobranca.update).toHaveBeenCalledWith({
        where: { id: 'cob-1' },
        data: expect.objectContaining({
          status: 'CANCELADO',
          canceladoMotivo: 'Viagem',
          canceladoPor: 'user-1',
        }),
      });
      expect(tx.charge.updateMany).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-1',
          cobrancaId: { in: ['cob-1'] },
        },
        data: expect.objectContaining({
          status: 'CANCELED',
        }),
      });
      expect(tx.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAUSADA', statusFinanceiro: 'SUSPENSO' }),
        }),
      );
    });

    it('pausa matrícula sem assinatura (LOCAL_ONLY)', async () => {
      const { root } = createPrismaMock({
        findFirst: ativaMatricula({ asaasSubscriptionId: null }),
      });

      const result = await pausarMatricula({ prisma: root, ...basePausaInput });

      expect(result.asaasAction).toBe('LOCAL_ONLY');
      expect(result.integrationStatus).toBe('SINCRONIZADO');
      expect(pauseAssinaturaMock).not.toHaveBeenCalled();
    });

    it('pausa com cobrarDurantePausa=true não inativa assinatura', async () => {
      const { root } = createPrismaMock({ findFirst: ativaMatricula() });

      const result = await pausarMatricula({
        prisma: root,
        ...basePausaInput,
        cobrarDurantePausa: true,
      });

      expect(result.asaasAction).toBe('SKIPPED_COBRAR_DURANTE_PAUSA');
      expect(pauseAssinaturaMock).not.toHaveBeenCalled();
    });

    it('rejeita pausa se matrícula não é ATIVA', async () => {
      const { root } = createPrismaMock({
        findFirst: { ...ativaMatricula(), status: 'CANCELADA', pausaAtiva: false },
      });

      await expect(pausarMatricula({ prisma: root, ...basePausaInput }))
        .rejects.toThrow(PausaBusinessError);

      await expect(pausarMatricula({ prisma: root, ...basePausaInput }))
        .rejects.toThrow(/precisa estar com status Ativa/);
    });

    it('rejeita pausa se já pausada', async () => {
      const { root } = createPrismaMock({
        findFirst: { ...ativaMatricula(), status: 'PAUSADA', pausaAtiva: true },
      });

      await expect(pausarMatricula({ prisma: root, ...basePausaInput }))
        .rejects.toThrow(/já se encontra pausada/);
    });

    it('rejeita se matrícula não encontrada', async () => {
      const { root } = createPrismaMock({ findFirst: null });

      await expect(pausarMatricula({ prisma: root, ...basePausaInput }))
        .rejects.toMatchObject({ code: 'MATRICULA_NOT_FOUND', statusCode: 404 });
    });

    it('registra operação com ERRO e lança PausaBusinessError se Asaas falhar', async () => {
      const { root } = createPrismaMock({ findFirst: ativaMatricula() });
      pauseAssinaturaMock.mockRejectedValueOnce(new Error('Asaas connection failed'));

      await expect(pausarMatricula({ prisma: root, ...basePausaInput }))
        .rejects.toMatchObject({ code: 'DIVERGENCIA_INTEGRACAO' });

      expect((root as unknown as { matriculaOperacao: { update: ReturnType<typeof vi.fn> } }).matriculaOperacao.update)
        .toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'ERRO' }),
        }));
    });
  });

  // -----------------------------------------------------------------------
  // REATIVAR
  // -----------------------------------------------------------------------
  describe('reativarMatricula', () => {
    it.each([
      ['missing end date', null],
      ['expired end date', new Date('2025-12-31T12:00:00.000Z')],
    ])('blocks reactivation with %s before reconciliation or writes', async (_label, dataFimContrato) => {
      const { root } = createPrismaMock({
        findFirst: pausadaMatricula({ dataFimContrato }),
      });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'VINCULO_ACADEMICO_ENCERRADO', statusCode: 409 });

      expect(root.matricula.findFirst).toHaveBeenCalledTimes(1);
      expect(root.$transaction).not.toHaveBeenCalled();
      expect(root.matriculaOperacao.findFirst).not.toHaveBeenCalled();
      expect(root.matriculaOperacao.findMany).not.toHaveBeenCalled();
      expect(getSubscriptionMock).not.toHaveBeenCalled();
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
      expect(listSubscriptionPaymentsMock).not.toHaveBeenCalled();
    });

    it('bloqueia reativação após prazo vencido antes de qualquer consulta financeira', async () => {
      const { root } = createPrismaMock({
        findFirst: pausadaMatricula({ dataRetornoPrevista: new Date('2026-11-01T00:00:00.000Z') }),
        pauseOperation: { id: 'pause-op-1' },
      });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'PAUSA_PRAZO_VENCIDO_REGULARIZACAO_OBRIGATORIA', statusCode: 409 });
      expect(getSubscriptionMock).not.toHaveBeenCalled();
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
      expect((root as unknown as { matriculaOperacao: { create: ReturnType<typeof vi.fn> } }).matriculaOperacao.create)
        .not.toHaveBeenCalled();
    });

    it('regulariza prazo vencido com operação auditável sem alterar matrícula ou contrato', async () => {
      const { tx } = createPrismaMock({
        findFirst: pausadaMatricula({ dataRetornoPrevista: new Date('2026-11-01T00:00:00.000Z') }),
        pauseOperation: { id: 'pause-op-1' },
      });

      const result = await regularizarPausaVencida({
        tx: tx as never,
        contaId: 'conta-1', matriculaId: 'mat-1', actorId: 'admin-1',
        motivo: 'Instituição confirmou retorno com a família.',
      });

      expect(result).toMatchObject({ id: 'op-1' });
      expect(tx.matriculaOperacao.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          contaId: 'conta-1', matriculaId: 'mat-1', tipo: 'REGULARIZACAO_PAUSA',
          status: 'SINCRONIZADO', actorId: 'admin-1',
          observacao: 'Instituição confirmou retorno com a família.',
          metadata: { pausaOperacaoId: 'pause-op-1', dataRetornoPrevista: '2026-11-01' },
        }),
      }));
      expect(tx.matricula.update).not.toHaveBeenCalled();
    });

    it('retorna a regularização existente em retry sem criar uma segunda operação', async () => {
      const existing = {
        id: 'regularization-existing',
        correlationId: 'corr-existing',
        metadata: { pausaOperacaoId: 'pause-op-1', dataRetornoPrevista: '2026-11-01' },
        createdAt: new Date('2026-11-02T12:00:00.000Z'),
      };
      const { tx } = createPrismaMock({
        findFirst: pausadaMatricula({ dataRetornoPrevista: new Date('2026-11-01T00:00:00.000Z') }),
        pauseOperation: { id: 'pause-op-1' },
        regularizationOperations: [existing],
      });

      const result = await regularizarPausaVencida({
        tx: tx as never,
        contaId: 'conta-1', matriculaId: 'mat-1', actorId: 'admin-retry',
        motivo: 'Retry da regularização já registrada.',
      });

      expect(result).toMatchObject({ id: 'regularization-existing', jaRegularizada: true });
      expect(tx.matriculaOperacao.create).not.toHaveBeenCalled();
    });

    it('reativa matrícula pausada com assinatura', async () => {
      const { root, tx } = createPrismaMock({ findFirst: pausadaMatricula() });

      listSubscriptionPaymentsMock.mockResolvedValueOnce({
        data: [
          { id: 'pay_1', status: 'PENDING', dueDate: '2025-07-10' },
        ],
        hasMore: false,
        totalCount: 1,
      });

      const result = await reativarMatricula({ prisma: root, ...baseReativarInput });

      expect(result.newStatus).toBe('ATIVA');
      expect(result.asaasAction).toBe('SUBSCRIPTION_UPDATED');
      expect(result.integrationStatus).toBe('PENDENTE_SINCRONISMO');
      expect(ativarAssinaturaMock).toHaveBeenCalledWith({
        subscriptionId: 'sub_123',
        contaId: 'conta-1',
        nextDueDate: '2025-08-01',
      });
      expect(getPaymentMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
      expect(tx.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ATIVA', statusFinanceiro: 'ADIMPLENTE' }),
        }),
      );
      expect(tx.matriculaVinculoAcademico.updateMany).toHaveBeenCalledWith({
        where: { contaId: 'conta-1', matriculaId: 'mat-1', vigenciaIniciadaEm: null },
        data: { vigenciaIniciadaEm: new Date(`${baseReativarInput.dataRetornoEfetiva}T12:00:00.000Z`) },
      });
      expect(tx.$executeRaw).toHaveBeenCalledWith(expect.anything(), 'conta-1', 'aluno-1');
    });

    it('restaura como inadimplente quando há cobrança vencida na reativação', async () => {
      const { root, tx } = createPrismaMock({
        findFirst: pausadaMatricula({ asaasSubscriptionId: null }),
        overdueCharges: 1,
      });

      await reativarMatricula({ prisma: root, ...baseReativarInput });

      expect(tx.matricula.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statusFinanceiro: 'INADIMPLENTE' }),
        }),
      );
    });

    it('reativa matrícula sem assinatura (LOCAL_ONLY)', async () => {
      const { root } = createPrismaMock({
        findFirst: pausadaMatricula({ asaasSubscriptionId: null }),
      });

      const result = await reativarMatricula({ prisma: root, ...baseReativarInput });

      expect(result.asaasAction).toBe('LOCAL_ONLY');
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    it('reativa matrícula que tinha cobrarDurantePausa=true não chama Asaas', async () => {
      const { root } = createPrismaMock({
        findFirst: pausadaMatricula({ cobrarDurantePausa: true }),
      });

      const result = await reativarMatricula({ prisma: root, ...baseReativarInput });

      expect(result.asaasAction).toBe('LOCAL_ONLY');
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    it('rejeita se matrícula não é PAUSADA', async () => {
      const { root } = createPrismaMock({ findFirst: ativaMatricula() });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toThrow(/precisa estar com status Pausada/);
    });

    it('rejeita se vaga liberada e turma lotada', async () => {
      const { root, tx } = createPrismaMock({
        findFirst: pausadaMatricula({
          manterVaga: false,
          turma: {
            id: 'turma-1',
            nome: 'Turma A',
            capacidade: 10,
            _count: { matriculas: 10 },
          },
        }),
      });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'SEM_VAGA_PARA_REATIVACAO' });
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
      expect(tx.matriculaOperacao.create).not.toHaveBeenCalled();
    });

    it('reserva a matrícula sob locks antes de ativar assinatura no Asaas', async () => {
      const { root, tx } = createPrismaMock({ findFirst: pausadaMatricula({ manterVaga: false }) });

      await reativarMatricula({ prisma: root, ...baseReativarInput });

      const reservation = tx.matricula.update.mock.calls[0]?.[0];
      expect(reservation).toMatchObject({ data: { manterVaga: true, version: { increment: 1 } } });
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.matricula.update.mock.invocationCallOrder[0]).toBeLessThan(ativarAssinaturaMock.mock.invocationCallOrder[0]!);
    });

    it('rejeita reativação concorrente quando a matrícula mudou sob o lock', async () => {
      const { root } = createPrismaMock({
        findFirst: pausadaMatricula({ manterVaga: false }),
        transactionMatricula: { id: 'mat-1', status: 'PAUSADA', version: 2, manterVaga: true },
      });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'OPERACAO_DUPLICADA', statusCode: 409 });
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
    });

    it('rejeita reativação de combo cheio antes de qualquer efeito financeiro', async () => {
      const { root } = createPrismaMock({
        findFirst: pausadaMatricula({
          manterVaga: false,
          comboId: 'combo-1',
          comboCapacity: 2,
          turma: { id: 'turma-1', nome: 'Turma A', capacidade: 20, _count: { matriculas: 0 } },
        }),
        comboCount: 2,
      });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'COMBO_SEM_VAGAS' });
      expect(ativarAssinaturaMock).not.toHaveBeenCalled();
    });

    it('rejeita se nextDueDate não informada', async () => {
      const { root } = createPrismaMock({ findFirst: pausadaMatricula() });

      await expect(reativarMatricula({
        prisma: root,
        ...baseReativarInput,
        nextDueDate: '',
      })).rejects.toMatchObject({ code: 'NEXT_DUE_DATE_OBRIGATORIO_PARA_REATIVAR' });
    });

    it('rejeita se matrícula não encontrada', async () => {
      const { root } = createPrismaMock({ findFirst: null });

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'MATRICULA_NOT_FOUND', statusCode: 404 });
    });

    it('mantém vaga reservada e operação pendente quando o resultado da ativação é incerto', async () => {
      const { root } = createPrismaMock({ findFirst: pausadaMatricula() });
      ativarAssinaturaMock.mockRejectedValueOnce(new Error('Unauthorized'));

      await expect(reativarMatricula({ prisma: root, ...baseReativarInput }))
        .rejects.toMatchObject({ code: 'DIVERGENCIA_INTEGRACAO' });
      expect((root as unknown as { matriculaOperacao: { update: ReturnType<typeof vi.fn> } }).matriculaOperacao.update)
        .toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDENTE_SINCRONISMO', payloadRecebido: { error: true, outcomeUncertain: true } }),
        }));
      expect((root as unknown as { matricula: { updateMany: ReturnType<typeof vi.fn> } }).matricula.updateMany)
        .not.toHaveBeenCalled();
    });

    it('não altera cobranças já geradas ao reativar a assinatura', async () => {
      const { root } = createPrismaMock({ findFirst: pausadaMatricula() });

      const result = await reativarMatricula({ prisma: root, ...baseReativarInput });

      expect(result.newStatus).toBe('ATIVA');
      expect(result.integrationStatus).toBe('PENDENTE_SINCRONISMO');
      expect(ativarAssinaturaMock).toHaveBeenCalled();
      expect(updatePaymentMock).not.toHaveBeenCalled();
    });

    it('reconcilia reativação pendente travada quando o Asaas já confirma pausa e permite nova reativação', async () => {
      const pendingOperations = [
        {
          id: 'op-pausa',
          tipo: 'PAUSA',
          correlationId: 'corr-pausa',
          createdAt: new Date('2025-06-02T10:00:00.000Z'),
          actorId: 'user-1',
          payloadEnviado: {
            motivoPausa: 'Viagem',
            dataInicioPausa: '2025-06-01',
            dataRetornoPrevista: null,
            manterVaga: true,
            cobrarDurantePausa: false,
          },
        },
        {
          id: 'op-reativar-antiga',
          tipo: 'REATIVACAO',
          correlationId: 'corr-reativar-antiga',
          createdAt: new Date('2025-06-01T10:00:00.000Z'),
          actorId: 'user-1',
          payloadEnviado: {
            dataRetornoEfetiva: '2025-06-01',
            nextDueDate: '2025-07-01',
          },
        },
      ];

      const { root, tx } = createPrismaMock({
        findFirst: pausadaMatricula(),
        pendingOperations,
      });

      getSubscriptionMock.mockResolvedValueOnce({
        id: 'sub_123',
        status: 'INACTIVE',
        deleted: false,
      });

      const result = await reativarMatricula({ prisma: root, ...baseReativarInput });

      expect(result.newStatus).toBe('ATIVA');
      expect(result.asaasAction).toBe('SUBSCRIPTION_UPDATED');
      expect(getSubscriptionMock).toHaveBeenCalledWith('sub_123', { contaId: 'conta-1' });
      expect(tx.matriculaOperacao.updateMany)
        .toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ tipo: 'REATIVACAO', status: 'PENDENTE_SINCRONISMO' }),
          data: expect.objectContaining({ status: 'ERRO' }),
        }));
      expect(tx.matriculaLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'MATRICULA_PAUSA_RECONCILIADA' }),
      }));
      expect(ativarAssinaturaMock).toHaveBeenCalledWith({
        subscriptionId: 'sub_123',
        contaId: 'conta-1',
        nextDueDate: '2025-08-01',
      });
    });
  });
});

describe('eligibilidade server-side da regularização de pausa', () => {
  const baseEligibility = {
    status: 'PAUSADA',
    pausaAtiva: true,
    dataRetornoPrevista: new Date('2026-06-29T00:00:00.000Z'),
    dataFimContrato: new Date('2026-07-30T00:00:00.000Z'),
    timeZone: 'America/Manaus',
    now: new Date('2026-06-30T05:00:00.000Z'),
    possuiOperacaoPausa: true,
    possuiRegularizacao: false,
  };

  it('bloqueia prazo previsto ainda futuro no timezone da Conta', () => {
    const result = avaliarElegibilidadeRegularizacaoPausa({
      ...baseEligibility,
      dataRetornoPrevista: new Date('2026-07-01T00:00:00.000Z'),
    });
    expect(result).toMatchObject({ elegivel: false, codigo: 'PRAZO_RETORNO_NAO_VENCIDO', exigeRegularizacao: false });
  });

  it('permite prazo vencido enquanto o contrato permanece vigente', () => {
    expect(avaliarElegibilidadeRegularizacaoPausa(baseEligibility)).toEqual({
      elegivel: true, exigeRegularizacao: true, codigo: null, mensagem: null,
    });
  });

  it('expõe a elegibilidade calculada no resumo da pausa e lê timezone da Conta', async () => {
    const now = new Date();
    const returnDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const contractEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const mockPrisma = {
      matricula: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'mat-1', status: 'PAUSADA', pausaAtiva: true,
          dataInicioPausa: new Date('2026-06-01T00:00:00.000Z'),
          dataRetornoPrevista: returnDate,
          dataFimContrato: contractEnd,
          manterVaga: true, cobrarDurantePausa: false, motivoPausa: 'Motivo de pausa',
          integrationStatus: 'SINCRONIZADO', warningCode: null, asaasSubscriptionId: null, operacoes: [],
        }),
      },
      conta: { findFirst: vi.fn().mockResolvedValue({ timezone: 'America/Manaus' }) },
      matriculaOperacao: {
        findFirst: vi.fn().mockResolvedValue({ id: 'pause-op-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const summary = await getPausaResumo('mat-1', 'conta-1', mockPrisma);

    expect(summary.regularizacaoPausa).toEqual({ elegivel: true, exigeRegularizacao: true, codigo: null, mensagem: null });
    expect(mockPrisma.conta.findFirst).toHaveBeenCalledWith({ where: { id: 'conta-1' }, select: { timezone: true } });
    expect(mockPrisma.matricula.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'mat-1', aluno: { contaId: 'conta-1' } },
      select: expect.objectContaining({
        dataFimContrato: true,
        operacoes: expect.objectContaining({
          where: { contaId: 'conta-1', tipo: { in: ['PAUSA', 'REATIVACAO'] } },
        }),
      }),
    }));
  });

  it.each([
    ['contrato vencido', new Date('2026-06-29T00:00:00.000Z')],
    ['sem data final confirmada', null],
  ])('bloqueia regularização com %s', (_description, dataFimContrato) => {
    const result = avaliarElegibilidadeRegularizacaoPausa({ ...baseEligibility, dataFimContrato });
    expect(result).toMatchObject({
      elegivel: false,
      codigo: 'CONTRATO_ENCERRADO_REGULARIZACAO_NAO_APLICAVEL',
      exigeRegularizacao: false,
    });
  });

  it('bloqueia uma pausa já regularizada', () => {
    const result = avaliarElegibilidadeRegularizacaoPausa({ ...baseEligibility, possuiRegularizacao: true });
    expect(result).toMatchObject({ elegivel: false, codigo: 'PAUSA_JA_REGULARIZADA', exigeRegularizacao: false });
  });
});
