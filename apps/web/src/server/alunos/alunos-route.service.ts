import { Status } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { isMenorDeIdade } from '@alusa/domain';
import { maskCpf as privacyMaskCpf } from '@alusa/shared';
import { createAluno, updateAluno } from '@alusa/lib/alunos/aluno.service';
import { formatZodErrors } from '@alusa/lib/alunos/aluno.schema';
import {
  assertPayerAddressFiscalReady,
  buildResponsavelEnderecoFromFlat,
} from '@alusa/lib/responsaveis/payer-address';
import { createAlunoInputDTOSchema } from '@/features/cadastro/alunos/dtos';
import { normalizeAvatarUpload } from '@/src/server/media/avatar-storage.service';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';

const statusValues = new Set(Object.values(Status));

export type AlunoListQuery = {
  q: string;
  includeFullCpf: boolean;
  status: Status | 'TODOS';
  page: number;
  pageSize: number;
  sortOrder: 'asc' | 'desc';
};

export function parseAlunoListQuery(searchParams: URLSearchParams): AlunoListQuery {
  const requestedStatus = (searchParams.get('status') || 'ATIVO').trim().toUpperCase();
  const status = requestedStatus === 'TODOS'
    ? 'TODOS'
    : statusValues.has(requestedStatus as Status)
      ? requestedStatus as Status
      : 'ATIVO';
  const pageParam = searchParams.get('page');
  const page = pageParam ? Math.max(1, Number(pageParam) || 1) : 1;
  const pageSize = Math.min(
    100,
    Math.max(1, Number(searchParams.get('pageSize') || (pageParam ? '6' : '100')) || 6),
  );

  return {
    q: (searchParams.get('q') || '').trim().toLowerCase(),
    includeFullCpf: searchParams.get('includeFullCpf') === 'true',
    status,
    page,
    pageSize,
    sortOrder: searchParams.get('sortOrder') === 'DESC' ? 'desc' : 'asc',
  };
}

