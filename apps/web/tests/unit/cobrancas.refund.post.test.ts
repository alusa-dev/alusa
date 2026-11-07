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

vi.mock('@/src/server/platform-billing/capacity', () => ({
  platformBillingAccessResponseForConta: vi.fn(async () => null),
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
    constructor(message: string, public status = 400) { super(message); }
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
  findActivePaymentRefundCommand: vi.fn(async () => null),
  registerPaymentCommand: vi.fn(async () => ({ id: 'job-1' })),
  requestBankSlipRefund: vi.fn(async () => ({ requestUrl: 'https://asaas.com/refund/request-1' })),
  claimPaymentCommandForDispatch: vi.fn(async () => ({ claimed: true })),
  claimPaymentRefundCommandForDispatch: vi.fn(async () => ({ claimed: true, activeCommand: null })),
  markPaymentCommandSent: vi.fn(async () => undefined),
  markPaymentCommandNeedsReconciliation: vi.fn(async () => undefined),
  failPaymentCommand: vi.fn(async () => undefined),
  refundCobranca: vi.fn(async () => undefined),
  syncPaymentStateFromAsaas: vi.fn(async () => undefined),
  auditLogService: { record: vi.fn(async () => undefined) },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/src/prisma';
import { AsaasHttpError, markPaymentCommandNeedsReconciliation, markPaymentCommandSent, readPaymentFullPreflight, refundCobranca, registerPaymentCommand, requestBankSlipRefund, syncPaymentStateFromAsaas } from '@alusa/finance';
import { resolveCobrancaPaymentLookupForTenant } from '@/src/server/finance/resolve-charge-payment-lookup';
import { POST } from '@/app/api/cobrancas/[id]/refund/route';

const buildPostRequest = (url: string, body: unknown, extraHeaders: Record<string, string> = {}): NextRequest =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
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

  it('restaura pedido de boleto quando a mesma chave do tenant conflita com outro pedido', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(resolveCobrancaPaymentLookupForTenant).mockResolvedValueOnce({
      entityType: 'EVENT', origin: 'EVENT', asaasPaymentId: 'pay_event_2', localStatus: 'PAGO',
      billingType: 'BOLETO', value: 120,
      operational: { kind: 'event-map-order', entityId: 'order-2', refundedAmount: 0 },
    } as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_event_2', status: 'RECEIVED', billingType: 'BOLETO', value: 120,
    } as never);
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-2', status: 'CONFIRMED', paymentStatus: 'RECEIVED',
      ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 },
    } as never);
    vi.mocked(prisma.eventTicket.count)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(0 as never);
    vi.mocked(registerPaymentCommand).mockRejectedValueOnce(
      new Error('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'),
    );

    const response = await POST(buildPostRequest(
      'http://localhost/api/cobrancas/event-charge-2/refund',
      {},
      { 'Idempotency-Key': 'shared-refund-key-1' },
    ), { params: Promise.resolve({ id: 'event-charge-2' }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(prisma.eventMapOrder.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'order-2', contaId: 'conta-1', paymentStatus: 'REFUND_REQUESTED' },
      data: { paymentStatus: 'RECEIVED' },
    });
    expect(registerPaymentCommand).toHaveBeenCalledTimes(1);
    expect(refundCobranca).not.toHaveBeenCalled();
  });

  it('restaura pedido de evento não boleto quando a chave do tenant pertence a outro pedido', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce(null as never);
    vi.mocked(resolveCobrancaPaymentLookupForTenant).mockResolvedValueOnce({
      entityType: 'EVENT', origin: 'EVENT', asaasPaymentId: 'pay_event_3', localStatus: 'PAGO',
      billingType: 'PIX', value: 120,
      operational: { kind: 'event-map-order', entityId: 'order-3', refundedAmount: 0 },
    } as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValueOnce({
      id: 'pay_event_3', status: 'RECEIVED', billingType: 'PIX', value: 120,
    } as never);
    vi.mocked(prisma.eventMapOrder.findFirst).mockResolvedValueOnce({
      id: 'order-3', status: 'CONFIRMED', paymentStatus: 'RECEIVED',
      ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 },
    } as never);
    vi.mocked(prisma.eventTicket.count)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(0 as never);
    vi.mocked(registerPaymentCommand).mockRejectedValueOnce(
      new Error('PAYMENT_COMMAND_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD'),
    );

    const response = await POST(buildPostRequest(
      'http://localhost/api/cobrancas/event-charge-3/refund',
      {},
      { 'Idempotency-Key': 'shared-refund-key-2' },
    ), { params: Promise.resolve({ id: 'event-charge-3' }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(prisma.eventMapOrder.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'order-3', contaId: 'conta-1', paymentStatus: 'REFUND_REQUESTED' },
      data: { paymentStatus: 'RECEIVED' },
    });
    expect(registerPaymentCommand).toHaveBeenCalledTimes(1);
    expect(refundCobranca).not.toHaveBeenCalled();
  });

  it('preserva o claim do pedido de boleto após HTTP 408 e não redispatcha o mesmo retry', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(resolveCobrancaPaymentLookupForTenant).mockResolvedValue({
      entityType: 'EVENT', origin: 'EVENT', asaasPaymentId: 'pay_event_408_boleto', localStatus: 'PAGO',
      billingType: 'BOLETO', value: 120,
      operational: { kind: 'event-map-order', entityId: 'order-408-boleto', refundedAmount: 0 },
    } as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValue({
      id: 'pay_event_408_boleto', status: 'RECEIVED', billingType: 'BOLETO', value: 120,
    } as never);
    vi.mocked(prisma.eventMapOrder.findFirst)
      .mockResolvedValueOnce({ id: 'order-408-boleto', status: 'CONFIRMED', paymentStatus: 'RECEIVED', ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 } } as never)
      .mockResolvedValueOnce({ id: 'order-408-boleto', status: 'CONFIRMED', paymentStatus: 'REFUND_REQUESTED', ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 } } as never);
    vi.mocked(prisma.eventTicket.count).mockResolvedValueOnce(1 as never).mockResolvedValueOnce(0 as never);
    vi.mocked(registerPaymentCommand).mockResolvedValueOnce({ id: 'job-408-boleto', payload: { commandStatus: 'REQUESTED' } } as never);
    vi.mocked(requestBankSlipRefund).mockRejectedValueOnce(new AsaasHttpError('provider timeout', 408));

    const makeRequest = () => buildPostRequest('http://localhost/api/cobrancas/event-charge-408-boleto/refund', {}, {
      'Idempotency-Key': 'event-408-boleto-key',
    });
    const first = await POST(makeRequest(), { params: Promise.resolve({ id: 'event-charge-408-boleto' }) });
    const retry = await POST(makeRequest(), { params: Promise.resolve({ id: 'event-charge-408-boleto' }) });

    expect(first.status).toBe(408);
    expect(retry.status).toBe(409);
    expect(requestBankSlipRefund).toHaveBeenCalledTimes(1);
    expect(registerPaymentCommand).toHaveBeenCalledTimes(1);
    expect(markPaymentCommandSent).toHaveBeenCalledWith({ jobId: 'job-408-boleto', providerStatus: 'UNKNOWN' });
    expect(prisma.eventMapOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.eventMapOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { paymentStatus: 'REFUND_REQUESTED', refundRequestUrl: null },
    }));
  });

  it('preserva o claim do pedido não boleto após HTTP 408 e não redispatcha o mesmo retry', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: 'u1', role: 'FINANCEIRO', contaId: 'conta-1' },
    });
    vi.mocked(prisma.cobranca.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.charge.findFirst).mockResolvedValue(null as never);
    vi.mocked(resolveCobrancaPaymentLookupForTenant).mockResolvedValue({
      entityType: 'EVENT', origin: 'EVENT', asaasPaymentId: 'pay_event_408_pix', localStatus: 'PAGO',
      billingType: 'PIX', value: 120,
      operational: { kind: 'event-map-order', entityId: 'order-408-pix', refundedAmount: 0 },
    } as never);
    vi.mocked(readPaymentFullPreflight).mockResolvedValue({
      id: 'pay_event_408_pix', status: 'RECEIVED', billingType: 'PIX', value: 120,
    } as never);
    vi.mocked(prisma.eventMapOrder.findFirst)
      .mockResolvedValueOnce({ id: 'order-408-pix', status: 'CONFIRMED', paymentStatus: 'RECEIVED', ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 } } as never)
      .mockResolvedValueOnce({ id: 'order-408-pix', status: 'CONFIRMED', paymentStatus: 'REFUND_REQUESTED', ticketFulfillmentStatus: 'ISSUED', _count: { items: 1 } } as never);
    vi.mocked(prisma.eventTicket.count).mockResolvedValueOnce(1 as never).mockResolvedValueOnce(0 as never);
    vi.mocked(registerPaymentCommand).mockResolvedValueOnce({ id: 'job-408-pix', payload: { commandStatus: 'REQUESTED' } } as never);
    vi.mocked(refundCobranca).mockRejectedValueOnce(new AsaasHttpError('provider timeout', 408));

    const makeRequest = () => buildPostRequest('http://localhost/api/cobrancas/event-charge-408-pix/refund', {}, {
      'Idempotency-Key': 'event-408-pix-key',
    });
    const first = await POST(makeRequest(), { params: Promise.resolve({ id: 'event-charge-408-pix' }) });
    const retry = await POST(makeRequest(), { params: Promise.resolve({ id: 'event-charge-408-pix' }) });

    expect(first.status).toBe(408);
    expect(retry.status).toBe(409);
    expect(refundCobranca).toHaveBeenCalledTimes(1);
    expect(registerPaymentCommand).toHaveBeenCalledTimes(1);
    expect(markPaymentCommandNeedsReconciliation).toHaveBeenCalledWith({ jobId: 'job-408-pix', error: expect.any(AsaasHttpError) });
    expect(prisma.eventMapOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.eventMapOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
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
