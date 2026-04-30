import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../route';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@alusa/finance', () => ({
  createStandaloneCharge: vi.fn(async () => ({
    success: true,
    data: {
      chargeId: 'ch_1',
      asaasPaymentId: 'pay_1',
      asaasSubscriptionId: undefined,
      externalReference: 'standalone:1',
      status: 'OPEN',
    },
  })),
  listStandaloneCharges: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
}));

describe('POST /api/finance/charges/standalone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('repassa notificationChannels para o caso de uso de criação', async () => {
    const { getServerSession } = await import('next-auth');
    const { createStandaloneCharge } = await import('@alusa/finance');

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'ADMIN' },
    } as never);

    const request = new NextRequest('http://localhost:3000/api/finance/charges/standalone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payer: { type: 'responsavel', responsavelId: 'resp-1' },
        chargeType: 'ONE_TIME',
        billingType: 'PIX',
        value: 150,
        dueDate: '2099-12-10',
        notificationChannels: ['EMAIL', 'SMS', 'WHATSAPP'],
        notificationChannelsConfigured: true,
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(createStandaloneCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: 'conta-1',
        notificationChannels: ['EMAIL', 'SMS', 'WHATSAPP'],
        notificationChannelsConfigured: true,
      }),
    );
  });
});
