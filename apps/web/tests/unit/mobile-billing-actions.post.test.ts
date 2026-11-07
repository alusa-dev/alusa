import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), rateLimit: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/mobile-auth-service', () => ({ verifyMobileAccessToken: mocks.verify }));
vi.mock('@/lib/rate-limit', () => ({ ipFromRequest: vi.fn(() => '127.0.0.1'), rateLimit: mocks.rateLimit }));
vi.mock('@/features/billing/server/mobile-billing.service', () => ({
  executeMobileBillingAction: mocks.execute,
  MobileBillingUnauthorizedError: class MobileBillingUnauthorizedError extends Error {},
}));

import { POST } from '@/app/api/mobile/billing/charges/[chargeId]/actions/route';

function request(idempotencyKey?: string) {
  return new Request('http://localhost/api/mobile/billing/charges/charge-1/actions', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
    body: JSON.stringify({ action: 'REFUND' }),
  });
}

describe('mobile billing refund idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ userId: 'user-1', contaId: 'tenant-1' });
    mocks.rateLimit.mockReturnValue({ ok: true });
    mocks.execute.mockResolvedValue({ success: true, message: 'requested' });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects a missing key before entering the financial service', async () => {
    vi.stubEnv('ASAAS_REFUND_GATEWAY_ENABLED', 'true');
    const response = await POST(request(), { params: Promise.resolve({ chargeId: 'charge-1' }) });
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('keeps legacy mobile refund transport callable when the gateway is disabled', async () => {
    vi.stubEnv('ASAAS_REFUND_GATEWAY_ENABLED', 'false');
    const response = await POST(request(), { params: Promise.resolve({ chargeId: 'charge-1' }) });
    expect(response.status).toBe(202);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ correlationId: undefined }));
  });

  it('passes the stable key as command correlation identity', async () => {
    const response = await POST(request('mobile-refund-attempt-1'), { params: Promise.resolve({ chargeId: 'charge-1' }) });
    expect(response.status).toBe(202);
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ correlationId: 'mobile-refund-attempt-1' }));
  });
});
