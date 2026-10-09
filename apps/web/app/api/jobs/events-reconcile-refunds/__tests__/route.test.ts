/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileRefundingEventMapOrders, resolveTenantScope } = vi.hoisted(() => ({
  reconcileRefundingEventMapOrders: vi.fn(),
  resolveTenantScope: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ reconcileRefundingEventMapOrders }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET } from '../route';

const emptyResult = {
  processed: 0,
  finalized: 0,
  denied: 0,
  stillProcessing: 0,
  unmatched: 0,
  skipped: 0,
  errors: [],
  generatedAt: new Date('2026-09-21T00:00:00.000Z'),
};

describe('GET /api/jobs/events-reconcile-refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    reconcileRefundingEventMapOrders.mockResolvedValue(emptyResult);
  });

  it('reconcilia em escopo tenant e aplica limites configuráveis', async () => {
    resolveTenantScope.mockResolvedValueOnce({ ok: true, contaId: 'conta-1', isCron: true });
    const response = await GET(new Request(
      'http://localhost/api/jobs/events-reconcile-refunds?contaId=conta-1&limit=10&olderThanMinutes=8&maxAccounts=3',
    ));

    expect(response.status).toBe(200);
    expect(resolveTenantScope).toHaveBeenCalledWith(expect.any(Request), {
      allowCron: true,
      requestedContaId: 'conta-1',
    });
    expect(reconcileRefundingEventMapOrders).toHaveBeenCalledWith({
      contaId: 'conta-1',
      limit: 10,
      olderThanMinutes: 8,
      maxAccounts: 3,
    });
  });

  it('não expõe identificadores nem detalhes das falhas no payload do cron', async () => {
    reconcileRefundingEventMapOrders.mockResolvedValue({
      ...emptyResult,
      processed: 1,
      errors: [{ orderId: 'private-order', contaId: 'private-tenant', reason: 'provider detail' }],
    });

    const response = await GET(new Request('http://localhost/api/jobs/events-reconcile-refunds'));

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, outcome: 'partial', job: { errorCount: 1 } });
    expect(JSON.stringify(body)).not.toMatch(/private-order|private-tenant|provider detail/);
  });

  it('preserva falha de resolução tenant e não inicia a reconciliação', async () => {
    resolveTenantScope.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });

    const response = await GET(new Request('http://localhost/api/jobs/events-reconcile-refunds'));

    expect(response.status).toBe(401);
    expect(reconcileRefundingEventMapOrders).not.toHaveBeenCalled();
  });
});
