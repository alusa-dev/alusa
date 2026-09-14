import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '../route';

const mocks = vi.hoisted(() => ({
  verifyMobileAccessToken: vi.fn(),
  assertMobileBillingActor: vi.fn(),
  createMobileStandaloneCharge: vi.fn(),
  guardFinancialAccountOr412: vi.fn(),
  assertPlatformAccessForConta: vi.fn(),
  platformBillingAccessResponse: vi.fn(),
}));

vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken: mocks.verifyMobileAccessToken }));
vi.mock('@/lib/rate-limit', () => ({
  ipFromRequest: vi.fn(() => '127.0.0.1'),
  rateLimit: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/features/billing/server/mobile-billing.service', () => ({
  assertMobileBillingActor: mocks.assertMobileBillingActor,
  createMobileStandaloneCharge: mocks.createMobileStandaloneCharge,
  MobileBillingUnauthorizedError: class MobileBillingUnauthorizedError extends Error {},
}));
vi.mock('@/lib/finance/financial-account-gate', () => ({ guardFinancialAccountOr412: mocks.guardFinancialAccountOr412 }));
vi.mock('@/src/server/platform-billing/capacity', () => ({
  assertPlatformAccessForConta: mocks.assertPlatformAccessForConta,
  platformBillingAccessResponse: mocks.platformBillingAccessResponse,
}));

function request(body: unknown, token = 'access-token') {
  return new NextRequest('http://localhost:3000/api/mobile/billing/charges/standalone', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  payer: { type: 'responsavel', responsavelId: 'responsavel-1' },
  chargeType: 'ONE_TIME',
  billingType: 'PIX',
  value: 65,
  dueDate: '2099-09-05',
  description: 'Mensalidade de setembro',
  uiRequestId: 'mobile-request-1',
};

describe('POST /api/mobile/billing/charges/standalone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyMobileAccessToken.mockResolvedValue({ userId: 'user-1', contaId: 'conta-1' });
    mocks.assertMobileBillingActor.mockResolvedValue(undefined);
    mocks.assertPlatformAccessForConta.mockResolvedValue(undefined);
    mocks.platformBillingAccessResponse.mockReturnValue(null);
    mocks.guardFinancialAccountOr412.mockResolvedValue({ ok: true, summary: {} });
    mocks.createMobileStandaloneCharge.mockResolvedValue({
      success: true,
      data: { chargeId: 'charge-1', status: 'PENDING', externalReference: 'standalone:charge-1' },
    });
  });

  it('recusa a criação sem token mobile válido', async () => {
    mocks.verifyMobileAccessToken.mockResolvedValue(null);

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    expect(mocks.createMobileStandaloneCharge).not.toHaveBeenCalled();
  });

  it('valida o payload antes de chamar o caso de uso', async () => {
    const response = await POST(request({ ...validBody, value: 0 }));

    expect(response.status).toBe(422);
    expect(mocks.createMobileStandaloneCharge).not.toHaveBeenCalled();
  });

  it('cria a cobrança com o ator e o pagador tenant-scoped', async () => {
    const response = await POST(request(validBody));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({ success: true, data: { chargeId: 'charge-1' } });
    expect(mocks.assertMobileBillingActor).toHaveBeenCalledWith({ userId: 'user-1', contaId: 'conta-1' });
    expect(mocks.createMobileStandaloneCharge).toHaveBeenCalledWith({
      actor: { userId: 'user-1', contaId: 'conta-1' },
      charge: validBody,
    });
  });
});
