import { prisma } from '@alusa/database';
import { isMenorDeIdade } from '@alusa/domain';
import { findCustomerForPayer } from '@alusa/finance';

import {
  financePayerSearchQueryDTOSchema,
  financePayerSearchResultDTOSchema,
} from '@/features/finance/dtos';
import {
  mapFinancePayerCandidateToDTO,
  mapFinancePayerSearchResultToDTO,
} from '@/features/finance/mappers';

type ResponsavelSearchRow = {
  id: string;
  nome: string;
  cpf: string | null;
  asaasCustomerId: string | null;
};

type SearchCandidate = {
  id: string;
  name: string;
  type: 'aluno' | 'responsavel';
  photo?: string | null;
  cpf?: string;
  cpfMasked: string | null;
  isMinor: boolean;
  hasResponsible: boolean;
  responsibleId: string | null;
  responsibleName: string | null;
  salesDisplayName?: string;
  salesStudentCount?: number;
  payerResolved: {
    type: 'aluno' | 'responsavel';
    id: string;
    name: string;
    hasAsaasCustomerId: boolean;
  };
  financialStatus: 'OK' | 'INCOMPLETE';
};

function alunoMatchesQueryDirectly(aluno: { nome: string; cpf: string | null }, query: string, digitsQuery: string) {
  if (aluno.nome.toLowerCase().includes(query.toLowerCase())) return true;
  return digitsQuery.length > 0 && Boolean(aluno.cpf?.includes(digitsQuery));
}

function formatSalesStudentName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : name.trim();
}

function buildResponsavelCandidate(resp: ResponsavelSearchRow, canonicalCustomerId?: string | null): SearchCandidate {
  const hasAsaasCustomerId = Boolean(canonicalCustomerId ?? resp.asaasCustomerId);
  return {
    id: resp.id,
    name: resp.nome,
    type: 'responsavel',
    photo: null,
    cpf: resp.cpf ?? undefined,
    cpfMasked: resp.cpf ?? null,
    isMinor: false,
    hasResponsible: false,
    responsibleId: null,
    responsibleName: null,
    payerResolved: { type: 'responsavel', id: resp.id, name: resp.nome, hasAsaasCustomerId },
    financialStatus: hasAsaasCustomerId ? 'OK' : 'INCOMPLETE',
  };
}

