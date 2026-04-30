import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma antes de importar o service
vi.mock('@alusa/database', () => ({
  prisma: {
    cobranca: {
      findMany: vi.fn(),
    },
    subscription: {
      findMany: vi.fn(),
    },
    webhookAsaas: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@alusa/database';
import {
  detectWebhookGaps,
  getWebhookMetrics,
  listWebhooks,
} from '../webhook-reconciliation.service';

describe('webhook-reconciliation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectWebhookGaps', () => {
    it('deve retornar cobranças em status não-final sem webhook recente', async () => {
      const mockCharges = [
        {
          id: 'charge-1',
          asaasPaymentId: 'pay_123',
          status: 'ATRASADO',
          dataVencimento: new Date('2026-01-20'),
        },
        {
          id: 'charge-2',
          asaasPaymentId: null,
          status: 'PENDENTE',
          dataVencimento: new Date('2026-01-22'),
        },
      ];

      vi.mocked(prisma.cobranca.findMany).mockResolvedValue(mockCharges as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

      const result = await detectWebhookGaps('conta-1', { windowDays: 7 });

      expect(result.chargesWithMissingFinalStatus).toHaveLength(2);
      expect(result.chargesWithMissingFinalStatus[0].id).toBe('charge-1');
      expect(result.chargesWithMissingFinalStatus[0].lastWebhookAt).toBeNull();
    });

    it('deve filtrar cobranças com webhook recente', async () => {
      const now = new Date();
      const recentWebhookDate = new Date(now);
      recentWebhookDate.setHours(recentWebhookDate.getHours() - 6); // 6 horas atrás

      const mockCharges = [
        {
          id: 'charge-1',
          asaasPaymentId: 'pay_123',
          status: 'ATRASADO',
          dataVencimento: new Date('2026-01-20'),
        },
      ];

      vi.mocked(prisma.cobranca.findMany).mockResolvedValue(mockCharges as never);
      vi.mocked(prisma.webhookAsaas.findFirst).mockResolvedValue({
        recebidoEm: recentWebhookDate,
      } as never);
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);

      const result = await detectWebhookGaps('conta-1', { windowDays: 7 });

      // Cobrança com webhook recente não deve aparecer no gap
      expect(result.chargesWithMissingFinalStatus).toHaveLength(0);
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
      expect(result.avgDurationMs).toBe(125); // (100+200+50+150)/4
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
        })
      );
    });
  });
});
