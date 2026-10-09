import { describe, expect, it } from 'vitest';

import {
  isPublicOrderTicketPaymentBlocked,
  publicOrderPaymentStatusLabel,
  publicOrderStatusLabel,
  publicSeatStatusLabel,
  publicSeatTooltip,
} from '@/features/events/map/public/public-order-utils';

describe('public-order-utils', () => {
  it('traduz status para exibição', () => {
    expect(publicOrderStatusLabel('PAYMENT_PENDING')).toBe('Aguardando pagamento');
    expect(publicSeatStatusLabel('AVAILABLE')).toBe('Disponível');
  });

  it('monta tooltip de assento', () => {
    expect(publicSeatTooltip('SOLD', 'A1', 'Plateia')).toContain('Vendido');
    expect(publicSeatTooltip('SOLD', 'A1', 'Plateia')).toContain('A1');
  });

  it('mapeia estados de estorno e contestação e mantém ingressos bloqueados', () => {
    expect(publicOrderPaymentStatusLabel('REFUND_IN_PROGRESS')).toBe('Estornando');
    expect(publicOrderPaymentStatusLabel('IN_DISPUTE')).toBe('Em disputa');
    expect(publicOrderPaymentStatusLabel('DISPUTE_LOST')).toBe('Contestação perdida');
    expect(publicOrderPaymentStatusLabel('DONE')).toBe('Contestação encerrada');
    expect(isPublicOrderTicketPaymentBlocked('DISPUTE_LOST')).toBe(true);
    expect(isPublicOrderTicketPaymentBlocked('DONE')).toBe(true);
    expect(isPublicOrderTicketPaymentBlocked('REVERSED')).toBe(false);
  });
});
