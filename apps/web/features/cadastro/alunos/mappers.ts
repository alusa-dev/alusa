import {
  alunoDeleteResultDTOSchema,
  alunoDetailDTOSchema,
  alunoListItemDTOSchema,
  listAlunosForResponsavelItemDTOSchema,
} from './dtos';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapAlunoListItemToDTO(record: Record<string, unknown>) {
  return alunoListItemDTOSchema.parse({
    ...record,
    dataConsentimentoImagem: toIsoString(
      record.dataConsentimentoImagem as Date | string | undefined,
    ),
    bolsaDescontoPercent:
      record.bolsaDescontoPercent === null || record.bolsaDescontoPercent === undefined
        ? null
        : Number(record.bolsaDescontoPercent),
    dataInativacao: toIsoString(record.dataInativacao as Date | string | undefined),
  });
}

export function mapAlunoDetailToDTO(record: Record<string, unknown>) {
  return alunoDetailDTOSchema.parse(record);
}

export function mapAlunoForResponsavelToDTO(record: Record<string, unknown>) {
  return listAlunosForResponsavelItemDTOSchema.parse(record);
}

export function mapAlunoDeleteResultToDTO(record: Record<string, unknown>) {
  return alunoDeleteResultDTOSchema.parse(record);
}
