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
    $transaction: vi.fn(async (callback: (_tx: unknown) => Promise<unknown>) => callback((await import('@/src/prisma')).prisma)),
    $queryRaw: vi.fn(async () => [{ id: 'order-1' }]),
    cobranca: {
      findFirst: vi.fn(),
    },
    charge: {
      findFirst: vi.fn(),
    },
    logFinanceiro: {
      create: vi.fn(),
    },
    eventMapOrder: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    eventTicket: {
      count: vi.fn(),
    },
  },
}));

vi.mock('@/src/server/finance/resolve-charge-payment-lookup', () => ({
  loadCobrancaActionRecords: vi.fn(async () => ({ cobranca: null, charge: null })),
  recordCobrancaFinancialLog: vi.fn(),
  resolveCobrancaPaymentLookupForTenant: vi.fn(async () => ({
    entityType: 'EVENT',
    origin: 'EVENT',
    asaasPaymentId: 'pay_event_1',
    localStatus: 'PAGO',
    billingType: 'PIX',
    value: 120,
    operational: { kind: 'event-map-order', entityId: 'order-1', refundedAmount: 0 },
  })),
}));

vi.mock('@alusa/finance', () => ({
  KycNotApprovedError: class KycNotApprovedError extends Error {},
  AsaasHttpError: class AsaasHttpError extends Error {
    status = 400;
  },
  evaluatePaymentActionPolicy: vi.fn((input: { asaasStatus?: string | null }) => {
    const status = String(input.asaasStatus ?? '').toUpperCase();
      const canRefund = ['RECEIVED', 'CONFIRMED'].includes(status);
    const cash = status === 'RECEIVED_IN_CASH';
    return {
      canRefund: canRefund && !cash,
      canPartialRefund: canRefund && !cash,
      actions: {
        REFUND: canRefund && !cash
          ? { allowed: true }
          : {
              allowed: false,
              code: cash ? 'REFUND_NOT_ALLOWED_FOR_CASH_PAYMENT' : 'REFUND_NOT_ALLOWED_FOR_ASAAS_STATUS',
              reason: cash
                ? 'Cobranças recebidas em dinheiro devem usar a ação de desfazer recebimento.'
                : `Não é possível estornar cobrança com status ${status} no Asaas.`,
            },
        PARTIAL_REFUND: { allowed: canRefund && !cash },
      },
    };
  }),
  isAsaasEnabled: vi.fn(() => true),
  readPaymentFullPreflight: vi.fn(async () => ({ id: 'pay_1', status: 'RECEIVED', value: 120 })),
  normalizeAsaasPaymentSnapshotStatus: vi.fn((input: { status?: string | null; deleted?: boolean | null; billingType?: string | null }) => {
    if (input.deleted === true) return 'DELETED';
    if (
      input.billingType === 'RECEIVED_IN_CASH' &&
      ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(String(input.status ?? '').toUpperCase())
    ) {
      return 'RECEIVED_IN_CASH';
    }
    return input.status ?? null;
  }),
  expectedEventsForPaymentCommand: vi.fn(() => ['PAYMENT_REFUNDED']),
  registerPaymentCommand: vi.fn(async () => ({ id: 'job-1' })),
  markPaymentCommandSent: vi.fn(async () => undefined),
  failPaymentCommand: vi.fn(async () => undefined),
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
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValue({
      id: 'order-1', status: 'CONFIRMED', paymentStatus: 'RECEIVED',
      ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 },
    } as never);
    vi.mocked(prisma.eventMapOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.eventTicket.count)
      .mockResolvedValueOnce(1 as never) // ingressos emitidos
      .mockResolvedValueOnce(0 as never); // ingressos utilizados
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id: 'order-1' }] as never);
  });

  it('aceita estorno do pedido de evento sem check-in e dispara sync pós-comando', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });

    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/event-charge-1/refund', {}), {
      params: Promise.resolve({ id: 'event-charge-1' }),
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ success: true, pending: true });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledTimes(1);
    expect(prisma.eventMapOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'order-1', contaId: 'conta-1' }),
      data: { paymentStatus: 'REFUND_REQUESTED', refundRequestUrl: null },
    }));
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

  it('recusa pedido de ingresso em disputa mesmo quando o preflight do Asaas informa RECEIVED', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_event_1', status: 'RECEIVED', value: 120,
      chargeback: { status: 'IN_DISPUTE' },
    } as never);
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-1', status: 'CONFIRMED', paymentStatus: 'IN_DISPUTE',
      ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 },
    } as never);

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/event-charge-1/refund', {}), {
      params: Promise.resolve({ id: 'event-charge-1' }),
    });

    expect(res.status).toBe(409);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.eventTicket.count).not.toHaveBeenCalled();
    expect(prisma.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(refundCobranca).not.toHaveBeenCalled();
  });

  it('obtém o lock do pedido antes de recontar ingressos para serializar com check-in', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.eventTicket.count)
      .mockResolvedValueOnce(1 as never) // issued
      .mockResolvedValueOnce(0 as never); // used

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/event-charge-1/refund', {}), {
      params: Promise.resolve({ id: 'event-charge-1' }),
    });

    expect(res.status).toBe(202);
    const lockCall = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0];
    const ticketCountCalls = vi.mocked(prisma.eventTicket.count).mock.invocationCallOrder;
    expect(lockCall).toBeDefined();
    expect(ticketCountCalls.length).toBe(2);
    expect(lockCall).toBeLessThan(ticketCountCalls[0]);
    expect(ticketCountCalls[0]).toBeLessThan(ticketCountCalls[1]);
  });

  it('recusa estorno depois do check-in sem alterar pedido ou solicitar reembolso', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.eventTicket.count).mockReset()
      .mockResolvedValueOnce(1 as never) // ingresso emitido
      .mockResolvedValueOnce(1 as never); // check-in já consumido

    const res = await POST(buildPostRequest('http://localhost/api/cobrancas/event-charge-1/refund', {}), {
      params: Promise.resolve({ id: 'event-charge-1' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'EVENT_ORDER_REFUND_NOT_ELIGIBLE' });
    expect(prisma.eventMapOrder.updateMany).not.toHaveBeenCalled();
    expect(refundCobranca).not.toHaveBeenCalled();
    expect(syncPaymentStateFromAsaas).not.toHaveBeenCalled();
  });
});
