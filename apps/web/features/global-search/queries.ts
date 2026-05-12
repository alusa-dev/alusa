import { prisma } from '@/lib/prisma';

import {
  GLOBAL_SEARCH_GROUP_LIMIT,
  INTERNAL_ENTITY_ROLES,
} from './constants';
import { globalSearchResultDTOSchema, type GlobalSearchGroupDTO, type GlobalSearchItemDTO } from './dtos';
import { buildPresetSearchGroups } from './presets';

type SearchContext = {
  contaId: string;
  role?: string | null;
};

function compactDescription(...values: Array<string | null | undefined>) {
  const first = values.map((value) => value?.trim()).find(Boolean);
  return first ?? null;
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  }).format(value);
}

function createGroup(key: string, label: string, items: GlobalSearchItemDTO[]): GlobalSearchGroupDTO | null {
  if (items.length === 0) return null;
  return {
    key,
    label,
    total: items.length,
    items,
  };
}

function mapStatus(value: string | null | undefined) {
  return value?.replace(/_/g, ' ').toLowerCase() ?? null;
}

async function searchEntityGroups(query: string, contaId: string) {
  const normalized = query.trim();
  const digits = normalized.replace(/\D/g, '');

  const [alunos, responsaveis, matriculas, cobrancas, contratos] = await Promise.all([
    prisma.aluno.findMany({
      where: {
        contaId,
        OR: [
          { id: { contains: normalized } },
          { nome: { contains: normalized, mode: 'insensitive' } },
          ...(digits ? [{ cpf: { contains: digits } }] : []),
          { email: { contains: normalized, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
      },
      take: GLOBAL_SEARCH_GROUP_LIMIT,
      orderBy: { nome: 'asc' },
    }),
    prisma.responsavel.findMany({
      where: {
        contaId,
        OR: [
          { id: { contains: normalized } },
          { nome: { contains: normalized, mode: 'insensitive' } },
          ...(digits ? [{ cpf: { contains: digits } }, { telefone: { contains: digits } }] : []),
          { email: { contains: normalized, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
      },
      take: GLOBAL_SEARCH_GROUP_LIMIT,
      orderBy: { nome: 'asc' },
    }),
    prisma.matricula.findMany({
      where: {
        aluno: { contaId },
        OR: [
          { id: { contains: normalized } },
          { asaasSubscriptionId: { contains: normalized } },
          { aluno: { nome: { contains: normalized, mode: 'insensitive' } } },
          { responsavelFinanceiro: { nome: { contains: normalized, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        status: true,
        aluno: { select: { nome: true } },
        plano: { select: { nome: true } },
        turma: { select: { nome: true } },
      },
      take: GLOBAL_SEARCH_GROUP_LIMIT,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.cobranca.findMany({
      where: {
        matricula: { aluno: { contaId } },
        OR: [
          { id: { contains: normalized } },
          { asaasPaymentId: { contains: normalized } },
          { descricao: { contains: normalized, mode: 'insensitive' } },
          { matricula: { aluno: { nome: { contains: normalized, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        status: true,
        valor: true,
        asaasPaymentId: true,
        matricula: { select: { aluno: { select: { nome: true } } } },
      },
      take: GLOBAL_SEARCH_GROUP_LIMIT,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.contrato.findMany({
      where: {
        matricula: { aluno: { contaId } },
        OR: [
          { id: { contains: normalized } },
          { tokenPublico: { contains: normalized } },
          { matricula: { aluno: { nome: { contains: normalized, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        status: true,
        matricula: { select: { aluno: { select: { id: true, nome: true } } } },
      },
      take: GLOBAL_SEARCH_GROUP_LIMIT,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return [
    createGroup(
      'alunos',
      'Alunos',
      alunos.map((item) => ({
        type: 'aluno',
        id: item.id,
        title: item.nome,
        description: compactDescription(item.cpf, item.email),
        href: `/alunos/${item.id}`,
      })),
    ),
    createGroup(
      'responsaveis',
      'Responsáveis',
      responsaveis.map((item) => ({
        type: 'responsavel',
        id: item.id,
        title: item.nome,
        description: compactDescription(item.cpf, item.email),
        href: `/responsaveis/${item.id}`,
      })),
    ),
    createGroup(
      'matriculas',
      'Matrículas',
      matriculas.map((item) => ({
        type: 'matricula',
        id: item.id,
        title: item.aluno.nome,
        description: compactDescription(mapStatus(item.status), item.plano?.nome, item.turma?.nome),
        href: `/matriculas/${item.id}`,
      })),
    ),
    createGroup(
      'cobrancas',
      'Cobranças',
      cobrancas.map((item) => ({
        type: 'cobranca',
        id: item.id,
        title: item.asaasPaymentId ?? item.id,
        description: compactDescription(
          item.matricula.aluno.nome,
          mapStatus(item.status),
          formatCurrency(Number(item.valor)),
        ),
        href: `/cobrancas/${item.id}`,
      })),
    ),
    createGroup(
      'contratos',
      'Contratos',
      contratos.map((item) => ({
        type: 'contrato',
        id: item.id,
        title: item.matricula.aluno.nome,
        description: compactDescription(mapStatus(item.status), item.id),
        href: `/contratos/${item.id}`,
      })),
    ),
  ].filter((group): group is GlobalSearchGroupDTO => Boolean(group));
}

export async function searchGlobalApp(query: string, context: SearchContext) {
  const normalizedRole = context.role?.trim().toUpperCase() ?? null;
  const groups: GlobalSearchGroupDTO[] = buildPresetSearchGroups({
    query,
    role: normalizedRole,
  });

  if (normalizedRole && INTERNAL_ENTITY_ROLES.has(normalizedRole)) {
    groups.push(...(await searchEntityGroups(query, context.contaId)));
  }

  return globalSearchResultDTOSchema.parse({
    query: query.trim(),
    groups,
  });
}