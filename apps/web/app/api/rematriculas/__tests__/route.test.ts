/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getServerSessionMock,
  rematricularAlunoMock,
  createAsaasPaymentsProviderMock,
  validarElegibilidadeRematriculaMock,
  getContaFinancialPolicyMock,
  buildFinancialSnapshotMock,
  evaluateRematriculaDecisionMock,
  serializeFinancialSnapshotMock,
  serializePolicySnapshotMock,
  prismaMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  rematricularAlunoMock: vi.fn(),
  createAsaasPaymentsProviderMock: vi.fn(() => ({ provider: 'mocked' })),
  validarElegibilidadeRematriculaMock: vi.fn(() => ({ success: true })),
  getContaFinancialPolicyMock: vi.fn(),
  buildFinancialSnapshotMock: vi.fn(),
  evaluateRematriculaDecisionMock: vi.fn(),
  serializeFinancialSnapshotMock: vi.fn(),
  serializePolicySnapshotMock: vi.fn(),
  prismaMock: {
    matricula: {
      findFirst: vi.fn(),
    },
    matriculaLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/server/matriculas/rematricula.service', () => ({
  listarRematriculasElegiveis: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  rematricularAluno: rematricularAlunoMock,
  createAsaasPaymentsProvider: createAsaasPaymentsProviderMock,
}));

vi.mock('@/src/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@alusa/domain', () => ({
  validarElegibilidadeRematricula: validarElegibilidadeRematriculaMock,
}));

vi.mock('@/src/server/matriculas/rematricula-financial-policy.service', () => ({
  getContaFinancialPolicy: getContaFinancialPolicyMock,
  buildFinancialSnapshot: buildFinancialSnapshotMock,
  evaluateRematriculaDecision: evaluateRematriculaDecisionMock,
  serializeFinancialSnapshot: serializeFinancialSnapshotMock,
  serializePolicySnapshot: serializePolicySnapshotMock,
}));

const { POST } = await import('../route');

function authenticatedSession(role = 'ADMIN') {
  return { user: { id: 'user-1', contaId: 'conta-1', role } };
}

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/rematriculas', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeDecisionMatricula() {
  return {
    id: 'mat-1',
    status: 'ATIVA',
    dataFimContrato: new Date('2025-01-31T00:00:00.000Z'),
    integrationStatus: 'SINCRONIZADO',
    statusFinanceiro: 'EM_DIA',
    cobrancas: [{ status: 'ATRASADO' }],
  };
}

