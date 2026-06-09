import { describe, it, expect } from 'vitest';
import type { StatusCobranca } from '@prisma/client';
import {
  validateChargeStatusTransition,
  applyChargeStatusWithMonotonicity,
  getAllowedActionsByChargeStatus,
  isActionAllowed,
  isTerminalStatus,
  isIntermediateStatus,
  CHARGE_ACTION_LABELS,
  type ChargeAction,
} from '../charge-status-guard';

describe('charge-status-guard', () => {
  describe('isTerminalStatus', () => {
    it('deve identificar CANCELADO como terminal', () => {
      expect(isTerminalStatus('CANCELADO')).toBe(true);
    });

    it('deve identificar ESTORNADO como terminal', () => {
      expect(isTerminalStatus('ESTORNADO')).toBe(true);
    });

    it('deve identificar ESTORNADO_PARCIAL como terminal', () => {
      expect(isTerminalStatus('ESTORNADO_PARCIAL')).toBe(true);
    });

    it('não deve identificar PAGO como terminal', () => {
      expect(isTerminalStatus('PAGO')).toBe(false);
    });

    it('não deve identificar PENDENTE como terminal', () => {
      expect(isTerminalStatus('PENDENTE')).toBe(false);
    });

    it('não deve identificar CANCELAMENTO_PENDENTE como terminal', () => {
      expect(isTerminalStatus('CANCELAMENTO_PENDENTE')).toBe(false);
    });
  });

  describe('isIntermediateStatus', () => {
    it('deve identificar CANCELAMENTO_PENDENTE como intermediário', () => {
      expect(isIntermediateStatus('CANCELAMENTO_PENDENTE')).toBe(true);
    });

    it('não deve identificar PENDENTE como intermediário', () => {
      expect(isIntermediateStatus('PENDENTE')).toBe(false);
    });

    it('não deve identificar PAGO como intermediário', () => {
      expect(isIntermediateStatus('PAGO')).toBe(false);
    });
  });

  describe('validateChargeStatusTransition', () => {
    describe('transições permitidas (progressão monotônica)', () => {
      const validTransitions: [StatusCobranca, StatusCobranca][] = [
        // PENDENTE → A_VENCER (progressão: draft → emitida)
        ['PENDENTE', 'A_VENCER'],
        ['PENDENTE', 'PROCESSANDO'],
        ['PENDENTE', 'PAGO'],
        ['PENDENTE', 'ATRASADO'],
        ['PENDENTE', 'CANCELADO'],
        // A_VENCER → estados mais avançados
        ['A_VENCER', 'PROCESSANDO'],
        ['A_VENCER', 'PAGO'],
        ['A_VENCER', 'ATRASADO'],
        ['A_VENCER', 'CANCELADO'],
        ['PROCESSANDO', 'PAGO'],
        ['PROCESSANDO', 'ATRASADO'],
        ['ATRASADO', 'PAGO'],
        ['ATRASADO', 'CANCELADO'],
        ['PAGO', 'ESTORNADO'],
        ['PAGO', 'ESTORNADO_PARCIAL'],
        ['PAGO', 'CANCELAMENTO_PENDENTE'],
        ['CANCELAMENTO_PENDENTE', 'CANCELADO'],
      ];

      it.each(validTransitions)(
        'deve permitir transição de %s para %s',
        (from, to) => {
          const result = validateChargeStatusTransition(from, to);
          expect(result.allowed).toBe(true);
        }
      );
    });

    describe('transições bloqueadas (regressão)', () => {
      const invalidTransitions: [StatusCobranca, StatusCobranca][] = [
        ['A_VENCER', 'PENDENTE'],  // Regressão: emitida → draft
        ['PAGO', 'PENDENTE'],
        ['PAGO', 'A_VENCER'],
        ['ATRASADO', 'PENDENTE'],
        ['ATRASADO', 'A_VENCER'],
        ['CANCELADO', 'PENDENTE'],
        ['CANCELADO', 'PAGO'],
        ['ESTORNADO', 'PAGO'],
        ['PROCESSANDO', 'PENDENTE'],
        ['PROCESSANDO', 'A_VENCER'],
      ];

      it.each(invalidTransitions)(
        'deve bloquear regressão de %s para %s',
        (from, to) => {
          const result = validateChargeStatusTransition(from, to);
          expect(result.allowed).toBe(false);
          expect('reason' in result && result.reason).toBeTruthy();
        }
      );
    });

    describe('status terminal', () => {
      it('deve bloquear qualquer alteração a partir de CANCELADO', () => {
        const result = validateChargeStatusTransition('CANCELADO', 'PAGO');
        expect(result.allowed).toBe(false);
        expect('reason' in result && result.reason).toContain('terminal');
      });

      it('deve bloquear qualquer alteração a partir de ESTORNADO', () => {
        const result = validateChargeStatusTransition('ESTORNADO', 'PENDENTE');
        expect(result.allowed).toBe(false);
        expect('reason' in result && result.reason).toContain('terminal');
      });
    });

    describe('mesmo status', () => {
      it('deve permitir manter o mesmo status (idempotência)', () => {
        const result = validateChargeStatusTransition('PENDENTE', 'PENDENTE');
        expect(result.allowed).toBe(true);
      });
    });
  });

  describe('applyChargeStatusWithMonotonicity', () => {
    it('deve aplicar transição válida', () => {
      const result = applyChargeStatusWithMonotonicity({
        currentStatus: 'PENDENTE',
        nextStatus: 'PAGO',
        origin: 'WEBHOOK',
      });

      expect(result.status).toBe('PAGO');
      expect(result.changed).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it('deve bloquear transição inválida e manter status atual', () => {
      const result = applyChargeStatusWithMonotonicity({
        currentStatus: 'PAGO',
        nextStatus: 'PENDENTE',
        origin: 'MANUAL',
      });

      expect(result.status).toBe('PAGO');
      expect(result.changed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBeTruthy();
    });

    it('deve retornar changed=false para mesmo status', () => {
      const result = applyChargeStatusWithMonotonicity({
        currentStatus: 'ATRASADO',
        nextStatus: 'ATRASADO',
        origin: 'SYNC',
      });

      expect(result.status).toBe('ATRASADO');
      expect(result.changed).toBe(false);
      expect(result.blocked).toBe(false);
    });

    it('deve permitir forceOverride (com cautela)', () => {
      const result = applyChargeStatusWithMonotonicity({
        currentStatus: 'PAGO',
        nextStatus: 'PENDENTE',
        origin: 'SYSTEM',
        forceOverride: true,
      });

      expect(result.status).toBe('PENDENTE');
      expect(result.changed).toBe(true);
      expect(result.blocked).toBe(false);
    });
  });

  describe('getAllowedActionsByChargeStatus', () => {
    describe('A_VENCER', () => {
      it('deve permitir visualizar, confirmar, cancelar e editar', () => {
        const actions = getAllowedActionsByChargeStatus('A_VENCER');
        expect(actions).toContain('VIEW_INVOICE');
        expect(actions).toContain('CONFIRM_CASH_PAYMENT');
        expect(actions).toContain('CANCEL');
        expect(actions).toContain('EDIT');
      });

      it('não deve permitir estorno', () => {
        const actions = getAllowedActionsByChargeStatus('A_VENCER');
        expect(actions).not.toContain('REFUND');
      });
    });

    describe('PAGO', () => {
      it('deve permitir visualizar fatura e estornar', () => {
        const actions = getAllowedActionsByChargeStatus('PAGO');
        expect(actions).toContain('VIEW_INVOICE');
        expect(actions).toContain('REFUND');
      });

      it('não deve permitir confirmar recebimento ou cancelar', () => {
        const actions = getAllowedActionsByChargeStatus('PAGO');
        expect(actions).not.toContain('CONFIRM_CASH_PAYMENT');
        expect(actions).not.toContain('CANCEL');
        expect(actions).not.toContain('EDIT');
      });

      it('deve permitir UNDO_CASH_PAYMENT quando wasReceivedInCash=true', () => {
        const actions = getAllowedActionsByChargeStatus('PAGO', { wasReceivedInCash: true });
        expect(actions).toContain('UNDO_CASH_PAYMENT');
        expect(actions).not.toContain('REFUND');
        expect(actions).toContain('VIEW_INVOICE');
      });

      it('NÃO deve permitir UNDO_CASH_PAYMENT quando wasReceivedInCash=false', () => {
        const actions = getAllowedActionsByChargeStatus('PAGO', { wasReceivedInCash: false });
        expect(actions).not.toContain('UNDO_CASH_PAYMENT');
      });

      it('NÃO deve permitir UNDO_CASH_PAYMENT quando wasReceivedInCash não fornecido', () => {
        const actions = getAllowedActionsByChargeStatus('PAGO');
        expect(actions).not.toContain('UNDO_CASH_PAYMENT');
      });
    });

    describe('PROCESSANDO', () => {
      it('deve permitir apenas visualizar', () => {
        const actions = getAllowedActionsByChargeStatus('PROCESSANDO');
        expect(actions).toContain('VIEW_INVOICE');
        expect(actions).toHaveLength(1);
      });
    });

    describe('CANCELAMENTO_PENDENTE', () => {
      it('deve retornar lista vazia enquanto aguarda confirmação', () => {
        const actions = getAllowedActionsByChargeStatus('CANCELAMENTO_PENDENTE');
        expect(actions).toEqual([]);
      });
    });

    describe('CANCELADO', () => {
      it('deve permitir apenas visualizar fatura', () => {
        const actions = getAllowedActionsByChargeStatus('CANCELADO');
        expect(actions).toEqual(['VIEW_INVOICE']);
      });
    });

    describe('ESTORNADO', () => {
      it('deve permitir apenas visualizar fatura', () => {
        const actions = getAllowedActionsByChargeStatus('ESTORNADO');
        expect(actions).toEqual(['VIEW_INVOICE']);
      });
    });

    describe('ATRASADO', () => {
      it('deve permitir visualizar, confirmar, cancelar e editar', () => {
        const actions = getAllowedActionsByChargeStatus('ATRASADO');
        expect(actions).toContain('VIEW_INVOICE');
        expect(actions).toContain('CONFIRM_CASH_PAYMENT');
        expect(actions).toContain('CANCEL');
        expect(actions).toContain('EDIT');
      });
    });
  });

  describe('isActionAllowed', () => {
    it('deve retornar true para ação permitida', () => {
      expect(isActionAllowed('PENDENTE', 'CONFIRM_CASH_PAYMENT')).toBe(true);
    });

    it('deve retornar false para ação não permitida', () => {
      expect(isActionAllowed('PAGO', 'CONFIRM_CASH_PAYMENT')).toBe(false);
    });

    it('deve retornar false para status terminal sem ações', () => {
      expect(isActionAllowed('CANCELADO', 'CANCEL')).toBe(false);
    });

    it('deve considerar wasReceivedInCash para UNDO_CASH_PAYMENT', () => {
      expect(isActionAllowed('PAGO', 'UNDO_CASH_PAYMENT', { wasReceivedInCash: true })).toBe(true);
      expect(isActionAllowed('PAGO', 'UNDO_CASH_PAYMENT', { wasReceivedInCash: false })).toBe(false);
      expect(isActionAllowed('PAGO', 'UNDO_CASH_PAYMENT')).toBe(false);
    });
  });

  describe('CHARGE_ACTION_LABELS', () => {
    it('deve ter labels para todas as ações', () => {
      const actions: ChargeAction[] = [
        'RESEND_NOTIFICATION',
        'CONFIRM_CASH_PAYMENT',
        'UNDO_CASH_PAYMENT',
        'CANCEL',
        'VIEW_INVOICE',
        'REFUND',
        'EDIT',
      ];

      actions.forEach((action) => {
        expect(CHARGE_ACTION_LABELS[action]).toBeTruthy();
        expect(typeof CHARGE_ACTION_LABELS[action]).toBe('string');
      });
    });
  });
});
