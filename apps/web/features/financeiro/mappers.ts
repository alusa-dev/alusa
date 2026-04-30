import {
  financeiroIndicadoresResultDTOSchema,
  financeiroKpisResultDTOSchema,
  financeiroLancamentoCategoriaDTOSchema,
  financeiroLancamentoDTOSchema,
  financeiroLancamentoReciboResultDTOSchema,
  financeiroPagamentoAlunoHistoricoResultDTOSchema,
  financeiroPagamentoDTOSchema,
  financeiroPagamentoSummaryItemDTOSchema,
  financeiroSaldoResultDTOSchema,
  listFinanceiroLancamentoCategoriasResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapFinanceiroKpisResultToDTO(record: Record<string, unknown>) {
  return financeiroKpisResultDTOSchema.parse(record);
}

export function mapFinanceiroIndicadoresResultToDTO(record: Record<string, unknown>) {
  return financeiroIndicadoresResultDTOSchema.parse(record);
}

export function mapFinanceiroSaldoResultToDTO(record: Record<string, unknown>) {
  return financeiroSaldoResultDTOSchema.parse(record);
}

export function mapFinanceiroPagamentoRecordToDTO(record: Record<string, unknown>) {
  return financeiroPagamentoDTOSchema.parse(record);
}

export function mapFinanceiroPagamentoSummaryItemToDTO(record: Record<string, unknown>) {
  return financeiroPagamentoSummaryItemDTOSchema.parse(record);
}

export function mapFinanceiroLancamentoRecordToDTO(record: Record<string, unknown>) {
  return financeiroLancamentoDTOSchema.parse({
    ...record,
    dataEfetiva: toIsoString(record.dataEfetiva as Date | string | undefined),
    dataPrevista: toIsoString(record.dataPrevista as Date | string | undefined),
    dataEstorno: toIsoString(record.dataEstorno as Date | string | undefined),
    createdAt: toIsoString(record.createdAt as Date | string | undefined),
    updatedAt: toIsoString(record.updatedAt as Date | string | undefined),
  });
}

export function mapFinanceiroLancamentoCategoriaToDTO(record: Record<string, unknown>) {
  return financeiroLancamentoCategoriaDTOSchema.parse({
    ...record,
    createdAt: toIsoString(record.createdAt as Date | string | undefined),
    updatedAt: toIsoString(record.updatedAt as Date | string | undefined),
  });
}

export function mapListFinanceiroLancamentoCategoriasResultToDTO(record: Record<string, unknown>) {
  return listFinanceiroLancamentoCategoriasResultDTOSchema.parse(record);
}

export function mapFinanceiroPagamentoAlunoHistoricoResultToDTO(record: Record<string, unknown>) {
  return financeiroPagamentoAlunoHistoricoResultDTOSchema.parse(record);
}

export function mapFinanceiroLancamentoReciboResultToDTO(record: Record<string, unknown>) {
  return financeiroLancamentoReciboResultDTOSchema.parse(record);
}
