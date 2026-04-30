import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/finance/charges/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getKycSummary: vi.fn(),
  createCharge: vi.fn(),
  listCharges: vi.fn(),
}));

describe('/api/finance/charges (POST)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 409 quando KYC não está aprovado', async () => {
    const { getServerSession } = await import('next-auth');
    const { createCharge, getKycSummary } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 't1', role: 'FINANCEIRO' },
    } as never);

    vi.mocked(getKycSummary).mockResolvedValueOnce({
      onboarding: {} as never,
      asaasConnection: { status: 'CONNECTED' },
      myAccountStatus: null,
      documents: null,
    } as never);

    vi.mocked(createCharge).mockResolvedValueOnce({ success: false, error: 'KYC_NAO_APROVADO' } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/charges', {
      method: 'POST',
      body: JSON.stringify({ cobrancaId: 'c1' }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe('KYC_NAO_APROVADO');
  });
});
