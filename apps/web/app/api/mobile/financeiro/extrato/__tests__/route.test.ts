import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route';

const mocks = vi.hoisted(() => ({
  verifyMobileAccessToken: vi.fn(),
  guardFinancialAccountOr412: vi.fn(),
  getMobileStatement: vi.fn(),
}));

vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken: mocks.verifyMobileAccessToken }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/lib/finance/financial-account-gate', () => ({ guardFinancialAccountOr412: mocks.guardFinancialAccountOr412 }));
vi.mock('@/features/financeiro/server/mobile-extrato.service', () => ({
  getMobileStatement: mocks.getMobileStatement,
  MobileStatementUnauthorizedError: class MobileStatementUnauthorizedError extends Error {},
}));

function request(query = '') {
  return new NextRequest(`http://localhost:3000/api/mobile/financeiro/extrato${query}`,
    { headers: { authorization: 'Bearer access-token' } });
}

describe('GET /api/mobile/financeiro/extrato', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });
    mocks.guardFinancialAccountOr412.mockResolvedValue({ ok: true, summary: {} });
    mocks.getMobileStatement.mockResolvedValue({
      summary: { available: 10, awaitingPayment: 20, awaitingSettlement: 30 },
      transactions: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1, hasNextPage: false },
      sync: { fetchedAt: '2026-09-11T12:00:00.000Z', truncated: false },
    });
  });

  it('recusa a consulta sem token mobile válido', async () => {
    mocks.verifyMobileAccessToken.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.getMobileStatement).not.toHaveBeenCalled();
  });

  it('valida filtros e mantém conta e ator derivados do token', async () => {
    const response = await GET(request('?period=last-30-days&direction=asc&page=2&pageSize=10'));

    expect(response.status).toBe(200);
    expect(mocks.getMobileStatement).toHaveBeenCalledWith({
      actor: { userId: 'user-1', contaId: 'conta-1' },
      period: 'LAST_30_DAYS',
      direction: 'asc',
      page: 2,
      pageSize: 10,
    });
  });

  it('rejeita filtros inválidos antes de consultar dados financeiros', async () => {
    const response = await GET(request('?direction=sideways'));

    expect(response.status).toBe(400);
    expect(mocks.getMobileStatement).not.toHaveBeenCalled();
  });
});