/** Busca pagadores financeiros sempre dentro da conta informada. */
export async function searchFinancePayers(contaId: string, rawQuery: string, options: { sales?: boolean } = {}) {
  const parsedQuery = financePayerSearchQueryDTOSchema.safeParse({ q: rawQuery.trim() });
  if (!parsedQuery.success) return financePayerSearchResultDTOSchema.parse({ results: [] });

  const query = parsedQuery.data.q;
  const digitsQuery = query.replace(/\D/g, '');
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
      foto: true,
      dataNasc: true,
      asaasCustomerId: true,
      responsaveis: {
        where: {
          OR: [
            { responsavel: { financeiro: true } },
            { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
          ],
        },
        select: { responsavel: { select: { id: true, nome: true, cpf: true, asaasCustomerId: true } } },
        take: 1,
      },
    },
    take: 10,
  });

  const responsaveis = await prisma.responsavel.findMany({
    where: {
      contaId,
      financeiro: true,
      OR: [
        { nome: { contains: query, mode: 'insensitive' } },
        { cpf: { contains: digitsQuery } },
      ],
    },
    select: { id: true, nome: true, cpf: true, asaasCustomerId: true },
    take: 10,
  });

  const results: SearchCandidate[] = [];
  const responsavelById = new Map<string, SearchCandidate>();
  const upsertResponsavel = async (resp: ResponsavelSearchRow) => {
    const canonicalCustomer = await findCustomerForPayer(contaId, 'RESPONSAVEL', resp.id);
    responsavelById.set(resp.id, buildResponsavelCandidate(resp, canonicalCustomer?.asaasCustomerId));
  };

  for (const aluno of alunos) {
    const menor = isMenorDeIdade(aluno.dataNasc);
    const respFinanceiro = aluno.responsaveis[0]?.responsavel ?? null;
    const matchedDirectly = alunoMatchesQueryDirectly(aluno, query, digitsQuery);

    if (options.sales && menor && !respFinanceiro) continue;

    if (options.sales && (matchedDirectly || Boolean(respFinanceiro))) {
      const canonicalAlunoCustomer = await findCustomerForPayer(contaId, 'ALUNO', aluno.id);
      const payerIsResponsible = Boolean(menor && respFinanceiro);
      const payerId = payerIsResponsible ? respFinanceiro!.id : aluno.id;
      const payerType = payerIsResponsible ? 'RESPONSAVEL' : 'ALUNO';
      const payerCustomer = payerIsResponsible
        ? await findCustomerForPayer(contaId, 'RESPONSAVEL', payerId)
        : canonicalAlunoCustomer;
      const hasAsaasCustomerId = Boolean(payerCustomer?.asaasCustomerId ?? (payerIsResponsible ? respFinanceiro?.asaasCustomerId : aluno.asaasCustomerId));
      results.push({
        id: aluno.id, name: aluno.nome, type: 'aluno', photo: aluno.foto,
        cpf: aluno.cpf ?? undefined, cpfMasked: aluno.cpf ?? null, isMinor: menor,
        hasResponsible: Boolean(respFinanceiro), responsibleId: respFinanceiro?.id ?? null,
        responsibleName: respFinanceiro?.nome === aluno.nome ? null : (respFinanceiro?.nome ?? null),
        payerResolved: { type: payerType === 'RESPONSAVEL' ? 'responsavel' : 'aluno', id: payerId, name: payerIsResponsible ? respFinanceiro!.nome : aluno.nome, hasAsaasCustomerId },
        financialStatus: hasAsaasCustomerId ? 'OK' : 'INCOMPLETE',
      });
      continue;
    }
    if (menor || !matchedDirectly) {
      if (respFinanceiro) await upsertResponsavel(respFinanceiro);
      continue;
    }

    const canonicalAlunoCustomer = await findCustomerForPayer(contaId, 'ALUNO', aluno.id);
    const hasAsaasCustomerId = Boolean(canonicalAlunoCustomer?.asaasCustomerId ?? aluno.asaasCustomerId);
    results.push({
      id: aluno.id,
      name: aluno.nome,
      type: 'aluno',
      photo: aluno.foto,
      cpf: aluno.cpf ?? undefined,
      cpfMasked: aluno.cpf ?? null,
      isMinor: false,
      hasResponsible: Boolean(respFinanceiro),
      responsibleId: respFinanceiro?.id ?? null,
      responsibleName: respFinanceiro?.nome ?? null,
      payerResolved: { type: 'aluno', id: aluno.id, name: aluno.nome, hasAsaasCustomerId },
      financialStatus: hasAsaasCustomerId ? 'OK' : 'INCOMPLETE',
    });
  }

  for (const responsavel of responsaveis) await upsertResponsavel(responsavel);
  for (const responsavel of responsavelById.values()) {
    if (options.sales) {
      const linkedStudents = results.filter((item) => item.type === 'aluno' && item.responsibleId === responsavel.id);
      if (linkedStudents.length > 0 && responsaveis.some((item) => item.id === responsavel.id)) {
        const names = [...new Set(linkedStudents.map((item) => item.name))];
        const displayNames = names.length > 1 ? names.map(formatSalesStudentName) : names;
        results.push({
          ...responsavel,
          salesDisplayName: displayNames.length > 1 ? `${displayNames.slice(0, -1).join(', ')} e ${displayNames.at(-1)}` : displayNames[0],
          salesStudentCount: names.length,
        });
        for (let i = results.length - 1; i >= 0; i--) {
          const item = results[i];
          if (item.type === 'aluno' && item.responsibleId === responsavel.id) results.splice(i, 1);
        }
        continue;
      }
    }
    if (!results.some((item) => item.type === 'responsavel' && item.id === responsavel.id)) results.push(responsavel);
  }

  return mapFinancePayerSearchResultToDTO({
    results: results.slice(0, 20).map((result) => mapFinancePayerCandidateToDTO(result)),
  });
}