export async function listAlunosForTenant(params: {
  tx: TenantTransactionClient;
  contaId: string;
  query: AlunoListQuery;
}) {
  const { query } = params;
  const cpfSearch = query.q.replace(/\D/g, '');
  const where: Prisma.AlunoWhereInput = {
    contaId: params.contaId,
    ...(query.status !== 'TODOS' ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { nome: { contains: query.q, mode: 'insensitive' } },
            ...(cpfSearch ? [{ cpf: { contains: cpfSearch } }] : []),
          ],
        }
      : {}),
  };

  const [total, alunos] = await Promise.all([
    params.tx.aluno.count({ where }),
    params.tx.aluno.findMany({
      where,
      orderBy: { nome: query.sortOrder },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        status: true,
        foto: true,
        updatedAt: true,
        cpf: true,
        dataNasc: true,
        consentimentoImagem: true,
        dataConsentimentoImagem: true,
        isentoTaxaMatricula: true,
        bolsaDescontoPercent: true,
        tags: true,
        dataInativacao: true,
        motivoInativacao: true,
        responsaveis: {
          select: {
            tipoVinculo: true,
            responsavel: {
              select: {
                cpf: true,
                email: true,
                telefone: true,
                financeiro: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: alunos.map((aluno) => {
      const menor = isMenorDeIdade(aluno.dataNasc);
      let cpf = aluno.cpf;
      let email = aluno.email;
      let telefone = aluno.telefone;

      if (menor && aluno.responsaveis.length > 0) {
        const responsavel = aluno.responsaveis.find(
          (item) => item.responsavel.financeiro || item.tipoVinculo === 'FINANCEIRO' || item.tipoVinculo === 'PRINCIPAL',
        ) || aluno.responsaveis[0];
        cpf = responsavel.responsavel.cpf ?? aluno.cpf;
        email = responsavel.responsavel.email ?? aluno.email;
        telefone = responsavel.responsavel.telefone ?? aluno.telefone;
      }

      const cpfMasked = cpf ? privacyMaskCpf(cpf) : null;
      return {
        id: aluno.id,
        nome: aluno.nome ?? '',
        email,
        telefone,
        cpfMasked,
        status: aluno.status ?? 'ATIVO',
        foto: aluno.foto ?? null,
        updatedAt: aluno.updatedAt,
        cpf: query.includeFullCpf ? cpf : cpfMasked,
        consentimentoImagem: aluno.consentimentoImagem ?? null,
        dataConsentimentoImagem: aluno.dataConsentimentoImagem?.toISOString() ?? null,
        isentoTaxaMatricula: aluno.isentoTaxaMatricula ?? null,
        bolsaDescontoPercent: aluno.bolsaDescontoPercent == null ? null : Number(aluno.bolsaDescontoPercent),
        tags: Array.isArray(aluno.tags) ? aluno.tags : null,
        dataInativacao: aluno.dataInativacao?.toISOString() ?? null,
        motivoInativacao: aluno.motivoInativacao ?? null,
      };
    }),
  };
}

type RawAlunoPayload = Record<string, unknown>;

function isRecord(value: unknown): value is RawAlunoPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digits(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\D/g, '');
  return normalized || undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return tags.length ? tags : undefined;
  }

  if (typeof value === 'string') {
    const tags = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return tags.length ? tags : undefined;
  }

  return undefined;
}

function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? new Date(value) : value instanceof Date ? value : undefined;
}

export function prepareAlunoCreateInput(rawInput: unknown, contaId: string) {
  const raw = isRecord(rawInput) ? rawInput : {};
  const cep = digits(raw.enderecoCep);
  const numero = optionalString(raw.enderecoNumero);
  const endereco = cep && numero
    ? {
        cep,
        logradouro: optionalString(raw.enderecoLogradouro),
        numero,
        complemento: optionalString(raw.enderecoComplemento),
        bairro: optionalString(raw.enderecoBairro),
        cidade: optionalString(raw.enderecoCidade),
        uf: optionalString(raw.enderecoUf)?.slice(0, 2).toUpperCase(),
      }
    : undefined;

  const rawResponsavel = isRecord(raw.responsavel) ? raw.responsavel : undefined;
  const responsavel = rawResponsavel
    ? (() => {
        const nestedEndereco = buildResponsavelEnderecoFromFlat({
          enderecoCep: optionalString(rawResponsavel.enderecoCep),
          enderecoLogradouro: optionalString(rawResponsavel.enderecoLogradouro),
          enderecoNumero: optionalString(rawResponsavel.enderecoNumero),
          enderecoComplemento: optionalString(rawResponsavel.enderecoComplemento),
          enderecoBairro: optionalString(rawResponsavel.enderecoBairro),
          enderecoCidade: optionalString(rawResponsavel.enderecoCidade),
          enderecoUf: optionalString(rawResponsavel.enderecoUf),
        });
        return {
          ...rawResponsavel,
          cpf: digits(rawResponsavel.cpf),
          telefone: digits(rawResponsavel.telefone),
          endereco: nestedEndereco && (rawResponsavel.financeiro ?? true)
            ? assertPayerAddressFiscalReady(nestedEndereco)
            : nestedEndereco ?? undefined,
        };
      })()
    : undefined;

  return createAlunoInputDTOSchema.parse({
    contaId,
    nome: raw.nome,
    nomeSocial: optionalString(raw.nomeSocial),
    dataNasc: optionalDate(raw.dataNasc),
    cpf: digits(raw.cpf),
    email: optionalString(raw.email),
    telefone: digits(raw.telefone),
    endereco,
    observacao: optionalString(raw.observacao),
    genero: optionalString(raw.genero),
    modalidadePrincipal: optionalString(raw.modalidadePrincipal),
    nivel: optionalString(raw.nivel),
    alergias: optionalString(raw.alergias),
    restricoesMedicas: optionalString(raw.restricoesMedicas),
    contatoEmergenciaNome: optionalString(raw.contatoEmergenciaNome),
    contatoEmergenciaTelefone: digits(raw.contatoEmergenciaTelefone),
    origemCadastro: optionalString(raw.origemCadastro),
    bolsaDescontoPercent: raw.bolsaDescontoPercent,
    isentoTaxaMatricula: raw.isentoTaxaMatricula,
    consentimentoImagem: raw.consentimentoImagem,
    dataConsentimentoImagem: optionalDate(raw.dataConsentimentoImagem),
    consentimentoComunicacoes: raw.consentimentoComunicacoes,
    consentimentoMarketing: raw.consentimentoMarketing,
    tamanhoCamiseta: optionalString(raw.tamanhoCamiseta),
    tamanhoCalcado: optionalString(raw.tamanhoCalcado),
    tags: optionalTags(raw.tags),
    status: raw.status || 'ATIVO',
    responsavelExistenteId: optionalString(raw.responsavelExistenteId),
    responsavel,
    foto: optionalString(raw.foto),
  });
}

export async function createAlunoForTenant(params: { rawInput: unknown; contaId: string }) {
  const parsed = prepareAlunoCreateInput(params.rawInput, params.contaId);
  let aluno = await createAluno(parsed);

  if (parsed.foto?.startsWith('data:image/')) {
    const normalizedFoto = await normalizeAvatarUpload({
      entity: 'aluno',
      entityId: aluno.id,
      contaId: params.contaId,
      foto: parsed.foto,
      previousFoto: null,
    });
    if (normalizedFoto && normalizedFoto !== parsed.foto) {
      aluno = await updateAluno({ id: aluno.id, contaId: params.contaId, foto: normalizedFoto });
    }
  }

  return aluno;
}

export { formatZodErrors };
