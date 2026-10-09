const BLOCKED_TICKET_PAYMENT_STATUSES = new Set([
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_IN_PROGRESS',
  'REFUNDED',
  'PAYMENT_REFUNDED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'IN_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DISPUTE_LOST',
  'CHARGEBACK',
  'REQUESTED',
  'DONE',
  // Fail closed when the payment provider adds a dispute status the application does not recognize.
  'CHARGEBACK_UNKNOWN',
]);

const CHARGEBACK_PAYMENT_HOLD_STATUSES = new Set([
  'REQUESTED',
  'CHARGEBACK_REQUESTED',
  'IN_DISPUTE',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DISPUTE_LOST',
  'CHARGEBACK',
  'DONE',
  'CHARGEBACK_UNKNOWN',
]);

export function isTicketPaymentBlocked(paymentStatus: string | null | undefined) {
  return BLOCKED_TICKET_PAYMENT_STATUSES.has((paymentStatus ?? '').trim().toUpperCase());
}

export function isEventMapOrderRefundFinalized(
  orderStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
) {
  return orderStatus?.trim().toUpperCase() === 'REFUNDED'
    || ['REFUNDED', 'PAYMENT_REFUNDED'].includes((paymentStatus ?? '').trim().toUpperCase());
}

/** Only an explicit provider reversal can clear a chargeback hold, never a refund hold. */
export function mayResolveChargebackPaymentHold(
  paymentStatus: string | null | undefined,
  chargebackStatus: string | null | undefined,
) {
  return chargebackStatus?.trim().toUpperCase() === 'REVERSED'
    && CHARGEBACK_PAYMENT_HOLD_STATUSES.has((paymentStatus ?? '').trim().toUpperCase());
}
