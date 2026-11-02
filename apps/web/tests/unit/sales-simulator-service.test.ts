import { afterEach, describe, expect, it, vi } from 'vitest';

import { simulateVenda } from '@/features/finance/operations/sales-simulator/services/simulate-sale';

describe('simulateVenda error responses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves gate codes returned in the code field for actionable UI messaging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ code: 'KYC_REQUIRED', financialAccount: { status: 'PENDING_ACTIVATION' } }),
      }),
    );

    await expect(simulateVenda({ value: 300, installmentCount: 1 })).rejects.toThrow('KYC_REQUIRED');
  });

  it('keeps the established error field and falls back for untrusted values', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: '<script>alert(1)</script>', code: 'FINANCIAL_ACCOUNT_UNAVAILABLE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(simulateVenda({ value: 300, installmentCount: 1 })).rejects.toThrow('FINANCIAL_ACCOUNT_UNAVAILABLE');

    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'ERRO_ASAAS' }) });
    await expect(simulateVenda({ value: 300, installmentCount: 1 })).rejects.toThrow('ERRO_ASAAS');
  });
});
