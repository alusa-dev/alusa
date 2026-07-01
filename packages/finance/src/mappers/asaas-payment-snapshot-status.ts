export type NormalizeAsaasPaymentSnapshotStatusInput = {
  eventName?: string | null;
  status?: string | null;
  billingType?: string | null;
  deleted?: boolean | null;
};

const RECEIVED_IN_CASH_EVENTS = new Set([
  'PAYMENT_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED_IN_CASH',
]);

const RECEIVED_IN_CASH_COMPATIBLE_STATUSES = new Set([
  '',
  'PENDING',
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
]);

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function normalizeAsaasPaymentSnapshotStatus(
  input: NormalizeAsaasPaymentSnapshotStatusInput,
): string | null {
  const status = normalize(input.status);
  const eventName = normalize(input.eventName);
  const billingType = normalize(input.billingType);

  if (input.deleted === true || eventName === 'PAYMENT_DELETED') {
    return 'DELETED';
  }

  if (
    billingType === 'RECEIVED_IN_CASH' &&
    RECEIVED_IN_CASH_COMPATIBLE_STATUSES.has(status) &&
    (RECEIVED_IN_CASH_EVENTS.has(eventName) ||
      (!eventName && ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status)))
  ) {
    return 'RECEIVED_IN_CASH';
  }

  return status || null;
}
