import {
  alunoDeleteResultDTOSchema,
  alunoDetailDTOSchema,
  alunoListItemDTOSchema,
  listAlunosForResponsavelItemDTOSchema,
} from './dtos';
import { withResolvedAvatarFields } from '@/lib/media/avatar-url';

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function mapAlunoListItemToDTO(record: Record<string, unknown>) {
  const id = String(record.id);
  const resolved = withResolvedAvatarFields('aluno', {
    id,
    foto: (record.foto as string | null | undefined) ?? null,
    updatedAt: record.updatedAt as Date | string | undefined,
  });

  return alunoListItemDTOSchema.parse({
    ...record,
    ...resolved,
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
  const id = String(record.id);
  const resolved = withResolvedAvatarFields('aluno', {
    id,
    foto: (record.foto as string | null | undefined) ?? null,
    updatedAt: record.updatedAt as Date | string | undefined,
  });

  return alunoDetailDTOSchema.parse({
    ...record,
    ...resolved,
  });
}

export function mapAlunoForResponsavelToDTO(record: Record<string, unknown>) {
  return listAlunosForResponsavelItemDTOSchema.parse(record);
}

export function mapAlunoDeleteResultToDTO(record: Record<string, unknown>) {
  return alunoDeleteResultDTOSchema.parse(record);
}
