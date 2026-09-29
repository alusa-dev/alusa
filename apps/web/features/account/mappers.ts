import {
  contaFinanceOnboardingResultDTOSchema,
  contaFormaPagamentoAssinaturaDTOSchema,
  contaFormaPagamentoProximaCobrancaDTOSchema,
  contaFormaPagamentoResponsavelDTOSchema,
  contaFormaPagamentoResultDTOSchema,
  contaFormaPagamentoSyncResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toPrimitiveNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;

  if (typeof value === 'object') {
    const decimalLike = value as { toNumber?: () => number; toString?: () => string };

    if (typeof decimalLike.toNumber === 'function') {
      return decimalLike.toNumber();
    }

    if (typeof decimalLike.toString === 'function') {
      return decimalLike.toString();
    }
  }

  return value;
}

export function mapContaFinanceOnboardingResultToDTO(record: Record<string, unknown>) {
  const data =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : null;
  const financeProfile =
    data?.financeProfile && typeof data.financeProfile === 'object'
      ? (data.financeProfile as Record<string, unknown>)
      : null;

  return contaFinanceOnboardingResultDTOSchema.parse({
    ...record,
    data: data
      ? {
          ...data,
          financeProfile: financeProfile
            ? {
                ...financeProfile,
                incomeValue: toPrimitiveNumber(financeProfile.incomeValue),
                onboardingCompletedAt: toIsoString(
                  financeProfile.onboardingCompletedAt as Date | string | null | undefined,
                ),
                lastAsaasSyncAt: toIsoString(
                  financeProfile.lastAsaasSyncAt as Date | string | null | undefined,
                ),
                updatedAt:
                  toIsoString(financeProfile.updatedAt as Date | string | null | undefined) ??
                  financeProfile.updatedAt,
                createdAt:
                  toIsoString(financeProfile.createdAt as Date | string | null | undefined) ??
                  financeProfile.createdAt,
              }
            : financeProfile,
        }
      : record.data,
  });
}

export function mapContaFormaPagamentoResponsavelToDTO(record: Record<string, unknown>) {
  return contaFormaPagamentoResponsavelDTOSchema.parse(record);
}

export function mapContaFormaPagamentoProximaCobrancaToDTO(record: Record<string, unknown>) {
  return contaFormaPagamentoProximaCobrancaDTOSchema.parse({
    ...record,
    vencimento: toIsoString(record.vencimento as Date | string | undefined) ?? new Date(0).toISOString(),
  });
}

export function mapContaFormaPagamentoAssinaturaToDTO(record: Record<string, unknown>) {
  return contaFormaPagamentoAssinaturaDTOSchema.parse({
    ...record,
    proximaCobranca:
      record.proximaCobranca && typeof record.proximaCobranca === 'object'
        ? mapContaFormaPagamentoProximaCobrancaToDTO(
            record.proximaCobranca as Record<string, unknown>,
          )
        : null,
  });
}

export function mapContaFormaPagamentoResultToDTO(record: Record<string, unknown>) {
  return contaFormaPagamentoResultDTOSchema.parse({
    responsavel:
      record.responsavel && typeof record.responsavel === 'object'
        ? mapContaFormaPagamentoResponsavelToDTO(record.responsavel as Record<string, unknown>)
        : null,
    assinaturas: Array.isArray(record.assinaturas)
      ? record.assinaturas.map((item) =>
          mapContaFormaPagamentoAssinaturaToDTO(item as Record<string, unknown>),
        )
      : [],
  });
}

export function mapContaFormaPagamentoSyncResultToDTO(record: Record<string, unknown>) {
  return contaFormaPagamentoSyncResultDTOSchema.parse(record);
}
