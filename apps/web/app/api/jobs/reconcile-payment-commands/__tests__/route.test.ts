/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reconcilePendingPaymentCommands: vi.fn(),
  reconcileOutboundFinancialOperations: vi.fn(),
  reconcileEnrollmentCreationOperations: vi.fn(),
  resolveTenantScope: vi.fn(),
  logJobResult: vi.fn(),
  logJobFailure: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({
  reconcilePendingPaymentCommands: mocks.reconcilePendingPaymentCommands,
  reconcileOutboundFinancialOperations: mocks.reconcileOutboundFinancialOperations,
}));
vi.mock('@/src/server/enrollments/reconcile-enrollment-creation-operations', () => ({
  reconcileEnrollmentCreationOperations: mocks.reconcileEnrollmentCreationOperations,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.logJobResult, logJobFailure: mocks.logJobFailure }));

import { GET } from '../route';

describe('GET /api/jobs/reconcile-payment-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    mocks.reconcilePendingPaymentCommands.mockResolvedValue({ scanned: 2, synced: 0, stale: { processed: 1, marked: 0 } });
    mocks.reconcileOutboundFinancialOperations.mockResolvedValue({ scanned: 3, recovered: 0, missing: 0, divergent: 0 });
    mocks.reconcileEnrollmentCreationOperations.mockResolvedValue({ inspected: 4, committed: 0, compensated: 0, attention: 0, suspended: 0, waiting: 0 });
  });

  it('keeps scan-only executions unknown and logs fixed stage count aggregates', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/reconcile-payment-commands'));
    expect(response.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenCalledWith('reconcile-payment-commands', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), {
      commandsScanned: 2,
      staleCommandsScanned: 1,
      staleCommandsMarked: 0,
      outboundOperationsScanned: 3,
      enrollmentCreationsInspected: 4,
      enrollmentCreationsCommitted: 0,
      enrollmentCreationsCompensated: 0,
      enrollmentCreationsAttention: 0,
      enrollmentCreationsSuspended: 0,
      enrollmentCreationsWaiting: 0,
    }, expect.objectContaining({ workStatus: 'unknown' }));

    mocks.reconcilePendingPaymentCommands.mockResolvedValue({ scanned: 2, synced: 1, stale: { processed: 1, marked: 0 } });
    const workedResponse = await GET(new Request('http://localhost/api/jobs/reconcile-payment-commands'));
    expect(workedResponse.status).toBe(200);
    expect(mocks.logJobResult).toHaveBeenLastCalledWith('reconcile-payment-commands', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));

    mocks.reconcilePendingPaymentCommands.mockResolvedValue({ scanned: 0, synced: 0, stale: { processed: 0, marked: 0 } });
    mocks.reconcileOutboundFinancialOperations.mockResolvedValue({ scanned: 0, recovered: 0, missing: 0, divergent: 0 });
    mocks.reconcileEnrollmentCreationOperations.mockResolvedValue({ inspected: 0, committed: 0, compensated: 0, attention: 0, suspended: 0, waiting: 0 });
    await GET(new Request('http://localhost/api/jobs/reconcile-payment-commands'));
    expect(mocks.logJobResult).toHaveBeenLastCalledWith('reconcile-payment-commands', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });
});
