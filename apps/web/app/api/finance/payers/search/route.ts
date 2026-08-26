import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth-options';
import { prisma } from '@alusa/database';
import { isMenorDeIdade } from '@alusa/domain';
import {
  financePayerSearchQueryDTOSchema,
  financePayerSearchResultDTOSchema,
} from '@/features/finance/dtos';
import {
  mapFinancePayerCandidateToDTO,
  mapFinancePayerSearchResultToDTO,
} from '@/features/finance/mappers';

type SessionUser = { id?: string; role?: string; contaId?: string };

async function resolveAuth(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions).catch(() => null);
  return (session as { user?: SessionUser } | null)?.user ?? null;
}

type ResponsavelSearchRow = {
  id: string;
  nome: string;
  cpf: string | null;
  asaasCustomerId: string | null;
};

function alunoMatchesQueryDirectly(
  aluno: { nome: string; cpf: string | null },
  query: string,
  digitsQuery: string,
): boolean {
  if (aluno.nome.toLowerCase().includes(query.toLowerCase())) return true;
  if (digitsQuery.length > 0 && aluno.cpf?.includes(digitsQuery)) return true;
  return false;
}

function buildResponsavelCandidate(resp: ResponsavelSearchRow) {
  return {
    id: resp.id,
    name: resp.nome,
    type: 'responsavel' as const,
    cpf: resp.cpf ?? undefined,
    cpfMasked: resp.cpf ?? null,
    isMinor: false,
    hasResponsible: false,
    responsibleId: null,
    responsibleName: null,
    payerResolved: {
      type: 'responsavel' as const,
      id: resp.id,
      name: resp.nome,
      hasAsaasCustomerId: !!resp.asaasCustomerId,
    },
    financialStatus: resp.asaasCustomerId ? ('OK' as const) : ('INCOMPLETE' as const),
  };
}

/**
 * Contrato de retorno:
 * - Alunos menores não aparecem: o responsável financeiro é quem tem customer no Asaas.
 * - Alunos maiores de idade aparecem como pagador (type aluno).
 * - Responsáveis financeiros aparecem como pagador (type responsavel).
 */
export async function GET(request: NextRequest) {
  const user = await resolveAuth();
  if (!user?.contaId) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const parsedQuery = financePayerSearchQueryDTOSchema.safeParse({
    q: searchParams.get('q')?.trim() || '',
  });

  if (!parsedQuery.success) {
    return NextResponse.json(financePayerSearchResultDTOSchema.parse({ results: [] }));
  }
  const { q: query } = parsedQuery.data;

  const contaId = user.contaId;
  const digitsQuery = query.replace(/\D/g, '');

  // Buscar alunos com responsável financeiro vinculado
  const alunos = await prisma.aluno.findMany({
    where: {
      contaId,
      status: 'ATIVO',
      OR: [
        { nome: { contains: query, mode: 'insensitive' } },
        { cpf: { contains: digitsQuery } },
        {
          responsaveis: {
            some: {
              OR: [
                { responsavel: { financeiro: true, nome: { contains: query, mode: 'insensitive' } } },
                { responsavel: { financeiro: true, cpf: { contains: digitsQuery } } },
                { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] }, responsavel: { nome: { contains: query, mode: 'insensitive' } } },
                { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] }, responsavel: { cpf: { contains: digitsQuery } } },
              ],
            },
          },
        },
      ],
    },
    select: {
      id: true,
      nome: true,
      cpf: true,
      dataNasc: true,
      asaasCustomerId: true,
      responsaveis: {
        where: {
          OR: [
            { responsavel: { financeiro: true } },
            { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
          ],
        },
        select: {
          responsavel: {
            select: {
              id: true,
              nome: true,
              cpf: true,
              asaasCustomerId: true,
            },
          },
        },
        take: 1,
      },
    },
    take: 10,
  });

  // Buscar responsáveis financeiros - Multi-tenant: filtrar por contaId direto
  const responsaveis = await prisma.responsavel.findMany({
    where: {
      contaId,
      financeiro: true,
      OR: [
        { nome: { contains: query, mode: 'insensitive' } },
        { cpf: { contains: query.replace(/\D/g, '') } },
      ],
    },
    select: {
      id: true,
      nome: true,
      cpf: true,
      asaasCustomerId: true,
    },
    take: 10,
  });

  const results: Array<Record<string, unknown>> = [];
  const responsavelById = new Map<string, ReturnType<typeof buildResponsavelCandidate>>();

  const upsertResponsavel = (resp: ResponsavelSearchRow) => {
    responsavelById.set(resp.id, buildResponsavelCandidate(resp));
  };

  // Processar alunos: menores e matches indiretos (via responsável) retornam o responsável financeiro.
  for (const aluno of alunos) {
    const menor = isMenorDeIdade(aluno.dataNasc);
    const respFinanceiro = aluno.responsaveis[0]?.responsavel ?? null;
    const matchedDirectly = alunoMatchesQueryDirectly(aluno, query, digitsQuery);

    if (menor || !matchedDirectly) {
      if (respFinanceiro) {
        upsertResponsavel(respFinanceiro);
      }
      continue;
    }

    // Aluno maior de idade encontrado pelo próprio nome/CPF.
    results.push({
      id: aluno.id,
      name: aluno.nome,
      type: 'aluno',
      cpf: aluno.cpf ?? undefined,
      cpfMasked: aluno.cpf ?? null,
      isMinor: false,
      hasResponsible: !!respFinanceiro,
      responsibleId: respFinanceiro?.id ?? null,
      responsibleName: respFinanceiro?.nome ?? null,
      payerResolved: {
        type: 'aluno',
        id: aluno.id,
        name: aluno.nome,
        hasAsaasCustomerId: !!aluno.asaasCustomerId,
      },
      financialStatus: aluno.asaasCustomerId ? 'OK' : 'INCOMPLETE',
    });
  }

  for (const resp of responsaveis) {
    upsertResponsavel(resp);
  }

  for (const responsavel of responsavelById.values()) {
    if (!results.some((item) => item.type === 'responsavel' && item.id === responsavel.id)) {
      results.push(responsavel);
    }
  }

  const limitedResults = results.slice(0, 20);

  return NextResponse.json(
    financePayerSearchResultDTOSchema.parse(
      mapFinancePayerSearchResultToDTO({
        results: limitedResults.map((result) => mapFinancePayerCandidateToDTO(result)),
      }),
    ),
  );
}
