import { beforeEach, describe, expect, it, vi } from 'vitest';

const { contextMock, getSaleMock, refundMock } = vi.hoisted(() => ({
  contextMock: vi.fn(),
  getSaleMock: vi.fn(),
  refundMock: vi.fn(),
}));

vi.mock('../../../../../_helpers', () => ({
  getStoreRequestContext: contextMock,
  jsonError: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status }),
}));
vi.mock('@alusa/finance', () => ({
  getStoreSaleById: getSaleMock,
  StoreSaleRefundError: class StoreSaleRefundError extends Error {
    constructor(readonly code: string, message: string, readonly status = 409) { super(message); }
  },
}));
vi.mock('@/src/server/sales/store-sale-refund.service', () => ({ requestStoreSaleRefundFromApp: refundMock }));

import { POST } from '../route';

function makeRequest(body: unknown = { mode: 'REQUEST' }) {
  return new Request('http://localhost/api/vendas/sale-a/returns/return-a/refund', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST sale return refund authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contextMock.mockResolvedValue({ contaId: 'tenant-a', operatorId: 'user-a', role: 'ADMIN' });
    refundMock.mockResolvedValue({ status: 'IN_PROGRESS', pending: true });
    getSaleMock.mockResolvedValue({ id: 'sale-a' });
  });

  it('rejects a non-financial role before any refund action', async () => {
    contextMock.mockResolvedValue({ contaId: 'tenant-a', operatorId: 'user-a', role: 'OPERADOR' });

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'sale-a', returnId: 'return-a' }) });

    expect(response.status).toBe(403);
    expect(refundMock).not.toHaveBeenCalled();
    expect(getSaleMock).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'FINANCEIRO'])('allows %s to dispatch a requested refund', async (role) => {
    contextMock.mockResolvedValue({ contaId: 'tenant-a', operatorId: 'user-a', role });

    const response = await POST(makeRequest(), { params: Promise.resolve({ id: 'sale-a', returnId: 'return-a' }) });

    expect(response.status).toBe(200);
    expect(refundMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role, mode: 'REQUEST',
    }));
  });
});
