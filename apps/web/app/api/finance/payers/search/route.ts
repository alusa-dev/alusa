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

/**
 * Contrato de retorno:
 * - Para alunos: retorna payerResolved indicando quem efetivamente pagará
 * - Para responsáveis: payerResolved = o próprio responsável
 * - Se aluno é menor: pagador resolvido = responsável financeiro vinculado
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
  const resolvedResponsibleIds = new Set<string>();

  // Processar alunos com resolução de pagador
  for (const aluno of alunos) {
    const menor = isMenorDeIdade(aluno.dataNasc);
    const respFinanceiro = aluno.responsaveis[0]?.responsavel ?? null;

    if (menor) {
      // Aluno menor: pagador = responsável financeiro
      if (respFinanceiro) {
        resolvedResponsibleIds.add(respFinanceiro.id);
        results.push({
          id: aluno.id,
          name: aluno.nome,
          type: 'aluno',
          cpf: aluno.cpf ?? undefined,
          isMinor: true,
          hasResponsible: true,
          responsibleId: respFinanceiro.id,
          responsibleName: respFinanceiro.nome,
          payerResolved: {
            type: 'responsavel',
            id: respFinanceiro.id,
            name: respFinanceiro.nome,
            hasAsaasCustomerId: !!respFinanceiro.asaasCustomerId,
          },
          financialStatus: respFinanceiro.asaasCustomerId ? 'OK' : 'INCOMPLETE',
        });
      }
      // Se menor sem responsável: não incluir (invariante: cadastro exige responsável)
    } else {
      // Aluno maior: pagador = próprio aluno
      results.push({
        id: aluno.id,
        name: aluno.nome,
        type: 'aluno',
        cpf: aluno.cpf ?? undefined,
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
  }

  // Responsáveis: pagador = o próprio responsável
  for (const resp of responsaveis) {
    if (resolvedResponsibleIds.has(resp.id)) {
      continue;
    }

    results.push({
      id: resp.id,
      name: resp.nome,
      type: 'responsavel',
      cpf: resp.cpf ?? undefined,
      isMinor: false,
      hasResponsible: false,
      responsibleId: null,
      responsibleName: null,
      payerResolved: {
        type: 'responsavel',
        id: resp.id,
        name: resp.nome,
        hasAsaasCustomerId: !!resp.asaasCustomerId,
      },
      financialStatus: resp.asaasCustomerId ? 'OK' : 'INCOMPLETE',
    });
  }

  return NextResponse.json(
    financePayerSearchResultDTOSchema.parse(
      mapFinancePayerSearchResultToDTO({
        results: results.map((result) => mapFinancePayerCandidateToDTO(result)),
      }),
    ),
  );
}
