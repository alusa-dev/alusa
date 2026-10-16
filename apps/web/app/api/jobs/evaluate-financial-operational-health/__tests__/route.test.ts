/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), scope: vi.fn(), log: vi.fn() }));

vi.mock('@alusa/finance', () => ({ evaluateFinancialOperationalHealth: mocks.evaluate }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));

import { GET } from '../route';

describe('evaluate-financial-operational-health work classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, isCron: true, contaId: undefined });
    mocks.evaluate.mockResolvedValue({ accounts: [] });
  });

  it('uses empty for a global no-alert result and unknown for an inconclusive tenant-scoped result', async () => {
    await GET(new Request('http://localhost/api/jobs/evaluate-financial-operational-health'));
    expect(mocks.log).toHaveBeenLastCalledWith(
      'evaluate-financial-operational-health',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'empty' }),
    );

    mocks.scope.mockResolvedValue({ ok: true, isCron: false, contaId: 'conta-a' });
    await GET(new Request('http://localhost/api/jobs/evaluate-financial-operational-health?contaId=conta-a'));
    expect(mocks.log).toHaveBeenLastCalledWith(
      'evaluate-financial-operational-health',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'unknown' }),
    );
  });
});
