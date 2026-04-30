import { describe, it, expect } from 'vitest';
import {
  mapAsaasPaymentStatusToCobranca,
  mapAsaasPaymentStatusToCharge,
  ASAAS_TO_COBRANCA_MAP,
} from '../asaas-to-internal';

describe('mapAsaasPaymentStatusToCobranca', () => {
  describe('status de pagamento confirmado', () => {
    it('RECEIVED → PAGO', () => {
      expect(mapAsaasPaymentStatusToCobranca('RECEIVED')).toBe('PAGO');
    });

    it('CONFIRMED → PAGO', () => {
      expect(mapAsaasPaymentStatusToCobranca('CONFIRMED')).toBe('PAGO');
    });

    it('DUNNING_RECEIVED → PAGO', () => {
      expect(mapAsaasPaymentStatusToCobranca('DUNNING_RECEIVED')).toBe('PAGO');
    });

    it('RECEIVED_IN_CASH → PAGO', () => {
      expect(mapAsaasPaymentStatusToCobranca('RECEIVED_IN_CASH')).toBe('PAGO');
    });
  });

  describe('status de vencimento', () => {
    it('OVERDUE → ATRASADO', () => {
      expect(mapAsaasPaymentStatusToCobranca('OVERDUE')).toBe('ATRASADO');
    });

    it('DUNNING_REQUESTED → ATRASADO', () => {
      expect(mapAsaasPaymentStatusToCobranca('DUNNING_REQUESTED')).toBe('ATRASADO');
    });
  });

  describe('status de estorno', () => {
    it('REFUNDED → ESTORNADO', () => {
      expect(mapAsaasPaymentStatusToCobranca('REFUNDED')).toBe('ESTORNADO');
    });

    it('REFUND_IN_PROGRESS → ESTORNADO', () => {
      expect(mapAsaasPaymentStatusToCobranca('REFUND_IN_PROGRESS')).toBe('ESTORNADO');
    });

    it('CHARGEBACK_REQUESTED → ESTORNADO', () => {
      expect(mapAsaasPaymentStatusToCobranca('CHARGEBACK_REQUESTED')).toBe('ESTORNADO');
    });
  });

  describe('status de cancelamento', () => {
    it('DELETED → CANCELADO (terminal)', () => {
      expect(mapAsaasPaymentStatusToCobranca('DELETED')).toBe('CANCELADO');
    });
  });

  describe('status pendente com dueDate', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias no futuro
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 dias no passado
    const today = new Date();

    it('PENDING com vencimento futuro → A_VENCER', () => {
      expect(mapAsaasPaymentStatusToCobranca('PENDING', { dueDate: futureDate })).toBe('A_VENCER');
    });

    it('PENDING com vencimento passado → PENDENTE', () => {
      expect(mapAsaasPaymentStatusToCobranca('PENDING', { dueDate: pastDate })).toBe('PENDENTE');
    });

    it('PENDING sem dueDate → PENDENTE', () => {
      expect(mapAsaasPaymentStatusToCobranca('PENDING')).toBe('PENDENTE');
    });
  });

  describe('status desconhecido', () => {
    it('status desconhecido → PENDENTE (fallback)', () => {
      expect(mapAsaasPaymentStatusToCobranca('UNKNOWN_STATUS' as any)).toBe('PENDENTE');
    });
  });
});

describe('mapAsaasPaymentStatusToCharge', () => {
  it('RECEIVED → PAID', () => {
    expect(mapAsaasPaymentStatusToCharge('RECEIVED')).toBe('PAID');
  });

  it('OVERDUE → OVERDUE', () => {
    expect(mapAsaasPaymentStatusToCharge('OVERDUE')).toBe('OVERDUE');
  });

  it('DELETED → CANCELED', () => {
    expect(mapAsaasPaymentStatusToCharge('DELETED')).toBe('CANCELED');
  });

  it('REFUNDED → REFUNDED', () => {
    expect(mapAsaasPaymentStatusToCharge('REFUNDED')).toBe('REFUNDED');
  });

  it('PENDING → OPEN', () => {
    expect(mapAsaasPaymentStatusToCharge('PENDING')).toBe('OPEN');
  });
});

describe('ASAAS_TO_COBRANCA_MAP', () => {
  it('deve ter todos os status do Asaas mapeados', () => {
    const expectedStatuses = [
      'PENDING',
      'AWAITING_RISK_ANALYSIS',
      'RECEIVED',
      'CONFIRMED',
      'OVERDUE',
      'REFUNDED',
      'REFUND_IN_PROGRESS',
      'REFUND_REQUESTED',
      'CHARGEBACK_REQUESTED',
      'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL',
      'DUNNING_RECEIVED',
      'DUNNING_REQUESTED',
      'RECEIVED_IN_CASH',
      'DELETED',
    ];

    for (const status of expectedStatuses) {
      expect(ASAAS_TO_COBRANCA_MAP).toHaveProperty(status);
    }
  });
});
