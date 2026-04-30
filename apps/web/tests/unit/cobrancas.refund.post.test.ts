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
  readPaymentFullPreflight: vi.fn(async () => ({ id: 'pay_1', status: 'RECEIVED', value: 120 })),
  refundCobranca: vi.fn(async () => undefined),
  syncPaymentStateFromAsaas: vi.fn(async () => undefined),
  auditLogService: { record: vi.fn(async () => undefined) },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/src/prisma';
import { readPaymentFullPreflight, refundCobranca, syncPaymentStateFromAsaas } from '@alusa/finance';
import { POST } from '@/app/api/cobrancas/[id]/refund/route';

const buildPostRequest = (url: string, body: unknown): NextRequest =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe('POST /api/cobrancas/[id]/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aceita estorno para cobrança standalone (Charge) e dispara sync pós-comando', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-1',
      status: 'PAID',
      asaasPaymentId: 'pay_1',
      value: 120,
    } as never);

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/chg-1/refund', {}), {
      params: Promise.resolve({ id: 'chg-1' }),
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, pending: true });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledTimes(1);
  });

  it('rejeita estorno quando o estado oficial é RECEIVED_IN_CASH', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
      id: 'chg-2',
      status: 'PAID',
      asaasPaymentId: 'pay_cash_1',
      value: 80,
    } as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_cash_1',
      status: 'RECEIVED_IN_CASH',
      value: 80,
    } as never);

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/chg-2/refund', {}), {
      params: Promise.resolve({ id: 'chg-2' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({
      error: 'Cobranças recebidas em dinheiro devem usar a ação de desfazer recebimento.',
      asaasStatus: 'RECEIVED_IN_CASH',
      expectedAction: 'UNDO_CASH_PAYMENT',
    });
    expect(refundCobranca).not.toHaveBeenCalled();
    expect(syncPaymentStateFromAsaas).not.toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay_cash_1',
    });
  });
});
