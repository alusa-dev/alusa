import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { sharedTelemetry, type TelemetryMetric } from '@alusa/observability';

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());
const mockResolveCobrancaPaymentLookupForTenant = vi.hoisted(() => vi.fn());
const mockSyncPaymentStateFromAsaas = vi.hoisted(() => vi.fn());
const mockInvalidateChargeResourceCache = vi.hoisted(() => vi.fn());

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

vi.mock('@/lib/cache/invalidation', () => ({
  invalidateChargeResourceCache: mockInvalidateChargeResourceCache,
}));

vi.mock('@/src/server/finance/resolve-charge-payment-lookup', () => ({
  resolveCobrancaPaymentLookupForTenant: mockResolveCobrancaPaymentLookupForTenant,
}));

vi.mock('@alusa/finance', () => ({
  syncPaymentStateFromAsaas: mockSyncPaymentStateFromAsaas,
}));

import { POST } from '@/app/api/cobrancas/[id]/sync-asaas/route';

let restoreTelemetry: (() => void) | null = null;
let capturedMetrics: TelemetryMetric[] = [];

function captureTelemetry() {
  capturedMetrics = [];
  restoreTelemetry?.();
  restoreTelemetry = sharedTelemetry.replaceSink({ metric: (record) => capturedMetrics.push(record) });
}

describe('POST /api/cobrancas/[id]/sync-asaas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', contaId: 'conta-1', role: 'FINANCEIRO' },
    });
    mockResolveCobrancaPaymentLookupForTenant.mockResolvedValue({ asaasPaymentId: 'pay_1' });
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

  afterEach(() => {
    restoreTelemetry?.();
    restoreTelemetry = null;
    vi.unstubAllEnvs();
  });

  function request(source?: string) {
    return new NextRequest('http://localhost/api/cobrancas/cob-1/sync-asaas', {
      method: 'POST',
      headers: source ? { 'x-alusa-sync-source': source } : undefined,
    });
  }

  function enableTelemetryCapture() {
    vi.stubEnv('OBSERVABILITY_METRIC_SAMPLE_RATE', '1');
    captureTelemetry();
  }

  it('retorna sucesso skipped quando a cobrança está em throttle', async () => {
    enableTelemetryCapture();
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
    expect(mockResolveCobrancaPaymentLookupForTenant).not.toHaveBeenCalled();
    expect(mockSyncPaymentStateFromAsaas).not.toHaveBeenCalled();
    expect(mockInvalidateChargeResourceCache).not.toHaveBeenCalled();
  });

  it('marca sync originado pela UI com intent propria', async () => {
    enableTelemetryCapture();
    mockRateLimit.mockResolvedValue({ ok: true, remaining: 10, resetAt: 1 });

    const response = await POST(request('automatic_fallback'), { params: Promise.resolve({ id: 'cob-1' }) });

    expect(response.status).toBe(200);
    expect(mockRateLimit.mock.calls.map(([key]) => key)).toEqual([
      'finance-ui-sync:tenant:conta-1',
      'finance-ui-sync:user:conta-1:user-1',
      'finance-ui-sync:charge:conta-1:cob-1',
    ]);
    expect(mockRateLimit).toHaveBeenCalledTimes(3);
    expect(mockResolveCobrancaPaymentLookupForTenant).toHaveBeenCalledWith('conta-1', 'cob-1');
    expect(mockSyncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
      intent: 'UI_FALLBACK_SYNC',
    });
    expect(mockInvalidateChargeResourceCache).toHaveBeenCalledWith({
      contaId: 'conta-1',
      cobrancaId: 'cob-1',
      reason: 'charge-sync-asaas',
    });
  });

  it('não invalida caches quando o sync não conclui com sucesso', async () => {
    mockRateLimit.mockResolvedValue({ ok: true, remaining: 10, resetAt: 1 });
    mockSyncPaymentStateFromAsaas.mockResolvedValue({ success: false, error: 'provider unavailable' });

    const response = await POST(request(), { params: Promise.resolve({ id: 'cob-1' }) });

    expect(response.status).toBe(502);
    expect(mockInvalidateChargeResourceCache).not.toHaveBeenCalled();
  });
});
