import { describe, it, expect } from 'vitest';
import { PAYMENT_STATUSES } from '@alusa/shared';
import { mapAsaasStatusToInternal, getStatusBadgeConfig } from '../status-mapper';

describe('mapAsaasStatusToInternal', () => {
  describe('status pendentes', () => {
    it('mapeia PENDING para PENDING', () => {
      expect(mapAsaasStatusToInternal('PENDING')).toBe(PAYMENT_STATUSES.PENDING);
    });

    it('mapeia AWAITING_RISK_ANALYSIS para PENDING', () => {
      expect(mapAsaasStatusToInternal('AWAITING_RISK_ANALYSIS')).toBe(PAYMENT_STATUSES.PENDING);
    });
  });

  describe('status pagos/confirmados', () => {
    it('mapeia RECEIVED para CONFIRMED', () => {
      expect(mapAsaasStatusToInternal('RECEIVED')).toBe(PAYMENT_STATUSES.CONFIRMED);
    });

    it('mapeia CONFIRMED para CONFIRMED', () => {
      expect(mapAsaasStatusToInternal('CONFIRMED')).toBe(PAYMENT_STATUSES.CONFIRMED);
    });

    it('mapeia DUNNING_RECEIVED para CONFIRMED', () => {
      expect(mapAsaasStatusToInternal('DUNNING_RECEIVED')).toBe(PAYMENT_STATUSES.CONFIRMED);
    });
  });

  describe('recebido em mãos', () => {
    it('mapeia RECEIVED_IN_CASH para RECEIVED_IN_CASH', () => {
      expect(mapAsaasStatusToInternal('RECEIVED_IN_CASH')).toBe(PAYMENT_STATUSES.RECEIVED_IN_CASH);
    });
  });

  describe('status vencidos', () => {
    it('mapeia OVERDUE para OVERDUE', () => {
      expect(mapAsaasStatusToInternal('OVERDUE')).toBe(PAYMENT_STATUSES.OVERDUE);
    });

    it('mapeia DUNNING_REQUESTED para OVERDUE', () => {
      expect(mapAsaasStatusToInternal('DUNNING_REQUESTED')).toBe(PAYMENT_STATUSES.OVERDUE);
    });
  });

  describe('status estornados', () => {
    it('mapeia REFUNDED para REFUNDED', () => {
      expect(mapAsaasStatusToInternal('REFUNDED')).toBe(PAYMENT_STATUSES.REFUNDED);
    });

    it('mapeia REFUND_IN_PROGRESS para REFUNDED', () => {
      expect(mapAsaasStatusToInternal('REFUND_IN_PROGRESS')).toBe(PAYMENT_STATUSES.REFUNDED);
    });

    it('mapeia REFUND_REQUESTED para REFUNDED', () => {
      expect(mapAsaasStatusToInternal('REFUND_REQUESTED')).toBe(PAYMENT_STATUSES.REFUNDED);
    });
  });

  describe('status chargeback', () => {
    it('mapeia CHARGEBACK_REQUESTED para CHARGEBACK', () => {
      expect(mapAsaasStatusToInternal('CHARGEBACK_REQUESTED')).toBe(PAYMENT_STATUSES.CHARGEBACK);
    });

    it('mapeia CHARGEBACK_DISPUTE para CHARGEBACK', () => {
      expect(mapAsaasStatusToInternal('CHARGEBACK_DISPUTE')).toBe(PAYMENT_STATUSES.CHARGEBACK);
    });

    it('mapeia AWAITING_CHARGEBACK_REVERSAL para CHARGEBACK', () => {
      expect(mapAsaasStatusToInternal('AWAITING_CHARGEBACK_REVERSAL')).toBe(PAYMENT_STATUSES.CHARGEBACK);
    });
  });

  describe('status cancelados', () => {
    it('mapeia DELETED para CANCELLED', () => {
      expect(mapAsaasStatusToInternal('DELETED')).toBe(PAYMENT_STATUSES.CANCELLED);
    });
  });

  describe('status desconhecido', () => {
    it('retorna PENDING como fallback', () => {
      expect(mapAsaasStatusToInternal('UNKNOWN_STATUS')).toBe(PAYMENT_STATUSES.PENDING);
    });
  });
});

describe('getStatusBadgeConfig', () => {
  it('retorna badge para todos os status', () => {
    // Status base
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.PENDING).variant).toBe('warning');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.CONFIRMED).variant).toBe('success');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.OVERDUE).variant).toBe('destructive');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.REFUNDED).variant).toBe('secondary');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.CANCELLED).variant).toBe('secondary');
    
    // Novos status
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.CHARGEBACK).variant).toBe('destructive');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.RECEIVED_IN_CASH).variant).toBe('outline');
  });

  it('retorna labels em português', () => {
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.PENDING).label).toBe('Pendente');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.CONFIRMED).label).toBe('Confirmado');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.CHARGEBACK).label).toBe('Chargeback');
    expect(getStatusBadgeConfig(PAYMENT_STATUSES.RECEIVED_IN_CASH).label).toBe('Recebido em mãos');
  });
});
