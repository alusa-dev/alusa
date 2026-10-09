/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inspectEventFinancialInconsistencies, resolveTenantScope } = vi.hoisted(() => ({
  inspectEventFinancialInconsistencies: vi.fn(),
  resolveTenantScope: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ inspectEventFinancialInconsistencies }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET } from '../route';

const emptyResult = {
  inspected: 0,
  findings: [],
  generatedAt: new Date('2026-09-21T00:00:00.000Z'),
};

describe('GET /api/jobs/events-inspect-financial-inconsistencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: 'conta-1', isCron: true });
    inspectEventFinancialInconsistencies.mockResolvedValue(emptyResult);
  });

  it('retorna contagens seguras para inspeção sem findings', async () => {
    const response = await GET(
      new Request('http://localhost/api/jobs/events-inspect-financial-inconsistencies'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      outcome: 'completed',
      job: { inspected: 0, findingCount: 0 },
    });
    expect(inspectEventFinancialInconsistencies).toHaveBeenCalledWith({
      contaId: 'conta-1',
      limit: 200,
      maxAccounts: 20,
    });
  });

  it('não expõe detalhes das findings no HTTP', async () => {
    inspectEventFinancialInconsistencies.mockResolvedValue({
      ...emptyResult,
      inspected: 1,
      findings: [
        { orderId: 'private-order', contaId: 'private-tenant', customerName: 'Private Customer' },
      ],
    });
    const response = await GET(
      new Request('http://localhost/api/jobs/events-inspect-financial-inconsistencies'),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ job: { inspected: 1, findingCount: 1 } });
    expect(JSON.stringify(body)).not.toMatch(/private-order|private-tenant|Private Customer/);
  });

  it('retorna erro estável quando a inspeção falha', async () => {
    inspectEventFinancialInconsistencies.mockRejectedValue(new Error('database detail'));
    const response = await GET(
      new Request('http://localhost/api/jobs/events-inspect-financial-inconsistencies'),
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'JOB_FAILED' } });
    expect(JSON.stringify(body)).not.toContain('database detail');
  });

  it('preserva falha de resolução do tenant', async () => {
    resolveTenantScope.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    const response = await GET(
      new Request('http://localhost/api/jobs/events-inspect-financial-inconsistencies'),
    );
    expect(response.status).toBe(403);
    expect(inspectEventFinancialInconsistencies).not.toHaveBeenCalled();
  });
});
