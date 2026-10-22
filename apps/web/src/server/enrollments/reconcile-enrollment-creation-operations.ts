import { reconcileEnrollmentCreationOperations as reconcileEnrollmentCreationFinancialOperations } from '@alusa/finance';

/** Thin app adapter for the finance-owned enrollment creation reconciliation use case. */
export function reconcileEnrollmentCreationOperations(input: {
  contaId?: string | null;
  limit?: number;
  olderThanSeconds?: number;
}) {
  return reconcileEnrollmentCreationFinancialOperations(input);
}
