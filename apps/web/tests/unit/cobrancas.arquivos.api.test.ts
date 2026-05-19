/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockTx, mockCtx } = vi.hoisted(() => {
  const tx = {
    cobranca: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
    arquivoCobranca: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    arquivoCharge: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  };
  return {
    mockTx: tx,
    mockCtx: {
      contaId: 'conta-1',
      userId: 'user-1',
      tx,
    },
  };
});

vi.mock('@/lib/api/with-tenant-session', () => ({
  withTenantSession: vi.fn(async (handler: (ctx: typeof mockCtx) => unknown) => handler(mockCtx)),
}));

vi.mock('@/lib/api/report-api-error', () => ({
  apiErrorResponse: vi.fn((_error, ctx: { fallbackMessage: string }) =>
    NextResponse.json({ error: ctx.fallbackMessage }, { status: 500 }),
  ),
  reportApiError: vi.fn(),
}));

import { GET, DELETE } from '@/app/api/cobrancas/[id]/arquivos/route';

describe('GET /api/cobrancas/[id]/arquivos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista arquivos de charge avulsa (ch_*) com 200', async () => {
    mockTx.cobranca.findFirst.mockResolvedValueOnce(null);
    mockTx.charge.findFirst.mockResolvedValueOnce({ id: 'ch_test' });
    mockTx.arquivoCharge.findMany.mockResolvedValueOnce([]);

    const res = await GET(new NextRequest('http://localhost/api/cobrancas/ch_test/arquivos'), {
      params: Promise.resolve({ id: 'ch_test' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.arquivos).toEqual([]);
    expect(mockTx.arquivoCharge.findMany).toHaveBeenCalledWith({
      where: { chargeId: 'ch_test' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('retorna 404 quando cobrança não pertence ao tenant', async () => {
    mockTx.cobranca.findFirst.mockResolvedValueOnce(null);
    mockTx.charge.findFirst.mockResolvedValueOnce(null);

    const res = await GET(new NextRequest('http://localhost/api/cobrancas/ch_missing/arquivos'), {
      params: { id: 'ch_missing' },
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/cobrancas/[id]/arquivos', () => {
  it('retorna 400 sem arquivoId', async () => {
    const res = await DELETE(
      new NextRequest('http://localhost/api/cobrancas/ch_test/arquivos'),
      { params: { id: 'ch_test' } },
    );
    expect(res.status).toBe(400);
  });
});
