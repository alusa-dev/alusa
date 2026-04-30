import {
  financeInstallmentAggregatedItemDTOSchema,
  financeInstallmentAggregatedResultDTOSchema,
  financePayerCandidateDTOSchema,
  financePayerSearchResultDTOSchema,
  financeSubscriptionEnrichedItemDTOSchema,
  financeSubscriptionEnrichedResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapFinanceInstallmentAggregatedItemToDTO(record: Record<string, unknown>) {
  return financeInstallmentAggregatedItemDTOSchema.parse({
    ...record,
    proximoVencimento: toIsoString(record.proximoVencimento as Date | string | undefined),
    createdAt:
      toIsoString(record.createdAt as Date | string | undefined) ?? new Date(0).toISOString(),
  });
}

export function mapFinanceInstallmentAggregatedResultToDTO(record: Record<string, unknown>) {
  return financeInstallmentAggregatedResultDTOSchema.parse(record);
}

export function mapFinanceSubscriptionEnrichedItemToDTO(record: Record<string, unknown>) {
  return financeSubscriptionEnrichedItemDTOSchema.parse({
    ...record,
    nextDueDate: toIsoString(record.nextDueDate as Date | string | undefined),
    createdAt:
      toIsoString(record.createdAt as Date | string | undefined) ?? new Date(0).toISOString(),
  });
}

export function mapFinanceSubscriptionEnrichedResultToDTO(record: Record<string, unknown>) {
  return financeSubscriptionEnrichedResultDTOSchema.parse(record);
}

export function mapFinancePayerCandidateToDTO(record: Record<string, unknown>) {
  return financePayerCandidateDTOSchema.parse(record);
}

export function mapFinancePayerSearchResultToDTO(record: Record<string, unknown>) {
  return financePayerSearchResultDTOSchema.parse(record);
}
