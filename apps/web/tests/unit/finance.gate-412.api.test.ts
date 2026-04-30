import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/finance/charges/route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getKycSummary: vi.fn(),
  createCharge: vi.fn(),
}));

describe('Finance gate (412)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 412 e não chama use-case quando não conectado', async () => {
    const { getServerSession } = await import('next-auth');
    const { getKycSummary, createCharge } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'u1', contaId: 'c1', role: 'FINANCEIRO' },
    } as never);

    vi.mocked(getKycSummary).mockResolvedValueOnce({
      onboarding: {} as never,
      asaasConnection: { status: 'NOT_CONNECTED', reasonCode: 'MISSING_CREDENTIALS' },
      myAccountStatus: null,
      documents: null,
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/charges', {
      method: 'POST',
      body: JSON.stringify({ cobrancaId: 'c1' }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(412);
    expect(json).toMatchObject({
      code: 'FINANCIAL_ACCOUNT_NOT_READY',
      financialAccount: { status: 'PENDING_ACTIVATION' },
    });

    expect(createCharge).not.toHaveBeenCalled();
  });
});
