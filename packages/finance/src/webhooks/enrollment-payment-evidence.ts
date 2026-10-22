import { Prisma } from '@prisma/client';

const TERMINAL_ENROLLMENT_PAYMENT_EVENTS = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
  'PAYMENT_DUNNING_RECEIVED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

const TERMINAL_ENROLLMENT_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CHARGEBACK',
  'CHARGEBACK_REQUESTED',
  'DUNNING_RECEIVED',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

export function isTerminalEnrollmentPaymentEvidence(event: string, status: unknown) {
  const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  return TERMINAL_ENROLLMENT_PAYMENT_EVENTS.has(event) || TERMINAL_ENROLLMENT_PAYMENT_STATUSES.has(normalizedStatus);
}

export function findTerminalEnrollmentPaymentEvidence(
  result: Prisma.JsonValue | null,
  knownPaymentIds: Array<string | null>,
): Prisma.JsonObject | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const evidence = (result as Prisma.JsonObject).terminalPaymentEvidence;
  if (!Array.isArray(evidence)) return null;
  const knownIds = new Set(knownPaymentIds.filter((id): id is string => Boolean(id)));
  for (const item of evidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const entry = item as Prisma.JsonObject;
    const paymentId = typeof entry.paymentId === 'string' ? entry.paymentId : null;
    const status = typeof entry.status === 'string' ? entry.status : '';
    const event = typeof entry.event === 'string' ? entry.event : '';
    if (paymentId && knownIds.has(paymentId) && isTerminalEnrollmentPaymentEvidence(event, status)) return entry;
  }
  return null;
}
