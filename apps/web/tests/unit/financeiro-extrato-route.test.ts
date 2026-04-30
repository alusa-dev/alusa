import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { GET } from '@/app/api/financeiro/extrato/route';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true, summary: {} })),
}));

vi.mock('@alusa/finance', async () => {
  const { z: zod } = await import('zod');
  return {
    getExtrato: vi.fn(),
    extratoQueryInputSchema: zod.object({
      startDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: zod.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      type: zod.preprocess(
        (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
        zod.array(zod.enum(['RECEITA', 'TAXA', 'ESTORNO', 'TRANSFERENCIA', 'ANTECIPACAO', 'AJUSTE'])).optional(),
      ),
      status: zod.preprocess(
        (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
        zod.array(zod.enum(['CONFIRMADO', 'CANCELADO'])).optional(),
      ),
      search: zod.string().optional(),
      page: zod.coerce.number().int().min(1).default(1),
      pageSize: zod.coerce.number().int().min(1).max(100).default(20),
      sort: zod.enum(['date', 'grossValue', 'type']).default('date'),
      direction: zod.enum(['asc', 'desc']).default('desc'),
    }),
  };
});

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(
    user ? ({ user } as any) : null,
  );
}

const EMPTY_RESPONSE = {
  summary: { receitas: 0, despesas: 0, estornos: 0, liquido: 0 },
  filters: { startDate: '2025-01-01', endDate: '2025-01-31' },
  transactions: [],
  pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1, hasNextPage: false },
  sync: {
    provider: 'ASAAS',
    fetchedAt: '2026-03-11T00:00:00.000Z',
    officialTotalCount: 0,
    fetchedCount: 0,
    truncated: false,
    maxWindowPages: 50,
  },
};

describe('GET /api/financeiro/extrato', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    await mockSession(null);
    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('deve retornar 403 se sem permissão', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'USER' });
    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('deve retornar extrato com novo contrato', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'ADMIN' });

    const { getExtrato } = await import('@alusa/finance');
    vi.mocked(getExtrato).mockResolvedValue({
      success: true,
      data: {
        summary: { receitas: 100, despesas: 0, estornos: 0, liquido: 100 },
        filters: { startDate: '2025-03-01', endDate: '2025-03-31' },
        transactions: [
          {
            id: 'ft_1',
            date: '2025-03-01',
            description: 'Pagamento',
            type: 'RECEITA',
            status: 'CONFIRMADO',
            grossValue: 100,
            fee: 3.49,
            netValue: 96.51,
            balanceAfter: 500,
            source: 'ASAAS',
          },
        ],
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, hasNextPage: false },
        sync: {
          provider: 'ASAAS',
          fetchedAt: '2026-03-11T00:00:00.000Z',
          officialTotalCount: 1,
          fetchedCount: 1,
          truncated: false,
          maxWindowPages: 50,
        },
      },
    } as any);

    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].type).toBe('RECEITA');
    expect(body.summary.receitas).toBe(100);
    expect(body.pagination.totalPages).toBe(1);
  });

  it('deve repassar filtros ao getExtrato', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'FINANCEIRO' });

    const { getExtrato } = await import('@alusa/finance');
    vi.mocked(getExtrato).mockResolvedValue({
      success: true,
      data: EMPTY_RESPONSE,
    } as any);

    const req = new NextRequest(
      'http://localhost:3000/api/financeiro/extrato?startDate=2025-01-01&endDate=2025-01-31&direction=asc&pageSize=50&page=2&type=RECEITA&search=teste',
    );
    await GET(req);

    expect(getExtrato).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 't1',
        query: expect.objectContaining({
          startDate: '2025-01-01',
          endDate: '2025-01-31',
          direction: 'asc',
          pageSize: 50,
          page: 2,
          type: ['RECEITA'],
          search: 'teste',
        }),
      }),
    );
  });

  it('deve retornar 503 se credenciais não configuradas', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'ADMIN' });

    const { getExtrato } = await import('@alusa/finance');
    vi.mocked(getExtrato).mockResolvedValue({
      success: false,
      error: 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS',
    } as any);

    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
  });
});
