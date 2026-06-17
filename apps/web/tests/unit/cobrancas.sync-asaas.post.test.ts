import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());
const mockResolveCobrancaPaymentLookup = vi.hoisted(() => vi.fn());
const mockSyncPaymentStateFromAsaas = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({
  getServerSession: () => mockGetServerSession(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: mockRateLimit,
}));

vi.mock('@/src/server/finance/resolve-cobranca-payment-lookup', () => ({
  resolveCobrancaPaymentLookup: mockResolveCobrancaPaymentLookup,
}));

vi.mock('@alusa/finance', () => ({
  syncPaymentStateFromAsaas: mockSyncPaymentStateFromAsaas,
}));

import { POST } from '@/app/api/cobrancas/[id]/sync-asaas/route';

describe('POST /api/cobrancas/[id]/sync-asaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mockResolveCobrancaPaymentLookup.mockResolvedValue({ asaasPaymentId: 'pay_1' });
    mockSyncPaymentStateFromAsaas.mockResolvedValue({
      success: true,
      asaasPaymentId: 'pay_1',
      paymentStatus: 'RECEIVED',
      appliedEvent: 'PAYMENT_RECEIVED',
      invoiceUrl: null,
      bankSlipUrl: null,
      transactionReceiptUrl: null,
    });
  });

  function request() {
    return new NextRequest('http://localhost/api/cobrancas/cob-1/sync-asaas', {
      method: 'POST',
    });
  }

  it('retorna sucesso skipped quando a cobrança está em throttle', async () => {
    mockRateLimit
      .mockResolvedValueOnce({ ok: true, remaining: 29, resetAt: 1 })
      .mockResolvedValueOnce({ ok: true, remaining: 14, resetAt: 1 })
      .mockResolvedValueOnce({ ok: false, remaining: 0, resetAt: 123 });

    const response = await POST(request(), { params: Promise.resolve({ id: 'cob-1' }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      skipped: true,
      reason: 'CHARGE_THROTTLED',
    });
    expect(mockResolveCobrancaPaymentLookup).not.toHaveBeenCalled();
    expect(mockSyncPaymentStateFromAsaas).not.toHaveBeenCalled();
  });

  it('marca sync originado pela UI com intent propria', async () => {
    mockRateLimit.mockResolvedValue({ ok: true, remaining: 10, resetAt: 1 });

    const response = await POST(request(), { params: Promise.resolve({ id: 'cob-1' }) });

    expect(response.status).toBe(200);
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
      intent: 'UI_FALLBACK_SYNC',
    });
  });
});
