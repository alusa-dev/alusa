import {
  centroCustoDTOSchema,
  centroCustoDeleteResultDTOSchema,
  listCentroCustoResultDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapCentroCustoToDTO(record: Record<string, unknown>) {
  return centroCustoDTOSchema.parse({
    ...record,
    createdAt: toIsoString(record.createdAt as Date | string | undefined),
    updatedAt: toIsoString(record.updatedAt as Date | string | undefined),
  });
}

export function mapListCentroCustoResultToDTO(record: Record<string, unknown>) {
  return listCentroCustoResultDTOSchema.parse(record);
}

export function mapCentroCustoDeleteResultToDTO(record: Record<string, unknown>) {
  return centroCustoDeleteResultDTOSchema.parse(record);
}
