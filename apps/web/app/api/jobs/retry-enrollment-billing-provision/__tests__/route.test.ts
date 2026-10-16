/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enrollment: vi.fn(), family: vi.fn(), individual: vi.fn(), scope: vi.fn(), log: vi.fn() }));
vi.mock('@/src/server/enrollments/enrollment-billing-outbox.service', () => ({ processEnrollmentBillingOutboxBatch: mocks.enrollment }));
vi.mock('@/src/server/family-billing/processor', () => ({ processFamilyBillingOutboxBatch: mocks.family }));
vi.mock('@/src/server/enrollments/retry-enrollment-billing-provision', () => ({ retryEnrollmentBillingProvisionJob: mocks.individual }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));

import { GET } from '../route';

describe('retry-enrollment-billing-provision work classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, isCron: true, contaId: 'conta-a' });
    mocks.enrollment.mockResolvedValue({ attempted: 0, processed: 0, failed: 0, requiresReconciliation: 0, skipped: 0, results: [] });
    mocks.family.mockResolvedValue({ attempted: 0, processed: 0, failed: 0 });
    mocks.individual.mockResolvedValue({ scanned: 0, retried: 0, recovered: 0, skipped: 0, errors: [] });
  });

  it('does not count scanned or dry-run retry candidates as processed work', async () => {
    mocks.individual.mockResolvedValue({ scanned: 2, retried: 0, recovered: 0, skipped: 2, errors: [] });
    await GET(new Request('http://localhost/api/jobs/retry-enrollment-billing-provision'));
    expect(mocks.log).toHaveBeenLastCalledWith('retry-enrollment-billing-provision', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ scanned: 2 }), expect.objectContaining({ workStatus: 'unknown' }));

    mocks.individual.mockResolvedValue({ scanned: 2, retried: 2, recovered: 0, skipped: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/retry-enrollment-billing-provision?dryRun=true'));
    expect(mocks.log).toHaveBeenLastCalledWith('retry-enrollment-billing-provision', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'unknown' }));

    mocks.individual.mockResolvedValue({ scanned: 2, retried: 1, recovered: 1, skipped: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/retry-enrollment-billing-provision'));
    expect(mocks.log).toHaveBeenLastCalledWith('retry-enrollment-billing-provision', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));

    mocks.individual.mockResolvedValue({ scanned: 0, retried: 0, recovered: 0, skipped: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/retry-enrollment-billing-provision'));
    expect(mocks.log).toHaveBeenLastCalledWith('retry-enrollment-billing-provision', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });
});
