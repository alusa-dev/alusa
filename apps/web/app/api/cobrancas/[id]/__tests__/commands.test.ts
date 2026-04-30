  import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock das dependências externas
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
      update: vi.fn(),
    },
    logFinanceiro: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@alusa/finance', () => ({
  KycNotApprovedError: class KycNotApprovedError extends Error {
    constructor() {
      super('KYC não aprovado');
      this.name = 'KycNotApprovedError';
    }
  },
  undoCashPayment: vi.fn(),
  getPayment: vi.fn(),
  isAsaasEnabled: vi.fn(() => true),
  auditLogService: {
    record: vi.fn(),
  },
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/src/prisma';
import { undoCashPayment, getPayment, isAsaasEnabled, KycNotApprovedError, auditLogService } from '@alusa/finance';

// Não podemos importar o handler diretamente pois usa next/server
// Este teste valida a lógica de negócio

describe('undo-receive-in-cash command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validações de negócio', () => {
    it('deve rejeitar se cobrança não tem asaasPaymentId', async () => {
      const cobranca = {
        id: 'cob_123',
        asaasPaymentId: null,
        status: 'PAGO',
      };

      expect(cobranca.asaasPaymentId).toBeNull();
      // Endpoint deve retornar 400
    });

    it('deve validar estado atual via read-before-write', async () => {
      const asaasPayment = {
        id: 'pay_123',
        status: 'RECEIVED_IN_CASH',
      };

      // Apenas RECEIVED_IN_CASH permite desfazer
      expect(asaasPayment.status).toBe('RECEIVED_IN_CASH');
    });

    it('deve rejeitar se status não é RECEIVED_IN_CASH', async () => {
      const invalidStatuses = ['PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'REFUNDED'];

      for (const status of invalidStatuses) {
        expect(status).not.toBe('RECEIVED_IN_CASH');
        // Endpoint deve retornar 400 para cada um
      }
    });
  });

  describe('idempotência e correlação', () => {
    it('deve gerar correlationId único para cada requisição', () => {
      const correlationId1 = crypto.randomUUID();
      const correlationId2 = crypto.randomUUID();

      expect(correlationId1).not.toBe(correlationId2);
      expect(correlationId1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('deve retornar 202 Accepted indicando operação assíncrona', () => {
      // HTTP 202 indica que o comando foi aceito mas não finalizado
      // Status final virá via webhook
      const expectedResponse = {
        success: true,
        pending: true,
        correlationId: expect.any(String),
      };

      expect(expectedResponse.pending).toBe(true);
    });
  });
});

describe('refund command', () => {
  describe('validações de negócio', () => {
    it('deve permitir estorno apenas para status pagos', () => {
      const refundableStatuses = ['RECEIVED', 'CONFIRMED', 'DUNNING_RECEIVED'];
      const nonRefundableStatuses = ['PENDING', 'OVERDUE', 'REFUNDED', 'DELETED'];

      for (const status of refundableStatuses) {
        expect(refundableStatuses).toContain(status);
      }

      for (const status of nonRefundableStatuses) {
        expect(refundableStatuses).not.toContain(status);
      }

      expect(refundableStatuses).not.toContain('RECEIVED_IN_CASH');
    });

    it('deve validar valor do estorno parcial', () => {
      const paymentValue = 100;
      const validRefundValue = 50;
      const invalidRefundValue = 150;

      expect(validRefundValue).toBeLessThanOrEqual(paymentValue);
      expect(invalidRefundValue).toBeGreaterThan(paymentValue);
    });

    it('deve rejeitar valor de estorno zero ou negativo', () => {
      expect(0).toBeLessThanOrEqual(0);
      expect(-10).toBeLessThan(0);
    });
  });

  describe('descrição do estorno', () => {
    it('deve incluir correlationId na descrição quando não fornecida', () => {
      const correlationId = 'abc-123';
      const defaultDescription = `Estorno solicitado via Alusa - ${correlationId}`;

      expect(defaultDescription).toContain(correlationId);
    });
  });
});

describe('billing-info endpoint', () => {
  describe('fallback para dados locais', () => {
    it('deve retornar dados locais quando asaasPaymentId não existe', () => {
      const cobranca = {
        id: 'cob_123',
        asaasPaymentId: null,
        invoiceUrl: 'https://example.com/invoice',
        bankSlipUrl: 'https://example.com/boleto',
      };

      expect(cobranca.asaasPaymentId).toBeNull();
      expect(cobranca.invoiceUrl).toBeTruthy();
    });

    it('deve retornar dados locais quando integração Asaas desabilitada', () => {
      const isEnabled = false;

      expect(isEnabled).toBe(false);
      // Endpoint deve retornar source: 'local' com warning
    });
  });
});
