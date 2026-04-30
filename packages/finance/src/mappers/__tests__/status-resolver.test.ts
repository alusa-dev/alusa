import { describe, it, expect } from 'vitest';
import { PAYMENT_STATUSES } from '@alusa/shared';
import {
  getPaymentStatusBadge,
  getLiquidacaoStatusBadge,
  getCobrancaStatusBadge,
  getChargeStatusBadge,
  isTerminalStatus,
  isPaidStatus,
  isDebtStatus,
} from '../status-resolver';

describe('getPaymentStatusBadge', () => {
  it('deve retornar badge correto para PENDING', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.PENDING);
    expect(badge.variant).toBe('warning');
    expect(badge.label).toBe('Pendente');
  });

  it('deve retornar badge correto para CONFIRMED', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.CONFIRMED);
    expect(badge.variant).toBe('success');
    expect(badge.label).toBe('Confirmado');
  });

  it('deve retornar badge correto para OVERDUE', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.OVERDUE);
    expect(badge.variant).toBe('destructive');
    expect(badge.label).toBe('Vencido');
  });

  it('deve retornar badge correto para REFUNDED', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.REFUNDED);
    expect(badge.variant).toBe('secondary');
    expect(badge.label).toBe('Estornado');
  });

  it('deve retornar badge correto para CANCELLED', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.CANCELLED);
    expect(badge.variant).toBe('secondary');
    expect(badge.label).toBe('Cancelado');
  });

  it('deve retornar badge correto para CHARGEBACK', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.CHARGEBACK);
    expect(badge.variant).toBe('destructive');
    expect(badge.label).toBe('Chargeback');
  });

  it('deve retornar badge correto para RECEIVED_IN_CASH', () => {
    const badge = getPaymentStatusBadge(PAYMENT_STATUSES.RECEIVED_IN_CASH);
    expect(badge.variant).toBe('outline');
    expect(badge.label).toBe('Recebido em mãos');
  });
});

describe('getLiquidacaoStatusBadge', () => {
  it('deve retornar badge correto para NAO_APLICAVEL', () => {
    const badge = getLiquidacaoStatusBadge('NAO_APLICAVEL');
    expect(badge.variant).toBe('secondary');
    expect(badge.label).toBe('N/A');
  });

  it('deve retornar badge correto para PENDENTE', () => {
    const badge = getLiquidacaoStatusBadge('PENDENTE');
    expect(badge.variant).toBe('warning');
    expect(badge.label).toBe('Pendente');
  });

  it('deve retornar badge correto para DISPONIVEL', () => {
    const badge = getLiquidacaoStatusBadge('DISPONIVEL');
    expect(badge.variant).toBe('success');
    expect(badge.label).toBe('Disponível');
  });
});

describe('getCobrancaStatusBadge', () => {
  it('deve retornar badge correto para A_VENCER', () => {
    const badge = getCobrancaStatusBadge('A_VENCER');
    expect(badge.variant).toBe('default');
    expect(badge.label).toBe('A vencer');
  });

  it('deve retornar badge correto para PAGO', () => {
    const badge = getCobrancaStatusBadge('PAGO');
    expect(badge.variant).toBe('success');
    expect(badge.label).toBe('Pago');
  });

  it('deve retornar badge correto para ATRASADO', () => {
    const badge = getCobrancaStatusBadge('ATRASADO');
    expect(badge.variant).toBe('destructive');
    expect(badge.label).toBe('Atrasado');
  });

  it('deve retornar fallback para status desconhecido', () => {
    const badge = getCobrancaStatusBadge('UNKNOWN');
    expect(badge.variant).toBe('default');
    expect(badge.label).toBe('UNKNOWN');
  });
});

describe('getChargeStatusBadge', () => {
  it('deve retornar badge correto para CREATED', () => {
    const badge = getChargeStatusBadge('CREATED');
    expect(badge.variant).toBe('default');
    expect(badge.label).toBe('Criada');
  });

  it('deve retornar badge correto para PAID', () => {
    const badge = getChargeStatusBadge('PAID');
    expect(badge.variant).toBe('success');
    expect(badge.label).toBe('Pago');
  });

  it('deve retornar fallback para status desconhecido', () => {
    const badge = getChargeStatusBadge('UNKNOWN');
    expect(badge.variant).toBe('default');
    expect(badge.label).toBe('UNKNOWN');
  });
});

describe('isTerminalStatus', () => {
  it('deve retornar true para status terminais', () => {
    expect(isTerminalStatus(PAYMENT_STATUSES.REFUNDED)).toBe(true);
    expect(isTerminalStatus(PAYMENT_STATUSES.CANCELLED)).toBe(true);
    expect(isTerminalStatus(PAYMENT_STATUSES.CHARGEBACK)).toBe(true);
  });

  it('deve retornar false para status não-terminais', () => {
    expect(isTerminalStatus(PAYMENT_STATUSES.PENDING)).toBe(false);
    expect(isTerminalStatus(PAYMENT_STATUSES.CONFIRMED)).toBe(false);
    expect(isTerminalStatus(PAYMENT_STATUSES.OVERDUE)).toBe(false);
    expect(isTerminalStatus(PAYMENT_STATUSES.RECEIVED_IN_CASH)).toBe(false);
  });
});

describe('isPaidStatus', () => {
  it('deve retornar true para status de pagamento recebido', () => {
    expect(isPaidStatus(PAYMENT_STATUSES.CONFIRMED)).toBe(true);
    expect(isPaidStatus(PAYMENT_STATUSES.RECEIVED_IN_CASH)).toBe(true);
  });

  it('deve retornar false para status sem pagamento', () => {
    expect(isPaidStatus(PAYMENT_STATUSES.PENDING)).toBe(false);
    expect(isPaidStatus(PAYMENT_STATUSES.OVERDUE)).toBe(false);
    expect(isPaidStatus(PAYMENT_STATUSES.REFUNDED)).toBe(false);
    expect(isPaidStatus(PAYMENT_STATUSES.CANCELLED)).toBe(false);
  });
});

describe('isDebtStatus', () => {
  it('deve retornar true para status de dívida', () => {
    expect(isDebtStatus(PAYMENT_STATUSES.PENDING)).toBe(true);
    expect(isDebtStatus(PAYMENT_STATUSES.OVERDUE)).toBe(true);
  });

  it('deve retornar false para status sem dívida', () => {
    expect(isDebtStatus(PAYMENT_STATUSES.CONFIRMED)).toBe(false);
    expect(isDebtStatus(PAYMENT_STATUSES.REFUNDED)).toBe(false);
    expect(isDebtStatus(PAYMENT_STATUSES.CANCELLED)).toBe(false);
    expect(isDebtStatus(PAYMENT_STATUSES.RECEIVED_IN_CASH)).toBe(false);
  });
});
