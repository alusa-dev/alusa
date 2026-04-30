import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET as getCobrancas } from '@/app/api/financeiro/cobrancas/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(() => ({ user: { id: 'u1', contaId: 'c1', role: 'FINANCEIRO' } })),
}));

vi.mock('@alusa/finance', () => ({
  listChargesAggregated: vi.fn(),
}));

describe('API Financeiro Cobrancas formaPagamento', () => {
  it('retorna formaPagamento a partir do billingType', async () => {
    const { listChargesAggregated } = await import('@alusa/finance');

    vi.mocked(listChargesAggregated).mockResolvedValueOnce({
      items: [
        {
          id: 'standalone-1',
          origin: 'STANDALONE',
          description: 'Cobrança Avulsa',
          payerName: 'Cliente',
          value: 120,
          dueDate: '2026-02-10T00:00:00.000Z',
          billingType: 'PIX',
          status: 'PENDING',
          liquidacaoStatus: null,
          createdAt: '2026-02-01T00:00:00.000Z',
          sourceId: 'standalone-1',
          matriculaId: null,
          alunoId: null,
          asaasPaymentId: null,
          tipo: 'AVULSA',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const req = { url: 'http://test/api/financeiro/cobrancas' } as unknown as NextRequest;
    const res = await getCobrancas(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].formaPagamento).toBe('PIX');
  });
});
