import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { AsaasPayment } from '@alusa/finance';

import { GET } from '@/app/api/financeiro/extrato/[paymentId]/comprovante/route';

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: vi.fn(),
}));

vi.mock('@/lib/finance/financial-account-gate', () => ({
  guardFinancialAccountOr412: vi.fn(async () => ({ ok: true, summary: {} })),
}));

vi.mock('@alusa/finance', () => ({
  getPayment: vi.fn(),
  recordAsaasReadIntent: vi.fn(),
}));

async function mockSession(user: Record<string, string> | null) {
  const mod = await import('@/lib/safe-server-session');
  vi.mocked(mod.safeGetServerSession).mockResolvedValue(user ? ({ user } as { user: Record<string, string> }) : null);
}

function buildPayment(overrides: Partial<AsaasPayment>): AsaasPayment {
  return {
    object: 'payment',
    id: 'pay_default',
    dateCreated: '2026-03-30',
    customer: 'cus_123',
    value: 100,
    netValue: 100,
    billingType: 'PIX',
    status: 'PENDING',
    dueDate: '2026-03-30',
    originalDueDate: '2026-03-30',
    deleted: false,
    ...overrides,
  };
}

describe('GET /api/financeiro/extrato/[paymentId]/comprovante', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deve retornar 401 se não autenticado', async () => {
    await mockSession(null);

    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato/pay_123/comprovante');
    const res = await GET(req, { params: Promise.resolve({ paymentId: 'pay_123' }) });

    expect(res.status).toBe(401);
  });

  it('deve redirecionar para transactionReceiptUrl quando disponível', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'ADMIN' });

    const { getPayment, recordAsaasReadIntent } = await import('@alusa/finance');
    vi.mocked(getPayment).mockResolvedValue(buildPayment({
      id: 'pay_123',
      transactionReceiptUrl: 'https://asaas.test/receipt/pay_123',
      invoiceUrl: 'https://asaas.test/invoice/pay_123',
    }));

    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato/pay_123/comprovante');
    const res = await GET(req, { params: Promise.resolve({ paymentId: 'pay_123' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://asaas.test/receipt/pay_123');
    expect(getPayment).toHaveBeenCalledWith('pay_123', { contaId: 't1' });
    expect(recordAsaasReadIntent).toHaveBeenCalledWith('AUTHORITATIVE_DOCUMENT');
  });

  it('deve usar invoiceUrl como fallback', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'FINANCEIRO' });

    const { getPayment } = await import('@alusa/finance');
    vi.mocked(getPayment).mockResolvedValue(buildPayment({
      id: 'pay_456',
      transactionReceiptUrl: null,
      invoiceUrl: 'https://asaas.test/invoice/pay_456',
    }));

    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato/pay_456/comprovante');
    const res = await GET(req, { params: Promise.resolve({ paymentId: 'pay_456' }) });

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://asaas.test/invoice/pay_456');
  });

  it('deve retornar 404 quando Asaas não expõe link', async () => {
    await mockSession({ id: 'u1', contaId: 't1', role: 'ADMIN' });

    const { getPayment } = await import('@alusa/finance');
    vi.mocked(getPayment).mockResolvedValue(buildPayment({
      id: 'pay_789',
      transactionReceiptUrl: null,
      invoiceUrl: null,
    }));

    const req = new NextRequest('http://localhost:3000/api/financeiro/extrato/pay_789/comprovante');
    const res = await GET(req, { params: Promise.resolve({ paymentId: 'pay_789' }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('COMPROVANTE_NAO_DISPONIVEL');
  });
});
