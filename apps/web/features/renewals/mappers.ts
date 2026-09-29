import {
  createRematriculaResultDTOSchema,
  listRematriculasResultDTOSchema,
  rematriculaItemDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapRematriculaItemToDTO(record: Record<string, unknown>) {
  return rematriculaItemDTOSchema.parse(record);
}

export function mapListRematriculasResultToDTO(record: Record<string, unknown>) {
  return listRematriculasResultDTOSchema.parse(record);
}

export function mapCreateRematriculaResultToDTO(record: Record<string, unknown>) {
  return createRematriculaResultDTOSchema.parse({
    ...record,
    primeiroVencimento: toIsoString(record.primeiroVencimento as Date | string | undefined) ?? '',
  });
}
