import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerTelemetrySink, type StructuredLog, type TelemetryMetric } from '@alusa/observability';

let unsubscribeTelemetry: (() => void) | undefined;

vi.mock('@alusa/database', () => ({
  prisma: {
    charge: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    cobranca: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    subscription: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    billingAgreement: {
      findMany: vi.fn(),
    },
    installmentPlan: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    standaloneInstallmentPlan: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    matricula: {
      updateMany: vi.fn(),
    },
    sale: {
      findMany: vi.fn(),
    },
    webhookAsaas: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    financeReconciliationIssue: { findMany: vi.fn(), updateMany: vi.fn() },
    financeReconciliationRun: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  AsaasHttpError: class AsaasHttpError extends Error {
    status = 500;
  },
  getPayment: vi.fn(),
  getSubscription: vi.fn(),
  getInstallment: vi.fn(),
  listInstallmentPayments: vi.fn(),
  listPayments: vi.fn(),
}));

vi.mock('../payment-webhook-handler', () => ({
  handlePaymentWebhook: vi.fn(),
}));

vi.mock('../subscription-webhook-handler', () => ({
  handleSubscriptionWebhook: vi.fn(),
}));

vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: vi.fn(),
  resolveFinanceReconciliationIssueByDedupe: vi.fn(),
  buildFinanceReconciliationIssueDedupeKey: ({ entityType, entityId, asaasId, issueType }: {
    entityType: string; entityId?: string | null; asaasId?: string | null; issueType: string;
  }) => `${issueType}:${entityType}:${entityId?.trim() || asaasId?.trim() || 'unknown'}`,
}));

vi.mock('../../foundation/asaas-read-intent', () => ({
  recordAsaasReadIntent: vi.fn(),
}));

import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getInstallment, getPayment, getSubscription, listPayments, listInstallmentPayments } from '@alusa/asaas';
import { alertService } from '../../foundation/alert-channel';
import { handlePaymentWebhook } from '../payment-webhook-handler';
import { handleSubscriptionWebhook } from '../subscription-webhook-handler';
import {
  upsertFinanceReconciliationIssue,
  resolveFinanceReconciliationIssueByDedupe,
} from '../../reconciliation/finance-reconciliation-issue.service';
import {
  detectWebhookGaps,
  getWebhookDetails,
  getWebhookMetrics,
  getWebhookQueueMetrics,
  isProviderCheckDue,
  listWebhooks,
  markExhaustedWebhooks,
  reconcileBilateral,
  reconcileWithAsaas,
} from '../webhook-reconciliation.service';

