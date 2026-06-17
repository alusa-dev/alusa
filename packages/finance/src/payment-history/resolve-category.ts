import type { PaymentHistoryCategory } from './categories';
import { parseEventChargeExternalReference } from './event-external-reference';
import { isFamilyEnrollmentFeeDescription, paymentHistoryInputToOrigin } from './infer-origin';
import type { PaymentHistoryCategoryInput, PaymentHistoryOrigin } from './origin';
import { logUnmappedPaymentHistoryCategory } from './unmapped';

export function resolvePaymentHistoryCategory(origin: PaymentHistoryOrigin): PaymentHistoryCategory {
  switch (origin.kind) {
    case 'STORE_SALE':
      return 'LOJA';
    case 'EVENT_TICKET_SALE':
    case 'EVENT_PARTICIPANT_FEE':
    case 'EVENT_FINANCIAL_ENTRY':
    case 'EVENT_MAP_ORDER':
      return 'EVENTOS';
    case 'ACADEMIC_COBRANCA': {
      const tipo = origin.tipo.toUpperCase();
      if (tipo === 'TAXA_MATRICULA') return 'TAXA_MATRICULA';
      if (tipo === 'MENSALIDADE') return 'MENSALIDADE';
      if (tipo === 'PARCELADA') return 'PARCELAMENTO';
      if (tipo === 'RECORRENTE') return 'ASSINATURA';
      return 'OUTROS';
    }
    case 'STANDALONE_CHARGE': {
      if (origin.familyGroupId && isFamilyEnrollmentFeeDescription(origin.description)) {
        return 'TAXA_MATRICULA';
      }

      if (parseEventChargeExternalReference(origin.externalReference)) {
        return 'EVENTOS';
      }

      if (origin.hasSale) return 'LOJA';

      if (origin.chargeType === 'INSTALLMENT') return 'PARCELAMENTO';
      if (origin.chargeType === 'SUBSCRIPTION') return 'ASSINATURA';

      return 'OUTROS';
    }
    default:
      return 'OUTROS';
  }
}

export function normalizePaymentHistoryCategory(
  item: PaymentHistoryCategoryInput,
): PaymentHistoryCategory {
  if (isFamilyEnrollmentFeeDescription(item.description)) {
    return 'TAXA_MATRICULA';
  }

  const category = resolvePaymentHistoryCategory(paymentHistoryInputToOrigin(item));

  if (category === 'OUTROS') {
    logUnmappedPaymentHistoryCategory(item);
  }

  return category;
}

export function matchesPaymentHistoryCategoryFilter(
  item: PaymentHistoryCategoryInput,
  filter: string,
): boolean {
  if (filter === 'TODOS') return true;
  return normalizePaymentHistoryCategory(item) === filter;
}

export function buildCategorySummary<
  T extends { category: PaymentHistoryCategory; pagamento?: { valorPago: number } | null },
>(items: T[]) {
  const summary = Object.fromEntries(
    (['TAXA_MATRICULA', 'MENSALIDADE', 'PARCELAMENTO', 'ASSINATURA', 'LOJA', 'EVENTOS', 'OUTROS'] as const).map(
      (category) => [category, { count: 0, totalPago: 0 }],
    ),
  ) as Record<PaymentHistoryCategory, { count: number; totalPago: number }>;

  for (const item of items) {
    summary[item.category].count += 1;
    summary[item.category].totalPago += item.pagamento?.valorPago ?? 0;
  }

  return summary;
}
