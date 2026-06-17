import { maskCpf } from '@alusa/shared';

import { withResolvedAvatarFields } from '@/lib/media/avatar-url';

import {
  listNotaFiscalPersonIndexResultDTOSchema,
  notaFiscalPessoaDetalheResultDTOSchema,
  notaFiscalPersonIndexItemDTOSchema,
} from '../dtos';

export function mapNotaFiscalPersonIndexItemToDTO(record: {
  id: string;
  tipo: 'ALUNO' | 'RESPONSAVEL';
  nome: string;
  cpf: string | null;
  foto: string | null;
  totalNotas: number;
  notasEmitidas: number;
  valorTotalEmitido: number;
  ultimaNotaEm: string | null;
  statusDestaque: string | null;
}) {
  const avatarKind = record.tipo === 'RESPONSAVEL' ? 'responsavel' : 'aluno';
  const resolved = withResolvedAvatarFields(avatarKind, {
    id: record.id,
    foto: record.foto,
  });

  return notaFiscalPersonIndexItemDTOSchema.parse({
    id: record.id,
    tipo: record.tipo,
    nome: record.nome,
    cpfMasked: record.cpf ? maskCpf(record.cpf) : null,
    avatarUrl: resolved.avatarUrl ?? null,
    totalNotas: record.totalNotas,
    notasEmitidas: record.notasEmitidas,
    valorTotalEmitido: record.valorTotalEmitido,
    ultimaNotaEm: record.ultimaNotaEm,
    statusDestaque: record.statusDestaque,
  });
}

export function mapListNotaFiscalPersonIndexResultToDTO(record: Record<string, unknown>) {
  const data = Array.isArray(record.data) ? record.data : [];
  return listNotaFiscalPersonIndexResultDTOSchema.parse({
    ...record,
    data: data.map((item) => mapNotaFiscalPersonIndexItemToDTO(item as never)),
  });
}

export function mapNotaFiscalPessoaDetalheResultToDTO(record: Record<string, unknown>) {
  const data = record.data as {
    pessoa: {
      id: string;
      tipo: 'ALUNO' | 'RESPONSAVEL';
      nome: string;
      cpf: string | null;
      foto: string | null;
      turmaNome: string | null;
      alunosVinculados: Array<{ id: string; nome: string }>;
      responsavelPrincipal: { id: string; nome: string } | null;
    };
    kpis: Record<string, unknown>;
    notas: Array<Record<string, unknown>>;
  };

  const avatarKind = data.pessoa.tipo === 'RESPONSAVEL' ? 'responsavel' : 'aluno';
  const resolved = withResolvedAvatarFields(avatarKind, {
    id: data.pessoa.id,
    foto: data.pessoa.foto,
  });

  return notaFiscalPessoaDetalheResultDTOSchema.parse({
    success: true,
    data: {
      pessoa: {
        ...data.pessoa,
        cpfMasked: data.pessoa.cpf ? maskCpf(data.pessoa.cpf) : null,
        avatarUrl: resolved.avatarUrl ?? null,
      },
      kpis: data.kpis,
      notas: data.notas,
    },
  });
}

export function resolveNotaFiscalPersonHref(item: { id: string; tipo: 'ALUNO' | 'RESPONSAVEL' }) {
  if (item.tipo === 'RESPONSAVEL') return `/financeiro/nota-fiscal/responsavel/${item.id}`;
  return `/financeiro/nota-fiscal/aluno/${item.id}`;
}

export function resolveCobrancaHref(nota: { cobrancaId: string | null; chargeId: string }) {
  return `/cobrancas/${nota.cobrancaId ?? nota.chargeId}`;
}
