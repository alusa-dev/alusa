/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  expireEventMapReservations,
  resolveTenantScope,
  ensureEventAsaasPaymentProviderRegistered,
} = vi.hoisted(() => ({
  expireEventMapReservations: vi.fn(),
  resolveTenantScope: vi.fn(),
  ensureEventAsaasPaymentProviderRegistered: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({ expireEventMapReservations }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));
vi.mock('@/src/server/events/register-event-asaas-payment-provider', () => ({
  ensureEventAsaasPaymentProviderRegistered,
}));

import { GET } from '../route';

const emptyResult = {
  processed: 0,
  expired: 0,
  skipped: 0,
  errors: [],
  generatedAt: new Date('2026-09-21T00:00:00.000Z'),
};

describe('GET /api/jobs/events-expire-reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: 'conta-1', isCron: true });
    expireEventMapReservations.mockResolvedValue(emptyResult);
  });

  it('retorna execução saudável e mantém o registro do provider', async () => {
    const response = await GET(
      new Request('http://localhost/api/jobs/events-expire-reservations?limit=0'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      outcome: 'completed',
      job: { processed: 0, errorCount: 0 },
    });
    expect(ensureEventAsaasPaymentProviderRegistered).toHaveBeenCalledOnce();
    expect(expireEventMapReservations).toHaveBeenCalledWith({
      contaId: 'conta-1',
      limit: 1,
      maxAccounts: 20,
      maxExternalPaymentChecks: 25,
    });
  });

  it('informa falha parcial apenas por contagem segura', async () => {
    expireEventMapReservations.mockResolvedValue({
      ...emptyResult,
      processed: 1,
      errors: [
        { reservationId: 'private-id', contaId: 'other-account', reason: 'provider detail' },
      ],
    });
    const response = await GET(new Request('http://localhost/api/jobs/events-expire-reservations'));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, outcome: 'partial', job: { errorCount: 1 } });
    expect(JSON.stringify(body)).not.toMatch(/private-id|other-account|provider detail/);
  });

  it('retorna erro estável se o worker lança exceção', async () => {
    expireEventMapReservations.mockRejectedValue(new Error('provider detail'));
    const response = await GET(new Request('http://localhost/api/jobs/events-expire-reservations'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: 'JOB_FAILED' } });
    expect(JSON.stringify(body)).not.toContain('provider detail');
  });

  it('preserva a resposta de falha de escopo do tenant', async () => {
    resolveTenantScope.mockResolvedValue({
      ok: false,
      response: new Response('forbidden', { status: 403 }),
    });
    const response = await GET(new Request('http://localhost/api/jobs/events-expire-reservations'));
    expect(response.status).toBe(403);
    expect(expireEventMapReservations).not.toHaveBeenCalled();
  });
});
