import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyMobileAccessToken: vi.fn(),
  assertMobileBillingActor: vi.fn(),
  simulatePaymentFees: vi.fn(),
}));

vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken: mocks.verifyMobileAccessToken }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/features/billing/server/mobile-billing.service', () => ({
  assertMobileBillingActor: mocks.assertMobileBillingActor,
  MobileBillingUnauthorizedError: class MobileBillingUnauthorizedError extends Error {},
}));
vi.mock('@alusa/finance', () => ({
  paymentSimulationInputDTOSchema: {
    parse: (value: { value: unknown; installmentCount: unknown; passFees?: unknown }) => ({
      value: Number(value.value),
      installmentCount: Number(value.installmentCount),
      passFees: Boolean(value.passFees),
    }),
  },
  simulatePaymentFees: mocks.simulatePaymentFees,
}));

import { POST } from '../route';

function request(body: unknown, token = 'access-token') {
  return new NextRequest('http://localhost:3000/api/mobile/billing/simulate', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mobile/billing/simulate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });
    mocks.assertMobileBillingActor.mockResolvedValue(undefined);
    mocks.simulatePaymentFees.mockResolvedValue({
      success: true,
      data: {
        requestedValue: 300,
        chargeValue: 309.73,
        installmentCount: 1,
        netValue: 300,
        installmentValue: 309.73,
        installmentNetValue: 300,
        feeValue: 9.73,
        feePercentage: 2.99,
        operationFee: 0.49,
      },
    });
  });

  it('recusa a simulação sem token mobile válido', async () => {
    mocks.verifyMobileAccessToken.mockResolvedValue(null);

    const response = await POST(request({ value: 300, installmentCount: 1 }));

    expect(response.status).toBe(401);
    expect(mocks.simulatePaymentFees).not.toHaveBeenCalled();
  });

  it('usa a conta da sessão e preserva a escolha de repasse', async () => {
    const response = await POST(request({ value: 300, installmentCount: 1, passFees: true }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ data: { chargeValue: 309.73, netValue: 300 } });
    expect(mocks.assertMobileBillingActor).toHaveBeenCalledWith({ userId: 'user-1', contaId: 'conta-1' });
    expect(mocks.simulatePaymentFees).toHaveBeenCalledWith({
      contaId: 'conta-1',
      input: { value: 300, installmentCount: 1, passFees: true },
    });
  });
});
