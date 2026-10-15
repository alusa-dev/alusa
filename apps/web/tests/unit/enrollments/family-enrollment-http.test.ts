import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatriculaFamiliarInputSchema } from '@/src/server/enrollments/family-enrollment.schema';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { familyEnrollmentOperation: { findFirst: vi.fn() } },
}));

vi.mock('@/prisma/client', () => ({ prisma: prismaMock }));

const hash = 'a'.repeat(64);
const request = createMatriculaFamiliarInputSchema.parse({
  responsavelId: 'responsavel-1',
  modoTurmas: 'TURMAS',
  planoId: 'plano-1',
  alunos: [{ itemId: 'item-1', alunoId: 'aluno-1', turmaId: 'turma-1' }],
  vencimentoDia: 10,
  formaPagamento: 'PIX',
  dataInicio: '2026-08-01',
  dataFimContrato: '2027-07-31',
  modeloId: 'modelo-1',
  previewHash: hash,
  sourceVersion: hash,
  previewExpiresAt: '2026-08-01T12:00:00.000Z',
  uiRequestId: 'family-request-1',
});

function requestFingerprint() {
  return createHash('sha256')
    .update(
      JSON.stringify({
        responsavelId: request.responsavelId,
        modoTurmas: request.modoTurmas,
        planoId: request.planoId ?? null,
        alunos: request.alunos,
        descontoIds: request.descontoIds,
        taxaMatricula: request.taxaMatricula,
        taxaIsenta: request.taxaIsenta,
        taxaJustificativa: request.taxaJustificativa ?? null,
        gerarCobrancaTaxa: request.gerarCobrancaTaxa,
        criarCobranca: request.criarCobranca,
        dataInicio: request.dataInicio,
        dataFimContrato: request.dataFimContrato,
        modeloId: request.modeloId,
        vencimentoDia: request.vencimentoDia,
        formaPagamento: request.formaPagamento,
        formaPagamentoTaxa: request.formaPagamentoTaxa,
        billingStrategy: request.billingStrategy,
        multaPercentual: request.multaPercentual ?? null,
        jurosMensal: request.jurosMensal ?? null,
        descontoAntecipado: request.descontoAntecipado ?? null,
        descontoTipo: request.descontoTipo ?? null,
        prazoDesconto: request.prazoDesconto ?? null,
        notificationChannels: [...request.notificationChannels].sort(),
        notificationChannelsConfigured: request.notificationChannelsConfigured,
      }),
    )
    .digest('hex');
}

function storedOperation(status: string, result: unknown = null) {
  return {
    id: 'operation-1',
    familyGroupId: 'family-1',
    status,
    previewHash: request.previewHash,
    sourceVersion: request.sourceVersion,
    strategy: request.billingStrategy.kind,
    requestFingerprint: requestFingerprint(),
    result,
  };
}

describe('executeCreateFamilyEnrollment idempotent HTTP responses', () => {
  beforeEach(() => vi.clearAllMocks());

  async function execute() {
    const { executeCreateFamilyEnrollment } =
      await import('@/src/server/enrollments/create-family-enrollment.use-case');
    return executeCreateFamilyEnrollment({
      body: request,
      contaId: 'conta-1',
      actor: { id: 'user-1', contaId: 'conta-1' },
    });
  }

  it('returns 202 with an observable operation for existing in-progress intent without provisioning again', async () => {
    prismaMock.familyEnrollmentOperation.findFirst.mockResolvedValue(storedOperation('PENDING'));

    const response = await execute();

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      data: {
        operationId: 'operation-1',
        familyId: 'family-1',
        operationStatus: 'PENDING',
        state: 'PROCESSING',
      },
      meta: { code: 'OPERACAO_FAMILIAR_EM_ANDAMENTO' },
    });
    expect(prismaMock.familyEnrollmentOperation.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns nested reconciliation conflict without staging another operation', async () => {
    prismaMock.familyEnrollmentOperation.findFirst.mockResolvedValue(
      storedOperation('REQUIRES_RECONCILIATION'),
    );

    const response = await execute();

    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'REQUIRES_RECONCILIATION',
        details: { operationId: 'operation-1', operationStatus: 'REQUIRES_RECONCILIATION' },
      },
    });
    expect(prismaMock.familyEnrollmentOperation.findFirst).toHaveBeenCalledTimes(1);
  });

  it('replays completed result without rerunning preview or staging', async () => {
    const result = {
      familyId: 'family-1',
      academicStatus: 'COMPLETO',
      results: [{ alunoId: 'aluno-1', status: 'success' }],
    };
    prismaMock.familyEnrollmentOperation.findFirst.mockResolvedValue(
      storedOperation('COMPLETED', result),
    );

    const response = await execute();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      ...result,
      operationStatus: 'COMPLETED',
    });
    expect(prismaMock.familyEnrollmentOperation.findFirst).toHaveBeenCalledTimes(1);
  });
});
