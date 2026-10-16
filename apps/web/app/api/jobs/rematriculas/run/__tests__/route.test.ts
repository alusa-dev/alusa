/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveTenantScopeMock,
  activateRenewalProcessesMock,
  listRenewalJobContaIdsMock,
  materializeRenewalContractsMock,
  processRenewalOutboxMock,
  provisionFutureFinancialAgreementsMock,
  logJobResultMock,
} = vi.hoisted(() => ({
  resolveTenantScopeMock: vi.fn(),
  activateRenewalProcessesMock: vi.fn(),
  listRenewalJobContaIdsMock: vi.fn(),
  materializeRenewalContractsMock: vi.fn(),
  processRenewalOutboxMock: vi.fn(),
  provisionFutureFinancialAgreementsMock: vi.fn(),
  logJobResultMock: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: resolveTenantScopeMock }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: logJobResultMock }));
vi.mock('@/src/server/enrollments/renewal-job-commands.service', () => ({
  activateRenewalProcessesFromJob: activateRenewalProcessesMock,
  listRenewalJobContaIds: listRenewalJobContaIdsMock,
  materializeRenewalContractsFromJob: materializeRenewalContractsMock,
  processRenewalOutboxFromJob: processRenewalOutboxMock,
  provisionFutureFinancialAgreementsFromJob: provisionFutureFinancialAgreementsMock,
}));

import { GET } from '../route';

describe('GET /api/jobs/rematriculas/run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScopeMock.mockResolvedValue({ ok: true, contaId: 'tenant-private-id' });
    listRenewalJobContaIdsMock.mockResolvedValue([]);
    materializeRenewalContractsMock.mockResolvedValue([
      { processoId: 'process-private-id', contratoId: 'contract-private-id', success: true },
    ]);
    provisionFutureFinancialAgreementsMock.mockResolvedValue([
      { acordoId: 'agreement-private-id', status: 'QUEUED' },
    ]);
    processRenewalOutboxMock.mockResolvedValue([
      { eventId: 'outbox-private-id', status: 'PROCESSED' },
    ]);
    activateRenewalProcessesMock.mockResolvedValue([
      { processId: 'activation-private-id', status: 'EFFECTIVE' },
    ]);
  });

  it('retorna completed para resultados sem falhas nem atenção', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/rematriculas/run'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
  });

  it('retorna needs_attention para ativações bloqueadas sem falha técnica', async () => {
    activateRenewalProcessesMock.mockResolvedValue([
      { processId: 'activation-private-id', status: 'REQUIRES_ATTENTION' },
    ]);

    const response = await GET(new Request('http://localhost/api/jobs/rematriculas/run'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(body.results).toHaveLength(1);
    expect(logJobResultMock).toHaveBeenCalledWith(
      'rematriculas-run',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({
        contractsMaterialized: 1,
        agreementsQueued: 1,
        outboxProcessed: 1,
        activationsNeedingAttention: 1,
      }),
      expect.objectContaining({ partialFailure: false, attentionRequired: true }),
    );
  });

  it('registra falhas parciais sem incluir ids ou mensagens no log', async () => {
    materializeRenewalContractsMock.mockResolvedValue([
      { processoId: 'process-private-id', contratoId: null, success: false, error: 'private contract error' },
    ]);
    processRenewalOutboxMock.mockResolvedValue([
      { eventId: 'outbox-private-id', status: 'FAILED', error: 'private outbox error' },
    ]);

    const response = await GET(new Request('http://localhost/api/jobs/rematriculas/run'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(logJobResultMock).toHaveBeenCalledWith(
      'rematriculas-run',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({ contractsFailed: 1, outboxFailed: 1 }),
      expect.objectContaining({ partialFailure: true, attentionRequired: false, workStatus: 'worked' }),
    );
    expect(JSON.stringify(logJobResultMock.mock.calls)).not.toMatch(
      /tenant-private-id|process-private-id|contract-private-id|outbox-private-id|private contract error|private outbox error/,
    );
  });

  it('registra unknown quando uma conta falha antes de qualquer contador de trabalho', async () => {
    listRenewalJobContaIdsMock.mockResolvedValue(['tenant-private-id']);
    materializeRenewalContractsMock.mockRejectedValue(new Error('private account failure'));

    const response = await GET(new Request('http://localhost/api/jobs/rematriculas/run'));

    expect(response.status).toBe(200);
    expect(logJobResultMock).toHaveBeenCalledWith(
      'rematriculas-run',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({ failedAccounts: 1 }),
      expect.objectContaining({ partialFailure: true, workStatus: 'unknown' }),
    );
  });
});
