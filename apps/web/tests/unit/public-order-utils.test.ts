import { describe, expect, it } from 'vitest';

import {
  isTerminalPublicOrderStatus,
  publicOrderStatusLabel,
  publicSeatStatusLabel,
  publicSeatTooltip,
} from '@/features/events/map/public/public-order-utils';

describe('public-order-utils', () => {
  it('identifica status terminais do pedido', () => {
    expect(isTerminalPublicOrderStatus('CONFIRMED')).toBe(true);
    expect(isTerminalPublicOrderStatus('EXPIRED')).toBe(true);
    expect(isTerminalPublicOrderStatus('PAYMENT_PENDING')).toBe(false);
  });

  it('traduz status para exibição', () => {
    expect(publicOrderStatusLabel('PAYMENT_PENDING')).toBe('Aguardando pagamento');
    expect(publicSeatStatusLabel('AVAILABLE')).toBe('Disponível');
  });

  it('monta tooltip de assento', () => {
    expect(publicSeatTooltip('SOLD', 'A1', 'Plateia')).toContain('Vendido');
    expect(publicSeatTooltip('SOLD', 'A1', 'Plateia')).toContain('A1');
  });
});
