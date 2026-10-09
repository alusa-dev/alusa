/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcilePendingEventMapOrders, resolveTenantScope } = vi.hoisted(() => ({
  reconcilePendingEventMapOrders: vi.fn(),
  resolveTenantScope: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ reconcilePendingEventMapOrders }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET } from '../route';

const emptyResult = {
  processed: 0,
  updated: 0,
  consistent: 0,
  skipped: 0,
  errors: [],
  generatedAt: new Date('2026-09-21T00:00:00.000Z'),
};

describe('GET /api/jobs/events-reconcile-orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    reconcilePendingEventMapOrders.mockResolvedValue(emptyResult);
  });

  it('trata execução vazia e skippedDueToLock como normal', async () => {
    reconcilePendingEventMapOrders.mockResolvedValue({ ...emptyResult, skippedDueToLock: true });
    const response = await GET(new Request('http://localhost/api/jobs/events-reconcile-orders'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      outcome: 'completed',
      job: { processed: 0, skippedDueToLock: true },
    });
  });

  it('sinaliza erro parcial sem expor pedido, tenant ou motivo', async () => {
    reconcilePendingEventMapOrders.mockResolvedValue({
      ...emptyResult,
      processed: 1,
      errors: [{ orderId: 'private-order', contaId: 'private-tenant', reason: 'provider detail' }],
    });
    const response = await GET(new Request('http://localhost/api/jobs/events-reconcile-orders'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, outcome: 'partial', job: { errorCount: 1 } });
    expect(JSON.stringify(body)).not.toMatch(/private-order|private-tenant|provider detail/);
  });

  it('retorna erro operacional estável em exceção', async () => {
    reconcilePendingEventMapOrders.mockRejectedValue(new Error('private provider detail'));
    const response = await GET(new Request('http://localhost/api/jobs/events-reconcile-orders'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'JOB_FAILED' } });
    expect(JSON.stringify(body)).not.toContain('private provider detail');
  });

  it('preserva falha de resolução do tenant', async () => {
    resolveTenantScope.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const response = await GET(new Request('http://localhost/api/jobs/events-reconcile-orders'));
    expect(response.status).toBe(401);
    expect(reconcilePendingEventMapOrders).not.toHaveBeenCalled();
  });
});
