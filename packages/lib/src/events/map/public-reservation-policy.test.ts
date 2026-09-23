import { describe, expect, it } from 'vitest';

import { getPublicReservationExpiration } from './public-reservation-policy';

describe('getPublicReservationExpiration', () => {
  const now = new Date('2026-09-22T12:00:00.000Z');

  it('expires an uncompleted seat selection after 15 minutes', () => {
    expect(getPublicReservationExpiration(now).toISOString()).toBe('2026-09-22T12:15:00.000Z');
  });

  it.each([
    ['PIX', '2026-09-22T12:30:00.000Z'],
    ['CREDIT_CARD', '2026-09-22T14:00:00.000Z'],
    ['BOLETO', '2026-09-25T12:00:00.000Z'],
  ] as const)('uses a %s-specific payment window', (paymentMethod, expected) => {
    expect(getPublicReservationExpiration(now, paymentMethod).toISOString()).toBe(expected);
  });
});
