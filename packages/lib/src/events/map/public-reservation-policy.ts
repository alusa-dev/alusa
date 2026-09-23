import type { PublicCheckoutInput } from './event-map.schema';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Keeps abandoned seat selections short-lived, while allowing the buyer enough
 * time to complete the payment method selected at checkout.
 */
export function getPublicReservationExpiration(now: Date, paymentMethod?: PublicCheckoutInput['paymentMethod']) {
  const duration = paymentMethod === 'BOLETO'
    ? 3 * DAY
    : paymentMethod === 'PIX'
      ? 30 * MINUTE
      : paymentMethod === 'CREDIT_CARD'
        ? 2 * 60 * MINUTE
        : 15 * MINUTE;

  return new Date(now.getTime() + duration);
}
