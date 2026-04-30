import {
  cobrancaDetailResultDTOSchema,
  cobrancaActionResultDTOSchema,
  cobrancaArquivoDTOSchema,
  cobrancaNotifyResultDTOSchema,
  cobrancaUpdateFormaPagamentoResultDTOSchema,
  cobrancaMutationResultDTOSchema,
  createLegacyCobrancaResultDTOSchema,
  deleteCobrancaArquivoResultDTOSchema,
  financeiroCobrancaCancelResultDTOSchema,
  financeiroCobrancaListItemDTOSchema,
  legacyCobrancaListItemDTOSchema,
  listCobrancaArquivosResultDTOSchema,
  listFinanceiroCobrancasResultDTOSchema,
  listLegacyCobrancasResultDTOSchema,
  uploadCobrancaArquivoResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapFinanceiroCobrancaListItemToDTO(record: Record<string, unknown>) {
  return financeiroCobrancaListItemDTOSchema.parse({
    ...record,
    vencimento: toIsoString(record.vencimento as Date | string | undefined),
  });
}

export function mapListFinanceiroCobrancasResultToDTO(record: Record<string, unknown>) {
  return listFinanceiroCobrancasResultDTOSchema.parse(record);
}

export function mapLegacyCobrancaListItemToDTO(record: Record<string, unknown>) {
  return legacyCobrancaListItemDTOSchema.parse({
    ...record,
    vencimento: toIsoString(record.vencimento as Date | string | undefined) ?? new Date(0).toISOString(),
  });
}

export function mapListLegacyCobrancasResultToDTO(record: Record<string, unknown>) {
  return listLegacyCobrancasResultDTOSchema.parse(record);
}

export function mapCreateLegacyCobrancaResultToDTO(record: Record<string, unknown>) {
  return createLegacyCobrancaResultDTOSchema.parse(record);
}

export function mapCobrancaDetailResultToDTO(record: Record<string, unknown>) {
  return cobrancaDetailResultDTOSchema.parse(record);
}

export function mapCobrancaMutationResultToDTO(record: Record<string, unknown>) {
  return cobrancaMutationResultDTOSchema.parse(record);
}

export function mapFinanceiroCobrancaCancelResultToDTO(record: Record<string, unknown>) {
  return financeiroCobrancaCancelResultDTOSchema.parse(record);
}

export function mapCobrancaArquivoToDTO(record: Record<string, unknown>) {
  return cobrancaArquivoDTOSchema.parse({
    ...record,
    createdAt: toIsoString(record.createdAt as Date | string | undefined),
    updatedAt: toIsoString(record.updatedAt as Date | string | undefined),
  });
}

export function mapListCobrancaArquivosResultToDTO(record: Record<string, unknown>) {
  return listCobrancaArquivosResultDTOSchema.parse(record);
}

export function mapUploadCobrancaArquivoResultToDTO(record: Record<string, unknown>) {
  return uploadCobrancaArquivoResultDTOSchema.parse(record);
}

export function mapDeleteCobrancaArquivoResultToDTO(record: Record<string, unknown>) {
  return deleteCobrancaArquivoResultDTOSchema.parse(record);
}

export function mapCobrancaNotifyResultToDTO(record: Record<string, unknown>) {
  return cobrancaNotifyResultDTOSchema.parse(record);
}

export function mapCobrancaUpdateFormaPagamentoResultToDTO(record: Record<string, unknown>) {
  return cobrancaUpdateFormaPagamentoResultDTOSchema.parse(record);
}

export function mapCobrancaActionResultToDTO(record: Record<string, unknown>) {
  return cobrancaActionResultDTOSchema.parse(record);
}
