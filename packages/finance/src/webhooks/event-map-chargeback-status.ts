const STATUS_PRIORITY: Record<string, number> = {
  REQUESTED: 1,
  CHARGEBACK_REQUESTED: 1,
  IN_DISPUTE: 2,
  CHARGEBACK_DISPUTE: 2,
  AWAITING_CHARGEBACK_REVERSAL: 3,
  DONE: 4,
  DISPUTE_LOST: 5,
  CHARGEBACK_UNKNOWN: 5.5,
  REVERSED: 6,
};

const KNOWN_CHARGEBACK_STATUSES = new Set([
  'REQUESTED', 'IN_DISPUTE', 'DISPUTE_LOST', 'REVERSED', 'DONE',
  'AWAITING_CHARGEBACK_REVERSAL', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE',
]);

/** Unknown provider values map to a blocked sentinel; the raw value is audited separately. */
export function normalizeEventMapChargebackStatus(raw: string): {
  paymentStatus: string;
  rawStatus: string;
  known: boolean;
} {
  const rawStatus = raw.trim();
  const normalized = rawStatus.toUpperCase();
  const known = KNOWN_CHARGEBACK_STATUSES.has(normalized);
  return { paymentStatus: known ? normalized : 'CHARGEBACK_UNKNOWN', rawStatus, known };
}

/** Preserve raw Asaas chargeback states while preventing stale event regression. */
export function resolveEventMapChargebackStatus(current: string | null | undefined, incoming: string) {
  const normalizedIncoming = incoming.trim().toUpperCase();
  const normalizedCurrent = (current ?? '').trim().toUpperCase();
  return (STATUS_PRIORITY[normalizedCurrent] ?? 0) > (STATUS_PRIORITY[normalizedIncoming] ?? 0)
    ? normalizedCurrent
    : normalizedIncoming;
}
