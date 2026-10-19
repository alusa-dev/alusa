/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { inspectEventFinancialInconsistencies, resolveTenantScope, logJobResult } = vi.hoisted(() => ({
  inspectEventFinancialInconsistencies: vi.fn(),
  resolveTenantScope: vi.fn(),
  logJobResult: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ inspectEventFinancialInconsistencies }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult, logJobFailure: vi.fn() }));

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
    inspectEventFinancialInconsistencies.mockResolvedValue({ ...emptyResult, inspected: 7 });
    const response = await GET(
      new Request('http://localhost/api/jobs/events-inspect-financial-inconsistencies'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      outcome: 'completed',
      job: { inspected: 7, findingCount: 0 },
    });
    expect(inspectEventFinancialInconsistencies).toHaveBeenCalledWith({
      contaId: 'conta-1',
      limit: 200,
      maxAccounts: 20,
    });
    expect(logJobResult).toHaveBeenCalledWith('events-inspect-financial-inconsistencies', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ inspected: 7 }), expect.objectContaining({ workStatus: 'empty' }));
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

  it('registra contagens agregadas por tipo sem incluir identificadores ou mensagens', async () => {
    inspectEventFinancialInconsistencies.mockResolvedValue({
      ...emptyResult,
      inspected: 3,
      findings: [
        { type: 'CONFIRMED_ORDER_WITHOUT_TICKET', contaId: 'private-tenant', eventId: 'private-event', orderId: 'private-order', message: 'private message', asaasPaymentId: 'private-payment' },
        { type: 'CONFIRMED_ORDER_WITHOUT_TICKET', contaId: 'private-tenant', eventId: 'private-event-2', reservationId: 'private-reservation' },
        { type: 'EXPIRED_RESERVATION_HOLDING_SEAT', contaId: 'private-tenant', eventId: 'private-event-3' },
      ],
    });
    await GET(new Request('http://localhost/api/jobs/events-inspect-financial-inconsistencies'));
    const loggedResult = logJobResult.mock.calls[0]?.[2];
    expect(loggedResult.findingsByType).toEqual({
      CONFIRMED_ORDER_WITHOUT_TICKET: 2,
      CONFIRMED_ORDER_WITH_UNSOLD_SEAT: 0,
      PENDING_ORDER_WITHOUT_PAYMENT: 0,
      ORDER_WITH_PAYMENT_WITHOUT_METHOD: 0,
      EXPIRED_RESERVATION_HOLDING_SEAT: 1,
    });
    expect(JSON.stringify(loggedResult)).not.toMatch(/private-tenant|private-event|private-order|private-reservation|private message|private-payment/);
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
