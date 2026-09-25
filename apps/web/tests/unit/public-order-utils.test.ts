import { describe, expect, it } from 'vitest';

import {
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
});