describe('POST /api/rematriculas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSessionMock.mockResolvedValue(authenticatedSession());
    getContaFinancialPolicyMock.mockResolvedValue({
      preset: 'CONTROLADA',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
      overrideRoles: ['ADMIN'],
    });
    buildFinancialSnapshotMock.mockReturnValue({
      pendingCharges: 1,
      overdueCharges: 1,
      financialStatus: 'COM_PENDENCIAS',
    });
    serializePolicySnapshotMock.mockReturnValue({ snapshot: 'policy' });
    serializeFinancialSnapshotMock.mockReturnValue({ snapshot: 'financial' });
  });

  it('bloqueia a rematrícula quando a política exigir bloqueio e audita a tentativa', async () => {
    prismaMock.matricula.findFirst.mockResolvedValueOnce(makeDecisionMatricula());
    evaluateRematriculaDecisionMock.mockReturnValue({
      actionStatus: 'BLOQUEADA',
      blockReason: 'POSSUI_INADIMPLENCIA',
      message: 'A política financeira bloqueia a rematrícula enquanto houver inadimplência.',
      canCurrentUserOverride: false,
      requiresOverrideReason: true,
    });

    const response = await POST(
      buildRequest({
        contaId: 'conta-1',
        matriculaId: 'mat-1',
        dataFimContrato: '2025-12-31',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error.code).toBe('REMATRICULA_BLOQUEADA');
    expect(rematricularAlunoMock).not.toHaveBeenCalled();
    expect(prismaMock.matriculaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matriculaId: 'mat-1',
          actorId: 'user-1',
          action: 'REMATRICULA_TENTATIVA_BLOQUEADA',
          metadata: expect.objectContaining({
            reason: 'POSSUI_INADIMPLENCIA',
            policySnapshot: { snapshot: 'policy' },
            financialSnapshot: { snapshot: 'financial' },
          }),
        }),
      }),
    );
  });

  it('exige motivo de override quando a política permitir rematrícula apenas com autorização', async () => {
    prismaMock.matricula.findFirst.mockResolvedValueOnce(makeDecisionMatricula());
    evaluateRematriculaDecisionMock.mockReturnValue({
      actionStatus: 'REQUER_OVERRIDE',
      blockReason: 'NOVO_CICLO_BLOQUEADO',
      message:
        'A rematrícula precisa de autorização administrativa para abrir um novo ciclo financeiro.',
      canCurrentUserOverride: true,
      requiresOverrideReason: true,
    });

    const response = await POST(
      buildRequest({
        contaId: 'conta-1',
        matriculaId: 'mat-1',
        dataFimContrato: '2025-12-31',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error.code).toBe('OVERRIDE_MOTIVO_OBRIGATORIO');
    expect(rematricularAlunoMock).not.toHaveBeenCalled();
    expect(prismaMock.matriculaLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            reason: 'OVERRIDE_MOTIVO_OBRIGATORIO',
          }),
        }),
      }),
    );
  });

  it('propaga contexto de política e override para o caso autorizado', async () => {
    prismaMock.matricula.findFirst
      .mockResolvedValueOnce(makeDecisionMatricula())
      .mockResolvedValueOnce({
        id: 'nova-1',
        planoId: 'plano-novo',
        turmaId: 'turma-nova',
        status: 'ATIVA',
        statusContrato: 'AGUARDANDO_ASSINATURA',
        dataInicio: new Date('2025-02-01T00:00:00.000Z'),
        dataFimContrato: new Date('2025-12-31T00:00:00.000Z'),
        asaasSubscriptionId: 'sub-nova',
        vencimentoDia: 10,
        responsavelFinanceiro: {
          id: 'resp-1',
          nome: 'Responsável',
          cpf: '12345678900',
        },
      })
      .mockResolvedValueOnce({
        dataInicio: new Date('2024-02-01T00:00:00.000Z'),
        dataFimContrato: new Date('2025-01-31T00:00:00.000Z'),
        turmaId: 'turma-antiga',
        planoId: 'plano-antigo',
      });

    evaluateRematriculaDecisionMock.mockReturnValue({
      actionStatus: 'REQUER_OVERRIDE',
      blockReason: 'NOVO_CICLO_BLOQUEADO',
      message: 'Override permitido para abrir o novo ciclo financeiro.',
      canCurrentUserOverride: true,
      requiresOverrideReason: true,
    });

    rematricularAlunoMock.mockResolvedValue({
      success: true,
      data: {
        operationId: 'op-1',
        status: 'COMMITTED',
        matriculaIdNova: 'nova-1',
        uiMessage: 'Rematrícula concluída.',
      },
    });

    const response = await POST(
      buildRequest({
        contaId: 'conta-1',
        matriculaId: 'mat-1',
        planoId: 'plano-novo',
        turmaId: 'turma-nova',
        dataInicio: '2025-02-01',
        dataFimContrato: '2025-12-31',
        formaPagamento: 'BOLETO',
        billingMode: 'SHARED_PLAN',
        valorMensalidadeOverride: 300,
        overrideReason: 'Autorizado pela coordenação financeira.',
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.operationId).toBe('op-1');
    expect(data.matriculaId).toBe('nova-1');
    expect(rematricularAlunoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        overrideReason: 'Autorizado pela coordenação financeira.',
        billingMode: 'SHARED_PLAN',
        valorMensalidadeOverride: 300,
        policyContext: expect.objectContaining({
          actionStatus: 'REQUER_OVERRIDE',
          blockReason: 'NOVO_CICLO_BLOQUEADO',
          policySnapshot: { snapshot: 'policy' },
          financialSnapshot: { snapshot: 'financial' },
          overrideUsed: true,
          overrideApprovedById: 'user-1',
        }),
      }),
      expect.objectContaining({
        prisma: prismaMock,
        paymentsProvider: { provider: 'mocked' },
      }),
    );
  });
});
