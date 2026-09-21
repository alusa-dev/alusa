/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcilePendingEventMapTicketFulfillment, resolveTenantScope } = vi.hoisted(() => ({
  reconcilePendingEventMapTicketFulfillment: vi.fn(),
  resolveTenantScope: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({ reconcilePendingEventMapTicketFulfillment }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));

import { GET } from '../route';

const emptyResult = {
  processed: 0,
  issued: 0,
  skipped: 0,
  errors: [],
  generatedAt: new Date('2026-09-21T00:00:00.000Z'),
};

describe('GET /api/jobs/events-fulfill-tickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    reconcilePendingEventMapTicketFulfillment.mockResolvedValue(emptyResult);
  });

  it('trata a fila vazia como execução saudável', async () => {
    const response = await GET(new Request('http://localhost/api/jobs/events-fulfill-tickets?limit=0'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, outcome: 'completed', job: { processed: 0, issued: 0 } });
    expect(reconcilePendingEventMapTicketFulfillment).toHaveBeenCalledWith({
      contaId: undefined,
      limit: 1,
      maxAccounts: 20,
      maxAttempts: 10,
    });
  });

  it('sinaliza falha parcial para o monitoramento sem expor detalhes internos', async () => {
    reconcilePendingEventMapTicketFulfillment.mockResolvedValue({
      ...emptyResult,
      processed: 1,
      skipped: 1,
      errors: [{ orderId: 'order-1', contaId: 'conta-1', reason: 'provider unavailable' }],
    });

    const response = await GET(new Request('http://localhost/api/jobs/events-fulfill-tickets'));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'partial' });
  });

  it('retorna erro operacional estável quando o worker falha', async () => {
    reconcilePendingEventMapTicketFulfillment.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new Request('http://localhost/api/jobs/events-fulfill-tickets'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'JOB_FAILED', message: 'Não foi possível concluir a operação agora.' },
    });
  });
});
