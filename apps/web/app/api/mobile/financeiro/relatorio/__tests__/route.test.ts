import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route';

const mocks = vi.hoisted(() => ({
  verifyMobileAccessToken: vi.fn(),
  getMobileFinancialReport: vi.fn(),
}));

vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken: mocks.verifyMobileAccessToken }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/features/financeiro/server/mobile-relatorio.service', () => ({
  getMobileFinancialReport: mocks.getMobileFinancialReport,
  MobileReportUnauthorizedError: class MobileReportUnauthorizedError extends Error {},
}));

function request(query = '') {
  return new NextRequest(`http://localhost:3000/api/mobile/financeiro/relatorio${query}`, {
    headers: { authorization: 'Bearer access-token' },
  });
}

describe('GET /api/mobile/financeiro/relatorio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });
    mocks.getMobileFinancialReport.mockResolvedValue({ period: 'this-month' });
  });

  it('recusa consulta sem token mobile válido', async () => {
    mocks.verifyMobileAccessToken.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.getMobileFinancialReport).not.toHaveBeenCalled();
  });

  it('usa o período padrão e deriva conta e usuário do token', async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.getMobileFinancialReport).toHaveBeenCalledWith({
      actor: { userId: 'user-1', contaId: 'conta-1' },
      period: 'this-month',
    });
  });

  it('valida o período antes de consultar o relatório', async () => {
    const response = await GET(request('?period=invalid'));

    expect(response.status).toBe(400);
    expect(mocks.getMobileFinancialReport).not.toHaveBeenCalled();
  });
});