describe('webhook-reconciliation.service', () => {
  afterEach(() => {
    unsubscribeTelemetry?.();
    unsubscribeTelemetry = undefined;
  });

  beforeEach(() => {
    vi.mocked(prisma.financeReconciliationIssue.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.financeReconciliationRun.findFirst).mockResolvedValue(null as never);
    vi.clearAllMocks();
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
    vi.mocked(prisma.billingAgreement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue([]);
    vi.mocked(prisma.standaloneInstallmentPlan.findMany).mockResolvedValue([]);
    vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
    vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([]);
    vi.mocked(prisma.charge.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.charge.count).mockResolvedValue(0);
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.installmentPlan.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.standaloneInstallmentPlan.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-key' } as never);
    vi.mocked(handlePaymentWebhook).mockResolvedValue({ success: true } as never);
    vi.mocked(handleSubscriptionWebhook).mockResolvedValue({ success: true });
  });

  describe('getWebhookQueueMetrics telemetry scope', () => {
    it('does not publish global gauges for a tenant-scoped query', async () => {
      const metrics: TelemetryMetric[] = [];
      unsubscribeTelemetry = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{
        pending: 1n,
        processing: 0n,
        errored: 0n,
        processed: 4n,
        exhausted: 0n,
        highRetryBacklog: 0n,
        stuckProcessing: 0n,
        oldestPendingAt: new Date(),
      }] as never);

      await getWebhookQueueMetrics({ contaId: 'tenant-a' });

      expect(metrics).toEqual([]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('publishes global gauges only with the static provider dimension', async () => {
      const metrics: TelemetryMetric[] = [];
      unsubscribeTelemetry = registerTelemetrySink({ metric: (metric) => metrics.push(metric) });
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{
        pending: 1n,
        processing: 0n,
        errored: 0n,
        processed: 4n,
        exhausted: 0n,
        highRetryBacklog: 0n,
        stuckProcessing: 0n,
        oldestPendingAt: new Date(),
      }] as never);

      await getWebhookQueueMetrics();

      expect(metrics).toHaveLength(8);
      expect(metrics.every((metric) => JSON.stringify(metric.dimensions) === JSON.stringify({ provider: 'asaas' }))).toBe(true);
      expect(JSON.stringify(metrics)).not.toContain('tenant-a');
    });
  });

  describe('markExhaustedWebhooks telemetry', () => {
    it('emite evento estruturado sem IDs de webhook ou tenant', async () => {
      const logs: StructuredLog[] = [];
      unsubscribeTelemetry = registerTelemetrySink({ log: (record) => logs.push(record) });
      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([{
        id: 'private-webhook-id',
        contaId: 'private-tenant-id',
      }] as never);
      vi.mocked(prisma.webhookAsaas.updateMany).mockResolvedValue({ count: 1 } as never);

      const result = await markExhaustedWebhooks();

      expect(result).toMatchObject({ marked: 1, ids: ['private-webhook-id'] });
      expect(logs).toHaveLength(2);
      expect(logs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          'event.name': 'finance.webhook.dlq.marked',
          attributes: { operation: 'mark_exhausted', itemCount: 1, maxAttempts: 5 },
        }),
        expect.objectContaining({
          severity: 'error',
          'event.name': 'finance.webhook.dlq.alert',
          attributes: { 'alert.severity': 'error', 'alert.count': 1 },
        }),
      ]));
      expect(JSON.stringify(logs)).not.toContain('private-webhook-id');
      expect(JSON.stringify(logs)).not.toContain('private-tenant-id');
    });
  });

  describe('detectWebhookGaps', () => {
    it('deve retornar cobranças acadêmicas e avulsas em status não-final sem webhook recente', async () => {
      const mockCobrancas = [
        {
          id: 'cob-1',
          asaasPaymentId: 'pay_123',
          status: 'ATRASADO',
          vencimento: new Date('2026-01-20'),
        },
      ];
      const mockStandaloneCharges = [
        {
          id: 'ch-1',
          asaasPaymentId: 'pay_456',
          status: 'OPEN',
          dueDate: new Date('2026-01-22'),
        },
      ];

      vi.mocked(prisma.cobranca.findMany).mockResolvedValue(mockCobrancas as never);
      vi.mocked(prisma.charge.findMany).mockResolvedValue(mockStandaloneCharges as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

      const result = await detectWebhookGaps('conta-1', { windowDays: 7 });

      expect(result.chargesWithMissingFinalStatus).toHaveLength(2);
      expect(result.chargesWithMissingFinalStatus.map((item) => item.id)).toEqual(['cob-1', 'ch-1']);
      expect(prisma.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        }),
      }));
    });

    it('deve filtrar cobranças com webhook recente', async () => {
      const now = new Date();
      const recentWebhookDate = new Date(now);
      recentWebhookDate.setHours(recentWebhookDate.getHours() - 6);

      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([
        {
          id: 'cob-1',
          asaasPaymentId: 'pay_123',
          status: 'ATRASADO',
          vencimento: new Date('2026-01-20'),
        },
      ] as never);
      vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([{
        asaasPaymentId: 'pay_123',
        recebidoEm: recentWebhookDate,
      }] as never);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

      const result = await detectWebhookGaps('conta-1', { windowDays: 7 });

      expect(result.chargesWithMissingFinalStatus).toHaveLength(0);
    });

    it('mantém ausência de evento como diagnóstico e não abre falha financeira sem divergência verificada', async () => {
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([{
        id: 'cob-pending', asaasPaymentId: 'pay-pending', status: 'PENDENTE', vencimento: new Date(),
      }] as never);
      vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

      const result = await detectWebhookGaps('conta-1', { persistIssues: true });

      expect(result.chargesWithMissingFinalStatus).toHaveLength(1);
      expect(upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
    });
  });

  describe('reconcileWithAsaas', () => {
    it('considera somente registros cujo intervalo persistido de verificação venceu', async () => {
      const cutoff = new Date('2026-06-13T12:00:00.000Z');
      expect(isProviderCheckDue(null, cutoff)).toBe(true);
      expect(isProviderCheckDue(new Date('2026-06-13T11:59:59.000Z'), cutoff)).toBe(true);
      expect(isProviderCheckDue(new Date('2026-06-13T12:00:01.000Z'), cutoff)).toBe(false);
    });

    it('não consulta Asaas novamente para pagamento saudável recém-verificado', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.asaasCalls).toBe(0);
      expect(getPayment).not.toHaveBeenCalled();
      expect(prisma.charge.findMany.mock.calls[0]?.[0]).toMatchObject({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ status: { in: expect.any(Array) } }),
            expect.objectContaining({ OR: [
              { lastProviderCheckAt: null },
              { lastProviderCheckAt: expect.objectContaining({ lte: expect.any(Date) }) },
            ] }),
          ]),
        }),
      });
      expect(prisma.charge.findMany.mock.calls[1]?.[0]).toMatchObject({
        where: expect.objectContaining({ status: 'PAID' }),
      });
      expect(prisma.cobranca.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'conta-1',
          matricula: { contaId: 'conta-1', aluno: { contaId: 'conta-1' } },
        }),
      }));
    });

    it('prioriza cobranças em aberto antes da rechecagem de cobranças pagas dentro do limite', async () => {
      vi.mocked(prisma.charge.findMany)
        .mockResolvedValueOnce([
          { id: 'ch-open-1', asaasPaymentId: 'pay-open-1', status: 'OPEN', asaasStatus: 'PENDING', externalReference: null, lastProviderCheckAt: null },
          { id: 'ch-open-2', asaasPaymentId: 'pay-open-2', status: 'OPEN', asaasStatus: 'PENDING', externalReference: null, lastProviderCheckAt: null },
        ] as never)
        .mockResolvedValueOnce([
          { id: 'ch-paid-1', asaasPaymentId: 'pay-paid-1', status: 'PAID', asaasStatus: 'CONFIRMED', externalReference: null, lastProviderCheckAt: null },
          { id: 'ch-paid-2', asaasPaymentId: 'pay-paid-2', status: 'PAID', asaasStatus: 'CONFIRMED', externalReference: null, lastProviderCheckAt: null },
        ] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockImplementation(async ({ paymentId }) => ({
        id: paymentId,
        status: 'PENDING',
        value: 100,
        netValue: 100,
      } as never));

      const result = await reconcileWithAsaas({ contaId: 'conta-a', limit: 2, maxAsaasCalls: 2, dryRun: true });

      expect(result.checkedPayments).toBe(2);
      expect(getPayment).toHaveBeenNthCalledWith(1, { apiKey: 'test-key', paymentId: 'pay-open-1' });
      expect(getPayment).toHaveBeenNthCalledWith(2, { apiKey: 'test-key', paymentId: 'pay-open-2' });
      expect(getPayment).not.toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay-paid-1' }));
      expect(prisma.charge.findMany.mock.calls[0]?.[0].where).toMatchObject({
        AND: expect.arrayContaining([expect.objectContaining({ status: { in: expect.any(Array) } })]),
      });
      expect(prisma.charge.findMany.mock.calls[1]?.[0].where).toMatchObject({ status: 'PAID' });
    });

    it('reserva chamadas para assinaturas quando há backlog de pagamentos e orçamento baixo', async () => {
      vi.mocked(prisma.charge.findMany)
        .mockResolvedValueOnce(Array.from({ length: 5 }, (_, index) => ({
          id: `ch-open-${index + 1}`,
          asaasPaymentId: `pay-open-${index + 1}`,
          status: 'OPEN',
          asaasStatus: 'PENDING',
          externalReference: null,
          lastProviderCheckAt: null,
        })) as never)
        .mockResolvedValueOnce([] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([{
        id: 'sub-local-1', asaasSubscriptionId: 'sub-remote-1', status: 'ACTIVE', lastProviderCheckAt: null,
      }] as never);
      vi.mocked(getPayment).mockImplementation(async ({ paymentId }) => ({
        id: paymentId, status: 'PENDING', value: 100, netValue: 100,
      } as never));
      vi.mocked(getSubscription).mockResolvedValue({
        id: 'sub-remote-1', status: 'ACTIVE', value: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10, maxAsaasCalls: 2, dryRun: true });

      expect(result.asaasCalls).toBe(2);
      expect(result.checkedPayments).toBe(1);
      expect(result.checkedSubscriptions).toBe(1);
      expect(getPayment).toHaveBeenCalledTimes(1);
      expect(getSubscription).toHaveBeenCalledTimes(1);
    });

    it.each([false, true])('consumes reserved subscription evidence after fully retried payment GET exceeds the soft deadline (failure=%s)', async (paymentFails) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-03T04:00:00.000Z'));
      vi.mocked(prisma.charge.findMany)
        .mockResolvedValueOnce(Array.from({ length: 5 }, (_, index) => ({
          id: `ch-slow-${index}`, asaasPaymentId: `pay-slow-${index}`, status: 'OPEN', asaasStatus: 'PENDING',
          externalReference: null, lastProviderCheckAt: null,
        })) as never)
        .mockResolvedValueOnce([] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([{
        id: 'sub-slow-local', asaasSubscriptionId: 'sub-slow-remote', status: 'ACTIVE', lastProviderCheckAt: null,
      }] as never);
      const lastSeenAt = new Date('2026-11-01T00:00:00.000Z');
      vi.mocked(prisma.financeReconciliationIssue.findMany).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{
        entityId: 'sub-slow-local', asaasId: 'sub-slow-remote', lastSeenAt,
      }] as never);
      // One SDK operation includes all its retries/backoff/Retry-After waits.
      vi.mocked(getPayment).mockImplementation(async ({ paymentId }) => {
        await new Promise((resolve) => setTimeout(resolve, 65_000));
        if (paymentFails) throw new Error('SDK retries exhausted');
        return { id: paymentId, status: 'PENDING', value: 100, netValue: 100 } as never;
      });
      vi.mocked(getSubscription).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50_000));
        return { id: 'sub-slow-remote', status: 'ACTIVE', value: 100 } as never;
      });

      try {
        const pass = reconcileWithAsaas({
          contaId: 'tenant-a', limit: 10, maxAsaasCalls: 10, maxDurationMs: 5_000,
        });
        await vi.advanceTimersByTimeAsync(70_000);
        const result = await pass;

        expect(result.asaasCalls).toBe(2);
        expect(result.checkedPayments).toBe(1);
        expect(result.checkedSubscriptions).toBe(1);
        expect(result.budgetExhausted).toBe(true);
        expect(getPayment).toHaveBeenCalledTimes(1);
        expect(getSubscription).toHaveBeenCalledTimes(1);
        expect(getSubscription.mock.invocationCallOrder[0]).toBeLessThan(getPayment.mock.invocationCallOrder[0]!);
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-slow-local', contaId: 'tenant-a', asaasSubscriptionId: 'sub-slow-remote', status: 'ACTIVE' },
          data: { lastProviderCheckAt: expect.any(Date) },
        });
        expect(resolveFinanceReconciliationIssueByDedupe).toHaveBeenCalledWith(expect.objectContaining({
          contaId: 'tenant-a', expectedLastSeenAt: lastSeenAt,
          dedupeKey: 'WEBHOOK_LAG:SUBSCRIPTION:sub-slow-local',
        }));
        expect(handlePaymentWebhook).not.toHaveBeenCalled();
        expect(handleSubscriptionWebhook).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('awaits a failed prefetched subscription and persists its attempt cursor after deadline exhaustion', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-03T04:00:00.000Z'));
      vi.mocked(prisma.charge.findMany).mockResolvedValue(Array.from({ length: 2 }, (_, index) => ({
        id: `ch-fail-${index}`, asaasPaymentId: `pay-fail-${index}`, status: 'OPEN', asaasStatus: 'PENDING',
        externalReference: null, lastProviderCheckAt: null,
      })) as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findMany).mockResolvedValueOnce([{
        id: 'sub-fail-local', asaasSubscriptionId: 'sub-fail-remote', status: 'ACTIVE', lastProviderCheckAt: null,
      }] as never);
      vi.mocked(getPayment).mockImplementation(async ({ paymentId }) => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return { id: paymentId, status: 'PENDING', value: 100, netValue: 100 } as never;
      });
      vi.mocked(getSubscription).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 65_000));
        throw new Error('subscription SDK retries exhausted');
      });
      try {
        const pass = reconcileWithAsaas({ contaId: 'tenant-a', maxAsaasCalls: 10, maxDurationMs: 5_000 });
        await vi.advanceTimersByTimeAsync(70_000);
        const result = await pass;
        expect(result.asaasCalls).toBe(2);
        expect(result.checkedSubscriptions).toBe(1);
        expect(result.budgetExhausted).toBe(true);
        expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^subscription:sub-fail-remote:/)]));
        expect(getSubscription).toHaveBeenCalledTimes(1);
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
          where: { id: 'sub-fail-local', contaId: 'tenant-a', asaasSubscriptionId: 'sub-fail-remote', status: 'ACTIVE' },
          data: { lastProviderCheckAt: expect.any(Date) },
        });
        expect(resolveFinanceReconciliationIssueByDedupe).not.toHaveBeenCalledWith(expect.objectContaining({
          dedupeKey: 'WEBHOOK_LAG:SUBSCRIPTION:sub-fail-local',
        }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('consumes the one reserved agreement GET after payments exhaust the deadline', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-03T04:00:00.000Z'));
      vi.mocked(prisma.charge.findMany).mockResolvedValue(Array.from({ length: 3 }, (_, index) => ({
        id: `ch-agreement-${index}`, asaasPaymentId: `pay-agreement-${index}`, status: 'OPEN', asaasStatus: 'PENDING',
        externalReference: null, lastProviderCheckAt: null,
      })) as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.billingAgreement.findMany).mockResolvedValueOnce([{
        id: 'agreement-local', asaasSubscriptionId: 'agreement-remote', status: 'ACTIVE',
        remoteStatus: 'ACTIVE', desiredValue: 100, confirmedValue: 100, lastReconciledAt: null,
      }] as never);
      vi.mocked(getSubscription).mockResolvedValue({ id: 'agreement-remote', status: 'ACTIVE', value: 120 } as never);
      vi.mocked(getPayment).mockImplementation(async ({ paymentId }) => {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return { id: paymentId, status: 'PENDING', value: 100, netValue: 100 } as never;
      });
      try {
        const pass = reconcileWithAsaas({ contaId: 'tenant-a', maxAsaasCalls: 10, maxDurationMs: 5_000, dryRun: true });
        await vi.advanceTimersByTimeAsync(15_000);
        const result = await pass;
        expect(result.asaasCalls).toBe(2);
        expect(result.checkedSubscriptions).toBe(1);
        expect(result.subscriptionDrift).toBe(1);
        expect(result.budgetExhausted).toBe(true);
        expect(getSubscription).toHaveBeenCalledWith({ apiKey: 'test-key', subscriptionId: 'agreement-remote' });
        expect(handleSubscriptionWebhook).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('alternates a one-call budget using the last persisted tenant run', async () => {
      vi.mocked(prisma.charge.findMany)
        .mockResolvedValue([{
          id: 'ch-fair', asaasPaymentId: 'pay-fair', status: 'OPEN', asaasStatus: 'PENDING',
          externalReference: null, lastProviderCheckAt: null,
        }] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([{
        id: 'sub-fair-local', asaasSubscriptionId: 'sub-fair-remote', status: 'ACTIVE', lastProviderCheckAt: null,
      }] as never);
      vi.mocked(getPayment).mockImplementation(async ({ paymentId }) => ({
        id: paymentId, status: 'PENDING', value: 100, netValue: 100,
      } as never));
      vi.mocked(getSubscription).mockResolvedValue({
        id: 'sub-fair-remote', status: 'ACTIVE', value: 100,
      } as never);
      vi.mocked(prisma.financeReconciliationRun.findFirst)
        .mockResolvedValueOnce({ checkedPayments: 1, checkedSubscriptions: 0 } as never)
        .mockResolvedValueOnce({ checkedPayments: 0, checkedSubscriptions: 1 } as never);

      vi.mocked(getSubscription).mockRejectedValueOnce(new Error('failed subscription attempt'));
      const first = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10, maxAsaasCalls: 1 });
      expect(first.checkedSubscriptions).toBe(1);
      expect(first.checkedPayments).toBe(0);
      expect(first.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^subscription:sub-fair-remote:/)]));
      expect(getPayment).not.toHaveBeenCalled();
      expect(getSubscription).toHaveBeenCalledTimes(1);

      vi.mocked(getPayment).mockClear();
      vi.mocked(getSubscription).mockClear();
      vi.mocked(getPayment).mockRejectedValueOnce(new Error('failed payment attempt'));
      const second = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10, maxAsaasCalls: 1 });
      expect(second.checkedPayments).toBe(1);
      expect(second.checkedSubscriptions).toBe(0);
      expect(prisma.financeReconciliationRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { contaId: 'tenant-a', completedAt: { not: null } },
      }));
      expect(getPayment).toHaveBeenCalledTimes(1);
      expect(getSubscription).not.toHaveBeenCalled();
    });

    it('reconcilia charge avulsa em status não-final quando Asaas está pago', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([
        {
          id: 'ch-1',
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          externalReference: 'alusa:ch-1',
        },
      ] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockResolvedValue({
        id: 'pay_1',
        status: 'CONFIRMED',
        value: 360,
        netValue: 350,
        dueDate: '2026-06-13',
        billingType: 'CREDIT_CARD',
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.checkedPayments).toBe(1);
      expect(result.paymentDrift).toBe(1);
      expect(result.reconciledPayments).toBe(1);
      expect(getPayment).toHaveBeenCalledWith({
        apiKey: 'test-key',
        paymentId: 'pay_1',
      });
      expect(handlePaymentWebhook).toHaveBeenCalledWith(
        'conta-1',
        expect.objectContaining({
          event: 'PAYMENT_CONFIRMED',
          payment: expect.objectContaining({ id: 'pay_1', status: 'CONFIRMED' }),
        }),
      );
      expect(upsertFinanceReconciliationIssue).toHaveBeenCalled();
    });

    it('mantém issue stale para pagamento liquidado com snapshot Asaas aberto sem chamar webhook', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValueOnce([] as never).mockResolvedValueOnce([{
        id: 'ch-paid', asaasPaymentId: 'pay-paid', status: 'PAID', asaasStatus: 'CONFIRMED',
        externalReference: null,
      }] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValueOnce([] as never).mockResolvedValueOnce([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockResolvedValue({
        id: 'pay-paid', status: 'PENDING', value: 100, netValue: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-a', limit: 10 });

      expect(result.paymentDrift).toBe(1);
      expect(upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-a', issueType: 'ASAAS_SNAPSHOT_STALE', localStatus: 'PAID', remoteStatus: 'OPEN',
      }));
      expect(resolveFinanceReconciliationIssueByDedupe).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-a',
        dedupeKey: 'PAYMENT_STATUS_DRIFT:CHARGE:ch-paid',
        resolution: expect.stringContaining('substituída'),
      }));
      const chargeWhere = vi.mocked(prisma.charge.findMany).mock.calls[1]?.[0].where as unknown as {
        contaId?: string;
        status?: string;
        OR?: Array<Record<string, unknown>>;
      };
      expect(chargeWhere.contaId).toBe('conta-a');
      expect(chargeWhere.status).toBe('PAID');
      expect(chargeWhere.OR).not.toContainEqual(expect.objectContaining({
        asaasStatus: expect.anything(),
      }));
      const cobrancaWhere = vi.mocked(prisma.cobranca.findMany).mock.calls[1]?.[0].where as unknown as {
        contaId?: string;
        matricula?: { contaId?: string; aluno?: { contaId?: string } };
        status?: string;
        OR?: Array<Record<string, unknown>>;
      };
      expect(cobrancaWhere.contaId).toBe('conta-a');
      expect(cobrancaWhere.matricula).toEqual({ contaId: 'conta-a', aluno: { contaId: 'conta-a' } });
      expect(cobrancaWhere.status).toBe('PAGO');
      expect(cobrancaWhere.OR).not.toContainEqual(expect.objectContaining({
        asaasStatus: expect.anything(),
      }));
      expect(prisma.charge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ch-paid', contaId: 'conta-a', asaasPaymentId: 'pay-paid', status: 'PAID', asaasStatus: 'CONFIRMED' },
        data: expect.objectContaining({ lastProviderCheckAt: expect.any(Date), lastAsaasFetchAt: expect.any(Date) }),
      }));
      expect(handlePaymentWebhook).not.toHaveBeenCalled();
    });

    it('verifica WEBHOOK_LAG aberto para charge cancelada e fecha somente a observação lida', async () => {
      const observedAt = new Date('2026-10-01T00:00:00.000Z');
      vi.mocked(prisma.charge.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'ch-canceled', asaasPaymentId: 'pay-canceled', status: 'CANCELED',
          asaasStatus: 'DELETED', lastProviderCheckAt: null, externalReference: 'alusa:ch-canceled',
        }] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.financeReconciliationIssue.findMany).mockResolvedValue([{
        entityId: 'ch-canceled', asaasId: 'pay-canceled', lastSeenAt: observedAt,
      }] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockResolvedValue({ id: 'pay-canceled', status: 'DELETED', deleted: true, value: 50 } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-a', limit: 10 });

      expect(result.checkedPayments).toBe(1);
      expect(result.paymentDrift).toBe(0);
      expect(resolveFinanceReconciliationIssueByDedupe).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-a', dedupeKey: 'WEBHOOK_LAG:CHARGE:ch-canceled', expectedLastSeenAt: observedAt,
      }));
      expect(prisma.charge.findMany.mock.calls[2]?.[0].where).toMatchObject({
        contaId: 'conta-a', id: { in: ['ch-canceled'] },
      });
    });

    it('mantém WEBHOOK_LAG aberto quando o GET Asaas falha', async () => {
      vi.mocked(prisma.charge.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          id: 'ch-lag', asaasPaymentId: 'pay-lag', status: 'OPEN', asaasStatus: 'PENDING',
          lastProviderCheckAt: null, externalReference: 'alusa:ch-lag',
        }] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.financeReconciliationIssue.findMany).mockResolvedValue([{
        entityId: 'ch-lag', asaasId: 'pay-lag', lastSeenAt: new Date('2026-10-01T00:00:00.000Z'),
      }] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockRejectedValue(new Error('provider unavailable'));

      const result = await reconcileWithAsaas({ contaId: 'conta-a', limit: 10 });

      expect(result.errors.some((error) => error.includes('payment:pay-lag:'))).toBe(true);
      expect(resolveFinanceReconciliationIssueByDedupe).not.toHaveBeenCalledWith(expect.objectContaining({
        dedupeKey: 'WEBHOOK_LAG:CHARGE:ch-lag',
      }));
      expect(prisma.charge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ch-lag', contaId: 'conta-a', asaasPaymentId: 'pay-lag', status: 'OPEN', asaasStatus: 'PENDING' },
        data: expect.objectContaining({ lastProviderCheckAt: expect.any(Date) }),
      }));
    });

    it('não avança o cursor quando o handler local falha após consulta ao Asaas', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([
        {
          id: 'ch-1',
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          externalReference: null,
        },
      ] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockResolvedValue({
        id: 'pay_1',
        status: 'CONFIRMED',
        value: 360,
        netValue: 350,
      } as never);
      vi.mocked(handlePaymentWebhook).mockResolvedValue({
        success: false,
        error: 'erro interno não deve ser propagado',
      });

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.errors).toContain('payment:pay_1:handler_failed');
      expect(result.errors.join(' ')).not.toContain('erro interno não deve ser propagado');
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
    });

    it('não avança o cursor de assinatura quando a aplicação local falha', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([
        {
          id: 'sub-1',
          asaasSubscriptionId: 'sub_1',
          status: 'ACTIVE',
        },
      ] as never);
      vi.mocked(getSubscription).mockResolvedValue({
        id: 'sub_1',
        status: 'INACTIVE',
        deleted: false,
      } as never);
      vi.mocked(handleSubscriptionWebhook).mockResolvedValue({
        success: false,
        error: 'erro interno não deve ser propagado',
      });

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.errors).toContain('subscription:sub_1:handler_failed');
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    });

    it('não resolve lag de assinatura cujo asaasId observado não corresponde à assinatura local consultada', async () => {
      const observedAt = new Date('2026-10-01T00:00:00.000Z');
      vi.mocked(prisma.subscription.findMany)
        .mockResolvedValueOnce([{
          id: 'subscription-local', asaasSubscriptionId: 'sub-canonical', status: 'ACTIVE', lastProviderCheckAt: null,
        }] as never)
        .mockResolvedValueOnce([{
          id: 'subscription-local', asaasSubscriptionId: 'sub-canonical', status: 'ACTIVE', lastProviderCheckAt: null,
        }] as never);
      vi.mocked(prisma.financeReconciliationIssue.findMany)
        .mockResolvedValueOnce([] as never)
        .mockResolvedValueOnce([{
          entityId: 'subscription-local', asaasId: 'sub-other', lastSeenAt: observedAt,
        }] as never);
      vi.mocked(getSubscription).mockResolvedValue({ id: 'sub-canonical', status: 'ACTIVE' } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-a', limit: 10 });

      expect(result.checkedSubscriptions).toBe(1);
      expect(resolveFinanceReconciliationIssueByDedupe).not.toHaveBeenCalledWith(expect.objectContaining({
        dedupeKey: 'WEBHOOK_LAG:SUBSCRIPTION:subscription-local',
      }));
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'subscription-local', contaId: 'conta-a', asaasSubscriptionId: 'sub-canonical', status: 'ACTIVE' },
      }));
    });

    it('não chama Asaas quando webhook ainda está na fila', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([
        {
          id: 'ch-1',
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          externalReference: null,
        },
      ] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue({ id: 'wh-1' } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.checkedPayments).toBe(0);
      expect(result.paymentDrift).toBe(0);
      expect(getPayment).not.toHaveBeenCalled();
      expect(handlePaymentWebhook).not.toHaveBeenCalled();
    });

    it('não reporta drift nem atualiza installment quando totalCount contradiz a página', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue([{
        id: 'plan-1', asaasInstallmentId: 'inst-1',
      }] as never);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-1' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: [], hasMore: false, totalCount: 1, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.installmentDrift).toBe(0);
      expect(result.errors.some((error) => error.includes('PAYMENT_LOOKUP_INCOMPLETE'))).toBe(true);
      expect(prisma.installmentPlan.updateMany).not.toHaveBeenCalled();
      expect(upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
    });

    it('não compara nem resolve issue quando ainda há páginas remotas de pagamentos', async () => {
      vi.mocked(prisma.standaloneInstallmentPlan.findMany).mockResolvedValue([{
        id: 'plan-paged', asaasInstallmentId: 'inst-paged', status: 'CANCELED',
      }] as never);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-paged' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `pay-${index}`, status: 'PENDING', deleted: false,
        })),
        hasMore: true, totalCount: 101, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10 });

      expect(result.errors).toContain('INSTALLMENT:inst-paged:PAYMENT_LOOKUP_INCOMPLETE:additional_pages_available');
      expect(result.installmentDrift).toBe(0);
      expect(prisma.charge.count).not.toHaveBeenCalled();
      expect(resolveFinanceReconciliationIssueByDedupe).not.toHaveBeenCalled();
      expect(upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
      expect(prisma.standaloneInstallmentPlan.updateMany).not.toHaveBeenCalled();
    });

    it('resolve drift antigo para parcelamento avulso cancelado quando Asaas retorna zero pagamentos', async () => {
      vi.mocked(prisma.standaloneInstallmentPlan.findMany).mockResolvedValue([{
        id: 'plan-canceled', asaasInstallmentId: 'inst-canceled', status: 'CANCELED',
      }] as never);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-canceled' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: [], hasMore: false, totalCount: 0, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10 });

      expect(result.installmentDrift).toBe(0);
      expect(prisma.standaloneInstallmentPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a' }),
        select: expect.objectContaining({ status: true }),
      }));
      expect(resolveFinanceReconciliationIssueByDedupe).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'tenant-a', dedupeKey: 'PAYMENT_STATUS_DRIFT:INSTALLMENT_PLAN:plan-canceled',
      }));
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
      expect(prisma.charge.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          contaId: 'tenant-a', standaloneInstallmentPlanId: 'plan-canceled', status: { not: 'CANCELED' },
        }),
      }));
    });

    it('mantém drift quando plano cancelado ainda tem pagamento listado pelo Asaas', async () => {
      vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue([{
        id: 'plan-canceled-with-payment', asaasInstallmentId: 'inst-canceled-with-payment', status: 'CANCELED',
      }] as never);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-canceled-with-payment' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: [{ id: 'pay-still-remote', status: 'PENDING', deleted: false }],
        hasMore: false, totalCount: 1, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10 });

      expect(result.installmentDrift).toBe(1);
      expect(upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'tenant-a', entityId: 'plan-canceled-with-payment', localStatus: '0', remoteStatus: '1',
      }));
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
      expect(prisma.matricula.updateMany).not.toHaveBeenCalled();
      expect(prisma.installmentPlan.updateMany).toHaveBeenCalledWith({
        where: { id: 'plan-canceled-with-payment', contaId: 'tenant-a' },
        data: { lastProviderCheckAt: expect.any(Date) },
      });
    });

    it('conta apenas charges não canceladas em plano ativo e preserva divergência legítima', async () => {
      vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue([{
        id: 'plan-active', asaasInstallmentId: 'inst-active', status: 'ACTIVE',
      }] as never);
      vi.mocked(prisma.charge.count).mockResolvedValue(2);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-active' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: [
          { id: 'pay-active', status: 'PENDING', deleted: false },
          { id: 'pay-deleted', status: 'DELETED', deleted: true },
        ], hasMore: false, totalCount: 2, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10 });

      expect(result.installmentDrift).toBe(1);
      expect(prisma.charge.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a', status: { not: 'CANCELED' } }),
      }));
      expect(upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'tenant-a', entityId: 'plan-active',
        localStatus: '2', remoteStatus: '1',
      }));
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
    });

    it('em dryRun informa drift sem abrir/resolver issue nem atualizar plano', async () => {
      vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue([{
        id: 'plan-dry-run', asaasInstallmentId: 'inst-dry-run', status: 'ACTIVE',
      }] as never);
      vi.mocked(prisma.charge.count).mockResolvedValue(2);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-dry-run' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: [{ id: 'pay-one', status: 'PENDING', deleted: false }],
        hasMore: false, totalCount: 1, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10, dryRun: true });

      expect(result.installmentDrift).toBe(1);
      expect(upsertFinanceReconciliationIssue).not.toHaveBeenCalled();
      expect(resolveFinanceReconciliationIssueByDedupe).not.toHaveBeenCalled();
      expect(prisma.installmentPlan.updateMany).not.toHaveBeenCalled();
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
      expect(prisma.matricula.updateMany).not.toHaveBeenCalled();
    });

    it('reconcilia apenas planos e charges do tenant solicitado', async () => {
      const tenantPlans = [
        { id: 'plan-tenant-a', contaId: 'tenant-a', asaasInstallmentId: 'inst-tenant-a', status: 'ACTIVE' },
        { id: 'plan-tenant-b', contaId: 'tenant-b', asaasInstallmentId: 'inst-tenant-b', status: 'ACTIVE' },
      ];
      vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue(
        tenantPlans.filter((plan) => plan.contaId === 'tenant-a') as never,
      );
      vi.mocked(prisma.charge.count).mockResolvedValue(2);
      vi.mocked(getInstallment).mockResolvedValue({ id: 'inst-tenant-a' } as never);
      vi.mocked(listInstallmentPayments).mockResolvedValue({
        data: [{ id: 'pay-tenant-a', status: 'PENDING', deleted: false }],
        hasMore: false, totalCount: 1, offset: 0, limit: 100,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'tenant-a', limit: 10 });

      expect(result.installmentDrift).toBe(1);
      expect(prisma.installmentPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a' }),
      }));
      expect(prisma.standaloneInstallmentPlan.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a' }),
      }));
      expect(prisma.charge.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contaId: 'tenant-a' }),
      }));
      expect(upsertFinanceReconciliationIssue).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'tenant-a', entityId: 'plan-tenant-a',
      }));
      expect(prisma.installmentPlan.updateMany).toHaveBeenCalledWith({
        where: { id: 'plan-tenant-a', contaId: 'tenant-a' },
        data: { lastProviderCheckAt: expect.any(Date) },
      });
      expect(prisma.charge.updateMany).not.toHaveBeenCalled();
      expect(prisma.matricula.updateMany).not.toHaveBeenCalled();
    });

    it('não reconcilia quando status local já converge com o Asaas', async () => {
      vi.mocked(prisma.charge.findMany).mockResolvedValue([
        {
          id: 'ch-1',
          asaasPaymentId: 'pay_1',
          status: 'OPEN',
          asaasStatus: 'PENDING',
          externalReference: null,
        },
      ] as never);
      vi.mocked(prisma.cobranca.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(getPayment).mockResolvedValue({
        id: 'pay_1',
        status: 'PENDING',
        value: 360,
        netValue: 360,
      } as never);

      const result = await reconcileWithAsaas({ contaId: 'conta-1', limit: 10 });

      expect(result.checkedPayments).toBe(1);
      expect(result.paymentDrift).toBe(0);
      expect(result.reconciledPayments).toBe(0);
      expect(handlePaymentWebhook).not.toHaveBeenCalled();
      expect(resolveFinanceReconciliationIssueByDedupe).not.toHaveBeenCalledWith(expect.objectContaining({
        dedupeKey: 'WEBHOOK_LAG:CHARGE:ch-1',
      }));
      expect(resolveFinanceReconciliationIssueByDedupe).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-1', dedupeKey: 'ASAAS_SNAPSHOT_STALE:CHARGE:ch-1',
      }));
      expect(resolveFinanceReconciliationIssueByDedupe).toHaveBeenCalledWith(expect.objectContaining({
        contaId: 'conta-1', dedupeKey: 'PAYMENT_STATUS_DRIFT:CHARGE:ch-1',
      }));
    });
  });

  describe('reconcileBilateral pagination cap', () => {
    it('conta PAYMENT_DELETED como reconciliado somente após handler success true', async () => {
      vi.mocked(listPayments).mockResolvedValueOnce({
        object: 'list', totalCount: 1, offset: 0, limit: 10, hasMore: false,
        data: [{ id: 'pay-deleted-success', deleted: true, status: 'DELETED', value: 20, netValue: 20 }],
      } as never);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
        id: 'charge-deleted-success', status: 'OPEN', externalReference: 'charge-ref',
      } as never);
      vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({ success: true } as never);

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 10 });

      expect(result.complete).toBe(true);
      expect(result.reconciled).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it('preserva incompletude quando o handler PAYMENT_DELETED retorna success false', async () => {
      vi.mocked(listPayments).mockResolvedValueOnce({
        object: 'list', totalCount: 1, offset: 0, limit: 10, hasMore: false,
        data: [{ id: 'pay-deleted-false', deleted: true, status: 'DELETED', value: 20, netValue: 20 }],
      } as never);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
        id: 'charge-deleted-false', status: 'OPEN', externalReference: 'charge-ref',
      } as never);
      vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({
        success: false, error: 'webhook rejected',
      } as never);
      const alert = vi.spyOn(alertService, 'alertReconciliationDrift').mockResolvedValue();

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 10 });

      expect(result.complete).toBe(false);
      expect(result.reconciled).toBe(0);
      expect(result.errors).toContain('reconcile:pay-deleted-false:webhook rejected');
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it('preserva incompletude quando o handler de STATUS_MISMATCH retorna success false', async () => {
      vi.mocked(listPayments).mockResolvedValueOnce({
        object: 'list', totalCount: 1, offset: 0, limit: 10, hasMore: false,
        data: [{ id: 'pay-status-false', status: 'CONFIRMED', value: 20, netValue: 20 }],
      } as never);
      vi.mocked(prisma.charge.findFirst).mockResolvedValueOnce({
        id: 'charge-status-false', status: 'OPEN',
      } as never);
      vi.mocked(handlePaymentWebhook).mockResolvedValueOnce({
        success: false, error: 'webhook rejected',
      } as never);
      const alert = vi.spyOn(alertService, 'alertReconciliationDrift').mockResolvedValue();

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 10 });

      expect(result.complete).toBe(false);
      expect(result.reconciled).toBe(0);
      expect(result.errors).toContain('reconcile:pay-status-false:webhook rejected');
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it('reports incomplete when the last allowed page still has more results', async () => {
      vi.mocked(listPayments).mockResolvedValue({
        object: 'list',
        totalCount: 2,
        offset: 0,
        limit: 1,
        hasMore: true,
        data: [{
          id: 'pay-1',
          status: 'CONFIRMED',
          value: 20,
          netValue: 20,
          externalReference: 'alusa:charge-1',
        }],
      } as never);
      vi.mocked(prisma.charge.findFirst).mockResolvedValue({
        id: 'charge-1',
        status: 'OPEN',
      } as never);
      vi.mocked(handlePaymentWebhook).mockResolvedValue({ success: true } as never);
      const alert = vi.spyOn(alertService, 'alertReconciliationDrift').mockResolvedValue();

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 1, maxPages: 1 });

      expect(result.complete).toBe(false);
      expect(result.asaasPaymentsScanned).toBe(1);
      expect(result.reconciled).toBe(1);
      expect(result.errors).toContain('listPayments:pagination_incomplete:max_pages_reached:1');
      expect(listPayments).toHaveBeenCalledTimes(1);
      expect(prisma.charge.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contaId: 'conta-A', asaasPaymentId: 'pay-1' }),
      }));
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it('bloqueia complete quando o mesmo payment aparece em páginas diferentes', async () => {
      vi.mocked(listPayments)
        .mockResolvedValueOnce({
          object: 'list', totalCount: 2, offset: 0, limit: 1, hasMore: true,
          data: [{ id: 'pay-repeat', status: 'PENDING', value: 20, netValue: 20 }],
        } as never)
        .mockResolvedValueOnce({
          object: 'list', totalCount: 2, offset: 1, limit: 1, hasMore: false,
          data: [{ id: 'pay-repeat', status: 'CONFIRMED', value: 20, netValue: 20 }],
        } as never);
      const alert = vi.spyOn(alertService, 'alertReconciliationDrift').mockResolvedValue();

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 1 });

      expect(result.complete).toBe(false);
      expect(result.errors).toContain('listPayments:page1:repeated_or_invalid_payment_id');
      expect(result.asaasPaymentsScanned).toBe(1);
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it('não envia resumo agregado quando paginação completa contém erro ao processar um item', async () => {
      vi.mocked(listPayments).mockResolvedValue({
        object: 'list', totalCount: 1, offset: 0, limit: 10, hasMore: false,
        data: [{ id: 'pay-item-error', status: 'CONFIRMED', value: 20, netValue: 20 }],
      } as never);
      vi.mocked(prisma.charge.findFirst).mockRejectedValueOnce(new Error('local read failed'));
      const alert = vi.spyOn(alertService, 'alertReconciliationDrift').mockResolvedValue();

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 10 });

      expect(result.complete).toBe(false);
      expect(result.errors).toContain('check:pay-item-error:local read failed');
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });

    it.each([
      ['resposta inválida', { object: 'list', data: [], offset: 0, limit: 10 }],
      ['falha de listagem', new Error('provider unavailable')],
    ])('retorna complete=false e não alerta com %s', async (_label, outcome) => {
      if (outcome instanceof Error) {
        vi.mocked(listPayments).mockRejectedValueOnce(outcome);
      } else {
        vi.mocked(listPayments).mockResolvedValueOnce(outcome as never);
      }
      const alert = vi.spyOn(alertService, 'alertReconciliationDrift').mockResolvedValue();

      const result = await reconcileBilateral({ contaId: 'conta-A', pageSize: 10 });

      expect(result.complete).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(alert).not.toHaveBeenCalled();
      alert.mockRestore();
    });
  });

  describe('getWebhookDetails tenant scope', () => {
    it('escopa a cobrança relacionada por conta e matrícula', async () => {
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValueOnce({
        id: 'webhook-a',
        contaId: 'conta-a',
        asaasPaymentId: 'pay-a',
        asaasSubscriptionId: null,
      } as never);
      vi.mocked(prisma.cobranca.findFirst).mockResolvedValueOnce({ id: 'cobranca-a', status: 'PAGO' } as never);

      const result = await getWebhookDetails('conta-a', 'webhook-a');

      expect(result.relatedCharge).toEqual({ id: 'cobranca-a', status: 'PAGO' });
      expect(prisma.cobranca.findFirst).toHaveBeenCalledWith({
        where: {
          contaId: 'conta-a',
          asaasPaymentId: 'pay-a',
          matricula: { contaId: 'conta-a', aluno: { contaId: 'conta-a' } },
        },
        select: { id: true, status: true },
      });
    });
  });

  describe('getWebhookMetrics', () => {
    it('deve calcular métricas corretamente', async () => {
      const mockWebhooks = [
        { status: 'PROCESSADO', evento: 'PAYMENT_CONFIRMED', duracaoMs: 100, processadoEm: new Date() },
        { status: 'PROCESSADO', evento: 'PAYMENT_CONFIRMED', duracaoMs: 200, processadoEm: new Date() },
        { status: 'ERRO', evento: 'PAYMENT_CREATED', duracaoMs: 50, processadoEm: null },
        { status: 'PROCESSADO', evento: 'PAYMENT_OVERDUE', duracaoMs: 150, processadoEm: new Date() },
      ];

      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue(mockWebhooks as never);

      const result = await getWebhookMetrics('conta-1', 7);

      expect(result.total).toBe(4);
      expect(result.byStatus).toEqual({
        PROCESSADO: 3,
        ERRO: 1,
      });
      expect(result.byEvent).toEqual({
        PAYMENT_CONFIRMED: 2,
        PAYMENT_CREATED: 1,
        PAYMENT_OVERDUE: 1,
      });
      expect(result.errorRate).toBe(0.25);
      expect(result.avgDurationMs).toBe(125);
    });

    it('deve retornar métricas vazias quando não há webhooks', async () => {
      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([]);

      const result = await getWebhookMetrics('conta-1', 7);

      expect(result.total).toBe(0);
      expect(result.byStatus).toEqual({});
      expect(result.byEvent).toEqual({});
      expect(result.errorRate).toBe(0);
      expect(result.avgDurationMs).toBeNull();
    });
  });

  describe('listWebhooks', () => {
    it('deve listar webhooks com paginação', async () => {
      const mockWebhooks = [
        {
          id: 'wh-1',
          evento: 'PAYMENT_CONFIRMED',
          eventId: 'evt-1',
          status: 'PROCESSADO',
          recebidoEm: new Date(),
          processadoEm: new Date(),
          duracaoMs: 100,
          tentativas: 1,
          ultimoErro: null,
          asaasPaymentId: 'pay_123',
          asaasSubscriptionId: null,
        },
      ];

      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue(mockWebhooks as never);
      vi.mocked(prisma.webhookAsaas.count).mockResolvedValue(1);

      const result = await listWebhooks('conta-1', { page: 1, pageSize: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('deve aplicar filtros corretamente', async () => {
      vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([]);
      vi.mocked(prisma.webhookAsaas.count).mockResolvedValue(0);

      await listWebhooks('conta-1', {
        status: 'ERRO',
        evento: 'PAYMENT',
        asaasPaymentId: 'pay_123',
      });

      expect(prisma.webhookAsaas.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contaId: 'conta-1',
            status: 'ERRO',
            evento: { contains: 'PAYMENT' },
            asaasPaymentId: 'pay_123',
          }),
        }),
      );
    });
  });
});
