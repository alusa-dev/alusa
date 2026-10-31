import { prisma } from '@alusa/database';
import { Prisma } from '@prisma/client';
import { isMenorDeIdade } from '@alusa/domain';
import { findCustomerForPayer, selectFinancialResponsible } from '@alusa/finance';

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
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalize(aluno.nome).includes(normalize(query))) return true;
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
  const digitsOnlyQuery = query.replace(/\D/g, '');
  const digitsQuery = /^[\d\s()./-]+$/.test(query) ? digitsOnlyQuery : '';
  const normAluno = Prisma.sql`btrim(regexp_replace(translate(lower(a."nome"), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '\\s+', ' ', 'g'))`;
  const normResp = Prisma.sql`btrim(regexp_replace(translate(lower(r."nome"), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '\\s+', ' ', 'g'))`;
  const normalizedQuery = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const studentIds = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT a."id" FROM "Aluno" a
    WHERE a."contaId" = ${contaId} AND a."status" = 'ATIVO'
      AND (
        strpos(${normAluno}, ${normalizedQuery}) > 0
        OR (${digitsQuery} <> '' AND strpos(regexp_replace(coalesce(a."cpf", ''), '\\D', '', 'g'), ${digitsQuery}) > 0)
        OR EXISTS (
          SELECT 1 FROM "AlunoResponsavel" ar JOIN "Responsavel" r ON r."id" = ar."responsavelId" AND r."contaId" = ${contaId}
          WHERE ar."alunoId" = a."id" AND ar."contaId" = ${contaId}
            AND (r."financeiro" = true OR ar."tipoVinculo" IN ('FINANCEIRO', 'PRINCIPAL'))
            AND (strpos(${normResp}, ${normalizedQuery}) > 0
              OR (${digitsQuery} <> '' AND strpos(regexp_replace(coalesce(r."cpf", ''), '\\D', '', 'g'), ${digitsQuery}) > 0))
        )
      )
    ORDER BY CASE WHEN strpos(${normAluno}, ${normalizedQuery}) > 0 OR (${digitsQuery} <> '' AND strpos(regexp_replace(coalesce(a."cpf", ''), '\\D', '', 'g'), ${digitsQuery}) > 0) THEN 0 ELSE 1 END,
      CASE WHEN ${normAluno} = ${normalizedQuery} THEN 0 WHEN strpos(${normAluno}, ${normalizedQuery}) = 1 THEN 1 ELSE 2 END, a."nome", a."id"
    LIMIT 50`);
  const responsibleIds = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT r."id" FROM "Responsavel" r WHERE r."contaId" = ${contaId} AND (
      r."financeiro" = true OR EXISTS (SELECT 1 FROM "AlunoResponsavel" ar WHERE ar."contaId" = ${contaId} AND ar."responsavelId" = r."id" AND ar."tipoVinculo" IN ('FINANCEIRO', 'PRINCIPAL')))
      AND (strpos(${normResp}, ${normalizedQuery}) > 0 OR (${digitsQuery} <> '' AND strpos(regexp_replace(r."cpf", '\\D', '', 'g'), ${digitsQuery}) > 0))
    ORDER BY CASE WHEN ${normResp} = ${normalizedQuery} THEN 0 WHEN strpos(${normResp}, ${normalizedQuery}) = 1 THEN 1 ELSE 2 END, r."nome", r."id" LIMIT 20`);
  const alunos = await prisma.aluno.findMany({
    where: {
      contaId,
      id: { in: studentIds.map((row) => row.id) },
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
          contaId,
          responsavel: { contaId },
          OR: [
            { responsavel: { financeiro: true } },
            { tipoVinculo: { in: ['FINANCEIRO', 'PRINCIPAL'] } },
          ],
        },
        select: { tipoVinculo: true, responsavel: { select: { id: true, nome: true, cpf: true, asaasCustomerId: true, financeiro: true } } },
      },
    },
    take: 50,
  });
  const studentRank = new Map(studentIds.map((row, index) => [row.id, index]));
  alunos.sort((a, b) => (studentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (studentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));

  const responsaveis = await prisma.responsavel.findMany({
    where: {
      contaId,
      id: { in: responsibleIds.map((row) => row.id) },
    },
    select: { id: true, nome: true, cpf: true, asaasCustomerId: true },
    take: 20,
  });
  const responsibleRank = new Map(responsibleIds.map((row, index) => [row.id, index]));
  responsaveis.sort((a, b) => (responsibleRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (responsibleRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));

  const results: SearchCandidate[] = [];
  const responsavelById = new Map<string, SearchCandidate>();
  const customerPromises = new Map<string, ReturnType<typeof findCustomerForPayer>>();
  const getCanonicalCustomer = (type: 'ALUNO' | 'RESPONSAVEL', id: string) => {
    const key = `${type}:${id}`;
    let promise = customerPromises.get(key);
    if (!promise) {
      promise = findCustomerForPayer(contaId, type, id);
      customerPromises.set(key, promise);
    }
    return promise;
  };
  const upsertResponsavel = async (resp: ResponsavelSearchRow) => {
    const canonicalCustomer = await getCanonicalCustomer('RESPONSAVEL', resp.id);
    responsavelById.set(resp.id, buildResponsavelCandidate(resp, canonicalCustomer?.asaasCustomerId));
  };

  await Promise.all(alunos.map(async (aluno) => {
    const menor = isMenorDeIdade(aluno.dataNasc);
    const selectedLink = selectFinancialResponsible(aluno.responsaveis.map((v) => ({ responsavelId: v.responsavel.id, financeiro: v.responsavel.financeiro, tipoVinculo: v.tipoVinculo })));
    const respFinanceiro = aluno.responsaveis.find((v) => v.responsavel.id === selectedLink?.responsavelId)?.responsavel ?? null;
    const matchedDirectly = alunoMatchesQueryDirectly(aluno, query, digitsQuery);

    if (options.sales && (matchedDirectly || Boolean(respFinanceiro))) {
      const payerIsResponsible = Boolean(respFinanceiro);
      const payerId = payerIsResponsible ? respFinanceiro!.id : aluno.id;
      const payerType = payerIsResponsible ? 'RESPONSAVEL' : 'ALUNO';
      const payerCustomer = payerIsResponsible
        ? await getCanonicalCustomer('RESPONSAVEL', payerId)
        : await getCanonicalCustomer('ALUNO', aluno.id);
      const hasAsaasCustomerId = Boolean(payerCustomer?.asaasCustomerId ?? (payerIsResponsible ? respFinanceiro?.asaasCustomerId : aluno.asaasCustomerId));
      results.push({
        id: aluno.id, name: aluno.nome, type: 'aluno', photo: aluno.foto,
        cpf: aluno.cpf ?? undefined, cpfMasked: aluno.cpf ?? null, isMinor: menor,
        hasResponsible: Boolean(respFinanceiro), responsibleId: payerIsResponsible ? respFinanceiro?.id ?? null : null,
        responsibleName: respFinanceiro?.nome === aluno.nome ? null : (respFinanceiro?.nome ?? null),
        payerResolved: { type: payerType === 'RESPONSAVEL' ? 'responsavel' : 'aluno', id: payerId, name: payerIsResponsible ? respFinanceiro!.nome : aluno.nome, hasAsaasCustomerId },
        financialStatus: hasAsaasCustomerId && !(options.sales && menor && !respFinanceiro) ? 'OK' : 'INCOMPLETE',
      });
      return;
    }
    if ((menor && !options.sales) || !matchedDirectly) {
      if (respFinanceiro) await upsertResponsavel(respFinanceiro);
      return;
    }

    const payerIsResponsible = Boolean(respFinanceiro);
    const payerCustomer = payerIsResponsible
      ? await getCanonicalCustomer('RESPONSAVEL', respFinanceiro!.id)
      : await getCanonicalCustomer('ALUNO', aluno.id);
    const hasAsaasCustomerId = Boolean(payerCustomer?.asaasCustomerId ?? (payerIsResponsible ? respFinanceiro?.asaasCustomerId : aluno.asaasCustomerId));
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
      payerResolved: { type: payerIsResponsible ? 'responsavel' : 'aluno', id: payerIsResponsible ? respFinanceiro!.id : aluno.id, name: payerIsResponsible ? respFinanceiro!.nome : aluno.nome, hasAsaasCustomerId },
      financialStatus: hasAsaasCustomerId ? 'OK' : 'INCOMPLETE',
    });
  }));

  await Promise.all(responsaveis.map(upsertResponsavel));
  for (const responsavel of responsavelById.values()) {
    if (options.sales) {
      const linkedStudents = results.filter((item) => item.type === 'aluno' && item.responsibleId === responsavel.id);
      const displayStudents = linkedStudents.filter((item) => !alunoMatchesQueryDirectly({ nome: item.name, cpf: item.cpf ?? null }, query, digitsQuery));
      if (displayStudents.length > 0 && responsaveis.some((item) => item.id === responsavel.id)) {
        const names = [...new Map(displayStudents.map((item) => [item.id, item.name])).values()];
        const displayNames = names.length > 1 ? names.map(formatSalesStudentName) : names;
        results.push({
          ...responsavel,
          salesDisplayName: displayNames.length > 1 ? `${displayNames.slice(0, -1).join(', ')} e ${displayNames.at(-1)}` : displayNames[0],
          salesStudentCount: names.length,
        });
        for (let i = results.length - 1; i >= 0; i--) {
          const item = results[i];
          if (item.type === 'aluno' && item.responsibleId === responsavel.id && displayStudents.some((student) => student.id === item.id)) results.splice(i, 1);
        }
        continue;
      }
    }
    if (!results.some((item) => item.type === 'responsavel' && item.id === responsavel.id)) results.push(responsavel);
  }

  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const resultScore = (item: SearchCandidate) => {
    const name = normalize(item.name);
    const normalized = normalize(query);
    if (name === normalized) return 0;
    if (name.startsWith(normalized)) return 1;
    if (name.includes(normalized)) return 2;
    if (digitsQuery && item.cpf?.replace(/\D/g, '').includes(digitsQuery)) return 3;
    return item.type === 'aluno' && item.responsibleId ? 10 : 9;
  };
  results.sort((a, b) => resultScore(a) - resultScore(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return mapFinancePayerSearchResultToDTO({
    results: results.slice(0, 20).map((result) => mapFinancePayerCandidateToDTO(result)),
  });
}
