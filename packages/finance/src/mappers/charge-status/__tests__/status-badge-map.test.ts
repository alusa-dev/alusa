import { describe, it, expect } from 'vitest';
import {
  getCobrancaStatusBadge,
  getChargeStatusBadge,
  getStatusBadgePresentation,
  getStatusLabel,
  getUnifiedBadgeStatus,
} from '../status-badge-map';
import type { StatusCobranca, ChargeStatus } from '@prisma/client';

describe('getCobrancaStatusBadge', () => {
  it('PAGO → variant success', () => {
    const badge = getCobrancaStatusBadge('PAGO');
    expect(badge.variant).toBe('success');
    expect(badge.badgeType).toBe('CONFIRMED');
    expect(badge.label).toBe('Pago');
  });

  it('ATRASADO → variant danger', () => {
    const badge = getCobrancaStatusBadge('ATRASADO');
    expect(badge.variant).toBe('danger');
    expect(badge.badgeType).toBe('OVERDUE');
  });

  it('PENDENTE → variant warning', () => {
    const badge = getCobrancaStatusBadge('PENDENTE');
    expect(badge.variant).toBe('warning');
    expect(badge.badgeType).toBe('PENDING');
  });

  it('A_VENCER → variant info', () => {
    const badge = getCobrancaStatusBadge('A_VENCER');
    expect(badge.variant).toBe('info');
    expect(badge.label).toBe('A vencer');
  });

  it('CANCELADO → variant neutral', () => {
    const badge = getCobrancaStatusBadge('CANCELADO');
    expect(badge.variant).toBe('neutral');
    expect(badge.badgeType).toBe('CANCELADO');
  });

  it('ESTORNADO → variant neutral', () => {
    const badge = getCobrancaStatusBadge('ESTORNADO');
    expect(badge.variant).toBe('neutral');
    expect(badge.badgeType).toBe('REFUNDED');
  });
});

describe('getChargeStatusBadge', () => {
  it('PAID → variant success', () => {
    const badge = getChargeStatusBadge('PAID');
    expect(badge.variant).toBe('success');
    expect(badge.badgeType).toBe('CONFIRMED');
  });

  it('OVERDUE → variant danger', () => {
    const badge = getChargeStatusBadge('OVERDUE');
    expect(badge.variant).toBe('danger');
  });

  it('CANCELED → variant neutral', () => {
    const badge = getChargeStatusBadge('CANCELED');
    expect(badge.variant).toBe('neutral');
  });
});

describe('getStatusLabel', () => {
  it('retorna rótulos em português com capitalização correta', () => {
    expect(getStatusLabel('PAGO')).toBe('Pago');
    expect(getStatusLabel('A_VENCER')).toBe('A vencer');
    expect(getStatusLabel('ATRASADO')).toBe('Atrasado');
    expect(getStatusLabel('RECEIVED')).toBe('Recebido');
    expect(getStatusLabel('CANCELAMENTO_PENDENTE')).toBe('Cancelamento pendente');
  });
});

describe('getStatusBadgePresentation', () => {
  it('combina label e variante para A_VENCER', () => {
    const badge = getStatusBadgePresentation('A_VENCER');
    expect(badge.label).toBe('A vencer');
    expect(badge.variant).toBe('info');
  });
});

describe('getUnifiedBadgeStatus', () => {
  it('funciona com StatusCobranca', () => {
    expect(getUnifiedBadgeStatus('PAGO')).toBe('CONFIRMED');
    expect(getUnifiedBadgeStatus('ATRASADO')).toBe('OVERDUE');
    expect(getUnifiedBadgeStatus('PENDENTE')).toBe('PENDING');
  });

  it('funciona com ChargeStatus', () => {
    expect(getUnifiedBadgeStatus('PAID')).toBe('CONFIRMED');
    expect(getUnifiedBadgeStatus('OVERDUE')).toBe('OVERDUE');
    expect(getUnifiedBadgeStatus('OPEN')).toBe('PENDING');
  });

  it('funciona com status legados', () => {
    expect(getUnifiedBadgeStatus('CONFIRMADO')).toBe('CONFIRMED');
    expect(getUnifiedBadgeStatus('ESTORNADO')).toBe('REFUNDED');
  });

  it('retorna PENDING para status desconhecido', () => {
    expect(getUnifiedBadgeStatus('UNKNOWN')).toBe('PENDING');
  });
});
