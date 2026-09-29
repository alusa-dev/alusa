import {
  financeiroIndicadoresResultDTOSchema,
  financeiroKpisResultDTOSchema,
  financeiroLancamentoCategoriaDTOSchema,
  financeiroLancamentoDTOSchema,
  financeiroLancamentoReciboResultDTOSchema,
  financeiroPagamentoAlunoCobrancasResultDTOSchema,
  financeiroPagamentoAlunoHistoricoResultDTOSchema,
  financeiroPagamentoDTOSchema,
  financeiroPagamentoPessoaHistoricoResultDTOSchema,
  financeiroPagamentoPessoaIndexItemDTOSchema,
  financeiroPagamentoSummaryItemDTOSchema,
  financeiroSaldoResultDTOSchema,
  listFinanceiroLancamentoCategoriasResultDTOSchema,
} from './dtos';
import { withResolvedAvatarFields } from '@/lib/media/avatar-url';
import { maskCpf as privacyMaskCpf } from '@alusa/shared';

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
  const id = String(record.id);
  const resolved = withResolvedAvatarFields('aluno', {
    id,
    foto: (record.foto as string | null | undefined) ?? null,
  });

  return financeiroPagamentoSummaryItemDTOSchema.parse({
    ...record,
    ...resolved,
  });
}

export function mapFinanceiroPagamentoPessoaIndexItemToDTO(record: Record<string, unknown>) {
  const id = String(record.id);
  const tipo = record.tipo === 'RESPONSAVEL' ? 'responsavel' : 'aluno';
  const resolved = withResolvedAvatarFields(tipo, {
    id,
    foto: (record.foto as string | null | undefined) ?? null,
  });
  const cpfOriginal = (record.cpf as string | null | undefined) ?? null;
  const cpfMasked = cpfOriginal ? privacyMaskCpf(cpfOriginal) : null;

  return financeiroPagamentoPessoaIndexItemDTOSchema.parse({
    ...record,
    ...resolved,
    alunosVinculados: [],
    cpfMasked,
    cpf: cpfMasked,
  });
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

export function mapFinanceiroPagamentoAlunoCobrancasResultToDTO(record: Record<string, unknown>) {
  const data = record.data as Record<string, unknown> | undefined;
  const aluno = data?.aluno as Record<string, unknown> | undefined;
  const resolvedAluno =
    aluno && typeof aluno.id === 'string'
      ? {
          ...aluno,
          ...withResolvedAvatarFields('aluno', {
            id: aluno.id,
            foto: (aluno.foto as string | null | undefined) ?? null,
          }),
        }
      : aluno;

  return financeiroPagamentoAlunoCobrancasResultDTOSchema.parse({
    ...record,
    data: data
      ? {
          ...data,
          aluno: resolvedAluno,
        }
      : data,
  });
}

export function mapFinanceiroPagamentoPessoaHistoricoResultToDTO(record: Record<string, unknown>) {
  const data = record.data as Record<string, unknown> | undefined;
  const pessoa = data?.pessoa as Record<string, unknown> | undefined;
  const resolvedPessoa =
    pessoa && typeof pessoa.id === 'string'
      ? {
          ...pessoa,
          ...withResolvedAvatarFields(
            pessoa.tipo === 'RESPONSAVEL' ? 'responsavel' : 'aluno',
            {
              id: pessoa.id,
              foto: (pessoa.foto as string | null | undefined) ?? null,
            },
          ),
        }
      : pessoa;

  return financeiroPagamentoPessoaHistoricoResultDTOSchema.parse({
    ...record,
    data: data
      ? {
          ...data,
          pessoa: resolvedPessoa,
        }
      : data,
  });
}

export function mapFinanceiroLancamentoReciboResultToDTO(record: Record<string, unknown>) {
  return financeiroLancamentoReciboResultDTOSchema.parse(record);
}
