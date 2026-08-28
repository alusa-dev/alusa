import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    charge: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    cobranca: {
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
    sale: {
      findMany: vi.fn(),
    },
    webhookAsaas: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
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
}));

vi.mock('../../foundation/asaas-read-intent', () => ({
  recordAsaasReadIntent: vi.fn(),
}));

import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getPayment, getSubscription } from '@alusa/asaas';
import { handlePaymentWebhook } from '../payment-webhook-handler';
import { handleSubscriptionWebhook } from '../subscription-webhook-handler';
import { upsertFinanceReconciliationIssue } from '../../reconciliation/finance-reconciliation-issue.service';
import {
  detectWebhookGaps,
  getWebhookMetrics,
  isProviderCheckDue,
  listWebhooks,
  reconcileWithAsaas,
} from '../webhook-reconciliation.service';

describe('webhook-reconciliation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
    vi.mocked(prisma.billingAgreement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.installmentPlan.findMany).mockResolvedValue([]);
    vi.mocked(prisma.standaloneInstallmentPlan.findMany).mockResolvedValue([]);
    vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
    vi.mocked(prisma.webhookAsaas.findMany).mockResolvedValue([]);
    vi.mocked(prisma.charge.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.cobranca.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.subscription.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.installmentPlan.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.standaloneInstallmentPlan.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(loadAsaasCredentials).mockResolvedValue({ apiKey: 'test-key' } as never);
    vi.mocked(handlePaymentWebhook).mockResolvedValue({ success: true } as never);
    vi.mocked(handleSubscriptionWebhook).mockResolvedValue({ success: true });
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
      expect(prisma.charge.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastProviderCheckAt: null },
            { lastProviderCheckAt: expect.objectContaining({ lte: expect.any(Date) }) },
          ],
        }),
      }));
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

      expect(result.checkedPayments).toBe(1);
      expect(result.paymentDrift).toBe(0);
      expect(getPayment).not.toHaveBeenCalled();
      expect(handlePaymentWebhook).not.toHaveBeenCalled();
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
