/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

vi.mock('@/src/prisma', () => ({
  prisma: {
    cobranca: {
      findFirst: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
    },
    logFinanceiro: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => ({
  KycNotApprovedError: class KycNotApprovedError extends Error {},
  isAsaasEnabled: vi.fn(() => true),
  readPaymentStatusPreflight: vi.fn(async () => ({ status: 'RECEIVED_IN_CASH' })),
  undoCashPayment: vi.fn(async () => undefined),
  syncPaymentStateFromAsaas: vi.fn(async () => undefined),
  auditLogService: { record: vi.fn(async () => undefined) },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/src/prisma';
import { syncPaymentStateFromAsaas } from '@alusa/finance';
import { POST } from '@/app/api/cobrancas/[id]/undo-receive-in-cash/route';

const buildPostRequest = (url: string): NextRequest =>
  new Request(url, {
    method: 'POST',
  }) as unknown as NextRequest;

describe('POST /api/cobrancas/[id]/undo-receive-in-cash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aceita desfazer recebimento para cobrança standalone (Charge) e dispara sync pós-comando', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-1',
      status: 'PAID',
      asaasPaymentId: 'pay_1',
    } as never);

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/chg-1/undo-receive-in-cash'), {
      params: Promise.resolve({ id: 'chg-1' }),
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, pending: true });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledTimes(1);
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_1',
      eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    });
  });
});
