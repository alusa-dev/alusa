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
  getWebhookOperationalDiagnostics: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { getWebhookOperationalDiagnostics } from '@alusa/finance';
import { GET } from '@/app/api/admin/webhooks/diagnostics/route';

describe('GET /api/admin/webhooks/diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);

    const res = await GET(
      new NextRequest('http://localhost/api/admin/webhooks/diagnostics'),
    );

    expect(res.status).toBe(401);
  });

  it('retorna 403 quando sem permissão', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'PROFESSOR' },
    } as never);

    const res = await GET(
      new NextRequest('http://localhost/api/admin/webhooks/diagnostics'),
    );

    expect(res.status).toBe(403);
  });

  it('retorna diagnóstico consolidado para admin autenticado', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);
    vi.mocked(getWebhookOperationalDiagnostics).mockResolvedValue({
      contaId: 'c1',
      status: 'WARNING',
      recommendations: [{ code: 'WEBHOOK_QUEUE_ERRORED', severity: 'warning', message: 'Fila com erro' }],
    } as never);

    const res = await GET(
      new NextRequest('http://localhost/api/admin/webhooks/diagnostics?includeGaps=true&windowDays=14'),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        contaId: 'c1',
        status: 'WARNING',
      },
    });
    expect(getWebhookOperationalDiagnostics).toHaveBeenCalledWith({
      contaId: 'c1',
      includeGaps: true,
      windowDays: 14,
    });
  });
});
