import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/finance/transfers/[transferId]/cancel/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', () => ({
  cancelTransfer: vi.fn(async () => ({
    success: true,
    data: {
      transferId: 'tr_1',
      asaasTransferId: 'asaas_tr_1',
      externalReference: 'transfer:tr_1',
      status: 'CANCELED',
      statusUpdatedAt: '2026-03-24T12:00:00.000Z',
    },
  })),
}));

describe('POST /api/finance/transfers/[transferId]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 se não autenticado', async () => {
    const { getServerSession } = await import('next-auth');
    vi.mocked(getServerSession).mockResolvedValue(null);

    const response = await POST(
      new NextRequest('http://localhost:3000/api/finance/transfers/tr_1/cancel', { method: 'POST' }),
      { params: { transferId: 'tr_1' } },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'NAO_AUTENTICADO' });
  });

  it('retorna 409 quando a transferência não é cancelável', async () => {
    const { getServerSession } = await import('next-auth');
    const { cancelTransfer } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'ADMIN' },
    } as never);

    vi.mocked(cancelTransfer).mockResolvedValueOnce({
      success: false,
      error: 'TRANSFER_NAO_CANCELAVEL',
    });

    const response = await POST(
      new NextRequest('http://localhost:3000/api/finance/transfers/tr_1/cancel', { method: 'POST' }),
      { params: { transferId: 'tr_1' } },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'TRANSFER_NAO_CANCELAVEL' });
  });

  it('cancela a transferência e retorna o payload', async () => {
    const { getServerSession } = await import('next-auth');
    const { cancelTransfer } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'FINANCEIRO' },
    } as never);

    const response = await POST(
      new NextRequest('http://localhost:3000/api/finance/transfers/tr_1/cancel', { method: 'POST' }),
      { params: { transferId: 'tr_1' } },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.status).toBe('CANCELED');
    expect(cancelTransfer).toHaveBeenCalledWith({
      contaId: 'c1',
      transferId: 'tr_1',
      actor: { type: 'USER', id: 'u1' },
    });
  });
});