import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alusa/finance')>();

  return {
    ...actual,
    listTransfers: vi.fn(async () => ({ items: [], total: 0 })),
  };
});

describe('GET /api/finance/transfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('NAO_AUTENTICADO');
  });

  it('deve retornar 403 se sem permissão', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'USER' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/transfers');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('SEM_PERMISSAO');
  });

  it('deve retornar lista', async () => {
    const { getServerSession } = await import('next-auth');
    const { listTransfers } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'ADMIN' },
    } as never);

    vi.mocked(listTransfers).mockResolvedValueOnce({
      items: [
        {
          id: 'tr1',
          externalReference: 'transfer:tr1',
          asaasTransferId: 'asaas_tr_1',
          value: 10,
          feeValue: 2,
          netValue: 10,
          status: 'PENDING',
          operation: 'PIX',
          recipientName: 'Elaine Costa',
          cpfCnpjMasked: null,
          bankName: 'Pix',
          scheduleDate: null,
          transferDate: new Date().toISOString(),
          description: 'Repasse',
          statusUpdatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    const request = new NextRequest('http://localhost:3000/api/finance/transfers?page=1&pageSize=10');
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.total).toBe(1);
    expect(listTransfers).toHaveBeenCalledWith({
      contaId: 't1',
      limit: 10,
      offset: 0,
      status: undefined,
      search: undefined,
      operation: undefined,
      from: undefined,
      to: undefined,
      direction: 'desc',
    });
  });
});
