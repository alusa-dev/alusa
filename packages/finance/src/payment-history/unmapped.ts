import type { PaymentHistoryCategoryInput } from './origin';

export type PaymentHistoryUnmappedReason =
  | 'UNMAPPED_AVULSA'
  | 'UNMAPPED_EXTRA'
  | 'UNMAPPED_STANDALONE'
  | 'UNMAPPED_UNKNOWN';

export function resolvePaymentHistoryUnmappedReason(
  input: PaymentHistoryCategoryInput,
): PaymentHistoryUnmappedReason {
  const tipo = input.tipo?.toUpperCase() ?? null;

  if (tipo === 'EXTRA') return 'UNMAPPED_EXTRA';
  if (tipo === 'AVULSA') return 'UNMAPPED_AVULSA';
  if (input.origin === 'STANDALONE' || input.sourceKind === 'charge') return 'UNMAPPED_STANDALONE';
  return 'UNMAPPED_UNKNOWN';
}

type UnmappedPaymentHistoryLogContext = PaymentHistoryCategoryInput & {
  reason: PaymentHistoryUnmappedReason;
};

let unmappedPaymentHistoryLogger: ((context: UnmappedPaymentHistoryLogContext) => void) | null = null;

export function setPaymentHistoryUnmappedLogger(
  logger: ((context: UnmappedPaymentHistoryLogContext) => void) | null,
): void {
  unmappedPaymentHistoryLogger = logger;
}

export function logUnmappedPaymentHistoryCategory(input: PaymentHistoryCategoryInput): void {
  if (!unmappedPaymentHistoryLogger) return;

  unmappedPaymentHistoryLogger({
    ...input,
    reason: resolvePaymentHistoryUnmappedReason(input),
  });
}
