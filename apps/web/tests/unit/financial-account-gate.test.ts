import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getKycSummary: vi.fn(),
  getKycSummaryFresh: vi.fn(),
  requireKycSnapshotApproved: vi.fn(),
  contaFindUnique: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getKycSummary: mocks.getKycSummary,
  getKycSummaryFresh: mocks.getKycSummaryFresh,
  requireKycSnapshotApproved: mocks.requireKycSnapshotApproved,
}));

vi.mock('@alusa/database', () => ({
  prisma: { conta: { findUnique: mocks.contaFindUnique } },
}));

import { guardFinancialAccountOr412 } from '@/lib/finance/financial-account-gate';

describe('guardFinancialAccountOr412 KYC read failures', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.PAYMENTS_PROVIDER_MODE;
  });

  it('returns a clear 503 when the Asaas subaccount rejects the server IP', async () => {
    process.env.PAYMENTS_PROVIDER_MODE = 'asaas';
    const providerError = Object.assign(new Error('Forbidden'), {
      name: 'AsaasHttpError',
      status: 403,
      response: { errors: [{ code: 'not_allowed_ip' }] },
    });
    mocks.getKycSummary.mockRejectedValueOnce(providerError);

    const result = await guardFinancialAccountOr412('tenant-ip-denied');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a denied financial account gate.');
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toMatchObject({
      code: 'FINANCIAL_ACCOUNT_IP_NOT_ALLOWED',
      message: expect.stringContaining('liberação de IP'),
      financialAccount: { status: 'UNAVAILABLE' },
    });
    expect(mocks.getKycSummaryFresh).not.toHaveBeenCalled();
  });

  it('fails closed with a retryable response when the KYC read is unavailable', async () => {
    process.env.PAYMENTS_PROVIDER_MODE = 'asaas';
    mocks.getKycSummary.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await guardFinancialAccountOr412('tenant-kyc-unavailable');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a denied financial account gate.');
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toMatchObject({
      code: 'FINANCIAL_ACCOUNT_VERIFICATION_UNAVAILABLE',
      message: expect.stringContaining('Tente novamente'),
      financialAccount: { status: 'UNAVAILABLE' },
    });
    expect(mocks.getKycSummaryFresh).not.toHaveBeenCalled();
  });
});
