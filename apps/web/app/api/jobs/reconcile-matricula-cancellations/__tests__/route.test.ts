/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveTenantScopeMock, listContasMock, logJobFailureMock, logJobResultMock } = vi.hoisted(() => ({
  resolveTenantScopeMock: vi.fn(),
  listContasMock: vi.fn(),
  logJobFailureMock: vi.fn(),
  logJobResultMock: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobFailure: logJobFailureMock,
  logJobResult: logJobResultMock,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: resolveTenantScopeMock }));
vi.mock('@/src/server/enrollments/enrollment-sync.service', () => ({
  listContasWithPendingMatriculaCancellations: listContasMock,
  reconcilePendingMatriculaCancellations: vi.fn(),
}));

import { POST } from '../route';

describe('POST /api/jobs/reconcile-matricula-cancellations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScopeMock.mockResolvedValue({ ok: true, contaId: null });
  });

  it('registra falha quando a enumeração de contas falha após iniciar o job', async () => {
    const error = new Error('private database failure');
    listContasMock.mockRejectedValueOnce(error);

    const response = await POST(new Request('http://localhost/api/jobs/reconcile-matricula-cancellations'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: { code: 'ERRO_JOB' } });
    expect(logJobFailureMock).toHaveBeenCalledWith(
      'reconcile-matricula-cancellations',
      expect.objectContaining({ correlationId: 'test-run-id' }),
      error,
    );
    expect(logJobResultMock).not.toHaveBeenCalled();
  });
});
