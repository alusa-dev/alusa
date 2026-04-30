import { describe, it, expect } from 'vitest';
import {
  canProgressCobrancaStatus,
  canProgressChargeStatus,
  canApplyChargeStatusTransition,
  isCobrancaStatusRegression,
  isChargeStatusRegression,
  getCobrancaPrecedence,
  getChargePrecedence,
  computeNextCobrancaStatus,
  computeNextChargeStatus,
  resolveInternalPaymentStatus,
} from '../status-precedence';

describe('status-precedence', () => {
  describe('canProgressCobrancaStatus', () => {
    it('permite progressão PENDENTE → PAGO', () => {
      expect(canProgressCobrancaStatus('PENDENTE', 'PAGO')).toBe(true);
    });

    it('permite progressão PENDENTE → ATRASADO', () => {
      expect(canProgressCobrancaStatus('PENDENTE', 'ATRASADO')).toBe(true);
    });

    it('permite progressão A_VENCER → PAGO', () => {
      expect(canProgressCobrancaStatus('A_VENCER', 'PAGO')).toBe(true);
    });

    it('permite manter mesmo status PAGO → PAGO', () => {
      expect(canProgressCobrancaStatus('PAGO', 'PAGO')).toBe(true);
    });

    it('bloqueia regressão PAGO → PENDENTE', () => {
      expect(canProgressCobrancaStatus('PAGO', 'PENDENTE')).toBe(false);
    });

    it('bloqueia regressão PAGO → A_VENCER', () => {
      expect(canProgressCobrancaStatus('PAGO', 'A_VENCER')).toBe(false);
    });

    it('bloqueia regressão ESTORNADO → PENDENTE', () => {
      expect(canProgressCobrancaStatus('ESTORNADO', 'PENDENTE')).toBe(false);
    });

    it('bloqueia regressão CANCELADO → PAGO', () => {
      expect(canProgressCobrancaStatus('CANCELADO', 'PAGO')).toBe(false);
    });

    it('permite progressão PAGO → ESTORNADO (estorno é terminal)', () => {
      expect(canProgressCobrancaStatus('PAGO', 'ESTORNADO')).toBe(true);
    });

    it('permite progressão ATRASADO → PAGO', () => {
      expect(canProgressCobrancaStatus('ATRASADO', 'PAGO')).toBe(true);
    });
  });

  describe('isCobrancaStatusRegression', () => {
    it('detecta regressão PAGO → PENDENTE', () => {
      expect(isCobrancaStatusRegression('PAGO', 'PENDENTE')).toBe(true);
    });

    it('não considera regressão PENDENTE → PAGO', () => {
      expect(isCobrancaStatusRegression('PENDENTE', 'PAGO')).toBe(false);
    });
  });

  describe('canProgressChargeStatus', () => {
    it('permite progressão OPEN → PAID', () => {
      expect(canProgressChargeStatus('OPEN', 'PAID')).toBe(true);
    });

    it('bloqueia regressão PAID → OPEN', () => {
      expect(canProgressChargeStatus('PAID', 'OPEN')).toBe(false);
    });

    it('permite progressão PAID → REFUNDED', () => {
      expect(canProgressChargeStatus('PAID', 'REFUNDED')).toBe(true);
    });

    it('bloqueia regressão REFUNDED → PAID', () => {
      expect(canProgressChargeStatus('REFUNDED', 'PAID')).toBe(false);
    });

    it('permite progressão OVERDUE → PAID', () => {
      expect(canProgressChargeStatus('OVERDUE', 'PAID')).toBe(true);
    });
  });

  describe('canApplyChargeStatusTransition', () => {
    it('permite desfazer recebimento em dinheiro de PAID para OPEN', () => {
      expect(canApplyChargeStatusTransition({
        current: 'PAID',
        next: 'OPEN',
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      })).toBe(true);
    });

    it('permite desfazer recebimento em dinheiro de PAID para OVERDUE', () => {
      expect(canApplyChargeStatusTransition({
        current: 'PAID',
        next: 'OVERDUE',
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      })).toBe(true);
    });

    it('continua bloqueando regressão comum de PAID para OPEN', () => {
      expect(canApplyChargeStatusTransition({
        current: 'PAID',
        next: 'OPEN',
        eventName: 'PAYMENT_UPDATED',
      })).toBe(false);
    });
  });

  describe('isChargeStatusRegression', () => {
    it('detecta regressão PAID → OPEN', () => {
      expect(isChargeStatusRegression('PAID', 'OPEN')).toBe(true);
    });

    it('não trata undo de recebimento em dinheiro como regressão inválida', () => {
      expect(isChargeStatusRegression('PAID', 'OPEN', 'PAYMENT_RECEIVED_IN_CASH_UNDONE')).toBe(false);
    });

    it('não considera regressão OPEN → PAID', () => {
      expect(isChargeStatusRegression('OPEN', 'PAID')).toBe(false);
    });
  });

  describe('getCobrancaPrecedence', () => {
    it('retorna precedências em ordem crescente', () => {
      expect(getCobrancaPrecedence('PENDENTE')).toBeLessThan(getCobrancaPrecedence('A_VENCER'));
      expect(getCobrancaPrecedence('A_VENCER')).toBeLessThan(getCobrancaPrecedence('ATRASADO'));
      expect(getCobrancaPrecedence('ATRASADO')).toBeLessThan(getCobrancaPrecedence('PAGO'));
      expect(getCobrancaPrecedence('PAGO')).toBeLessThan(getCobrancaPrecedence('ESTORNADO'));
      expect(getCobrancaPrecedence('ESTORNADO')).toBeLessThan(getCobrancaPrecedence('CANCELADO'));
    });
  });

  describe('getChargePrecedence', () => {
    it('retorna precedências consistentes', () => {
      expect(getChargePrecedence('CREATED')).toBeLessThan(getChargePrecedence('OPEN'));
      expect(getChargePrecedence('OPEN')).toBeLessThan(getChargePrecedence('PAID'));
      expect(getChargePrecedence('PAID')).toBeLessThan(getChargePrecedence('REFUNDED'));
    });
  });

  describe('computeNextCobrancaStatus', () => {
    it('PAYMENT_CREATED + PENDING + vencimento futuro => A_VENCER', () => {
      const { nextStatus, decisionReason } = computeNextCobrancaStatus({
        currentStatus: 'PENDENTE',
        eventName: 'PAYMENT_CREATED',
        asaasPaymentStatus: 'PENDING',
        dueDate: new Date('2030-01-01'),
        now: new Date('2029-12-01'),
      });
      expect(nextStatus).toBe('A_VENCER');
      expect(decisionReason).toBe('ASAAS_STATUS_APPLIED');
    });

    it('PENDING em A_VENCER => mantém A_VENCER (evento fora de ordem)', () => {
      const { nextStatus, decisionReason } = computeNextCobrancaStatus({
        currentStatus: 'A_VENCER',
        eventName: 'PAYMENT_CREATED',
        asaasPaymentStatus: 'PENDING',
        dueDate: new Date('2030-01-01'),
        now: new Date('2029-12-01'),
      });
      expect(nextStatus).toBe('A_VENCER');
      expect(decisionReason).toBe('STATUS_ALREADY_APPLIED');
    });

    it('OVERDUE => ATRASADO', () => {
      const { nextStatus } = computeNextCobrancaStatus({
        currentStatus: 'A_VENCER',
        eventName: 'PAYMENT_OVERDUE',
        asaasPaymentStatus: 'OVERDUE',
      });
      expect(nextStatus).toBe('ATRASADO');
    });

    it('RECEIVED/CONFIRMED => PAGO', () => {
      const confirmed = computeNextCobrancaStatus({
        currentStatus: 'A_VENCER',
        eventName: 'PAYMENT_CONFIRMED',
        asaasPaymentStatus: 'CONFIRMED',
      });
      expect(confirmed.nextStatus).toBe('PAGO');
    });

    it('regressão real => mantém status com decisionReason REGRESSION_BLOCKED', () => {
      const result = computeNextCobrancaStatus({
        currentStatus: 'PAGO',
        eventName: 'PAYMENT_OVERDUE',
        asaasPaymentStatus: 'OVERDUE',
      });
      expect(result.nextStatus).toBe('PAGO');
      expect(result.decisionReason).toBe('REGRESSION_BLOCKED');
    });

    it('permite reversão legítima de PAGO para pendente quando o Asaas desfaz recebimento em dinheiro', () => {
      const result = computeNextCobrancaStatus({
        currentStatus: 'PAGO',
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        asaasPaymentStatus: 'PENDING',
        dueDate: new Date('2030-01-10'),
        now: new Date('2030-01-09'),
      });
      expect(result.nextStatus).toBe('A_VENCER');
      expect(result.decisionReason).toBe('ASAAS_STATUS_APPLIED');
    });

    it('permite reversão legítima de PAGO para ATRASADO quando o Asaas desfaz recebimento em dinheiro com status OVERDUE', () => {
      const result = computeNextCobrancaStatus({
        currentStatus: 'PAGO',
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        asaasPaymentStatus: 'OVERDUE',
      });
      expect(result.nextStatus).toBe('ATRASADO');
      expect(result.decisionReason).toBe('ASAAS_STATUS_APPLIED');
    });

    it('PAYMENT_PARTIALLY_REFUNDED avança cobrança para ESTORNADO_PARCIAL', () => {
      const result = computeNextCobrancaStatus({
        currentStatus: 'PAGO',
        eventName: 'PAYMENT_PARTIALLY_REFUNDED',
        asaasPaymentStatus: 'RECEIVED',
      });

      expect(result.nextStatus).toBe('ESTORNADO_PARCIAL');
      expect(result.decisionReason).toBe('EVENT_FALLBACK_APPLIED');
    });
  });

  describe('computeNextChargeStatus', () => {
    it('PENDING em CREATED → avança para OPEN', () => {
      expect(computeNextChargeStatus({
        currentStatus: 'CREATED',
        internalStatus: 'PENDING',
      })).toBe('OPEN');
    });

    it('PENDING em OPEN → mantém OPEN (não rebaixa)', () => {
      expect(computeNextChargeStatus({
        currentStatus: 'OPEN',
        internalStatus: 'PENDING',
      })).toBe('OPEN');
    });

    it('PENDING em OVERDUE → mantém OVERDUE (não rebaixa)', () => {
      expect(computeNextChargeStatus({
        currentStatus: 'OVERDUE',
        internalStatus: 'PENDING',
      })).toBe('OVERDUE');
    });

    it('CONFIRMED sempre retorna PAID', () => {
      expect(computeNextChargeStatus({
        currentStatus: 'OPEN',
        internalStatus: 'CONFIRMED',
      })).toBe('PAID');
    });

    it('OVERDUE sempre retorna OVERDUE', () => {
      expect(computeNextChargeStatus({
        currentStatus: 'OPEN',
        internalStatus: 'OVERDUE',
      })).toBe('OVERDUE');
    });

    it('permite reversão legítima de PAID para OPEN quando o Asaas desfaz recebimento em dinheiro', () => {
      expect(computeNextChargeStatus({
        currentStatus: 'PAID',
        internalStatus: 'PENDING',
        eventName: 'PAYMENT_RECEIVED_IN_CASH_UNDONE',
      })).toBe('OPEN');
    });
  });

  describe('resolveInternalPaymentStatus', () => {
    it('aplica fallback por evento quando status vem PENDING no webhook de confirmação', () => {
      const status = resolveInternalPaymentStatus({
        eventName: 'PAYMENT_RECEIVED',
        asaasPaymentStatus: 'PENDING',
      });
      expect(status).toBe('CONFIRMED');
    });

    it('aplica RECEIVED_IN_CASH quando billingType indica dinheiro e evento de recebimento', () => {
      const status = resolveInternalPaymentStatus({
        eventName: 'PAYMENT_RECEIVED_IN_CASH',
        asaasPaymentStatus: 'PENDING',
        billingType: 'RECEIVED_IN_CASH',
      });
      expect(status).toBe('RECEIVED_IN_CASH');
    });

    it('mantém mapeamento normal quando status Asaas já veio definitivo', () => {
      const status = resolveInternalPaymentStatus({
        eventName: 'PAYMENT_UPDATED',
        asaasPaymentStatus: 'OVERDUE',
      });
      expect(status).toBe('OVERDUE');
    });

    it('prioriza deleted=true mesmo quando o status ainda vem como PENDING', () => {
      const status = resolveInternalPaymentStatus({
        eventName: 'PAYMENT_UPDATED',
        asaasPaymentStatus: 'PENDING',
        deleted: true,
      });
      expect(status).toBe('CANCELLED');
    });
  });
});
