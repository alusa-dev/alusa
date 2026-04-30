/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/admin/financial/webhooks/replay/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  replayWebhookByEventId: vi.fn(),
  replayWebhooksByDateRange: vi.fn(),
}));

const { getServerSession } = await import('next-auth');
const { replayWebhookByEventId, replayWebhooksByDateRange } = await import('@alusa/finance');

function mockSession(user: { id?: string; contaId?: string; role?: string } | null) {
  vi.mocked(getServerSession).mockResolvedValueOnce(user ? ({ user } as never) : (null as never));
}

function makePostReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/financial/webhooks/replay', {
    method: 'POST',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/financial/webhooks/replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    mockSession(null);

    const res = await POST(makePostReq({ eventId: 'evt_1' }));
    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'PROFESSOR' });

    const res = await POST(makePostReq({ eventId: 'evt_1' }));
    expect(res.status).toBe(403);
  });

  it('retorna 400 quando payload inválido', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });

    const res = await POST(makePostReq({}));
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json).toMatchObject({ error: 'PARAMETROS_INVALIDOS' });
  });

  it('faz replay por eventId', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });

    vi.mocked(replayWebhookByEventId).mockResolvedValueOnce({
      success: true,
      eventId: 'evt_1',
      status: 'REPLAYED',
    } as never);

    const res = await POST(makePostReq({ eventId: 'evt_1' }));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ ok: true, result: { success: true, eventId: 'evt_1', status: 'REPLAYED' } });
    expect(replayWebhookByEventId).toHaveBeenCalledWith({ contaId: 'c1', eventId: 'evt_1', force: undefined });
  });

  it('faz replay por intervalo de datas', async () => {
    mockSession({ id: 'u1', contaId: 'c1', role: 'ADMIN' });

    vi.mocked(replayWebhooksByDateRange).mockResolvedValueOnce({
      success: true,
      total: 1,
      replayed: 1,
      skipped: 0,
      failed: 0,
      hasMore: false,
      details: [],
    } as never);

    const res = await POST(
      makePostReq({
        from: '2025-01-01T00:00:00.000Z',
        to: '2025-01-31T23:59:59.999Z',
        limit: 50,
        offset: 0,
        status: 'PROCESSADO',
        category: 'PAYMENT',
      })
    );

    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toMatchObject({ ok: true, result: { success: true, total: 1, replayed: 1 } });
    expect(replayWebhooksByDateRange).toHaveBeenCalledWith({
      contaId: 'c1',
      from: new Date('2025-01-01T00:00:00.000Z'),
      to: new Date('2025-01-31T23:59:59.999Z'),
      limit: 50,
      offset: 0,
      status: 'PROCESSADO',
      category: 'PAYMENT',
    });
  });
});
