/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@alusa/finance', () => ({
  getAsaasWebhookOperationalStatus: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getAsaasWebhookOperationalStatus } from '@alusa/finance';
import { GET } from '@/app/api/admin/webhooks/status/route';

describe('GET /api/admin/webhooks/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET_TOKEN = 'cron-secret';
    vi.mocked(getAsaasWebhookOperationalStatus).mockResolvedValue({
      contaId: 'conta-1',
      pending: 1,
      processing: 0,
      errored: 0,
      exhausted: 0,
      processedLast24h: 10,
      oldestPendingAt: null,
      lagSeconds: null,
      highRetryBacklog: 0,
      stuckProcessing: 0,
      rejectionCountLast1h: 0,
      rejectionCountLast24h: 0,
      rejectionsByReason: [],
    } as never);
  });

  it('filtra por conta do admin tenant', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);

    const res = await GET(new NextRequest('http://localhost/api/admin/webhooks/status'));

    expect(res.status).toBe(200);
    expect(getAsaasWebhookOperationalStatus).toHaveBeenCalledWith({ contaId: 'conta-1' });
  });

  it('bloqueia admin tenant tentando outra conta', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);

    const res = await GET(new NextRequest('http://localhost/api/admin/webhooks/status?contaId=conta-2'));

    expect(res.status).toBe(403);
    expect(getAsaasWebhookOperationalStatus).not.toHaveBeenCalled();
  });

  it('permite visão global via cron', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await GET(
      new NextRequest('http://localhost/api/admin/webhooks/status', {
        headers: { 'x-cron-token': 'cron-secret' },
      }),
    );

    expect(res.status).toBe(200);
    expect(getAsaasWebhookOperationalStatus).toHaveBeenCalledWith({ contaId: undefined });
  });
});
