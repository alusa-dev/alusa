import type { InvoiceStatus, Prisma } from '@prisma/client';

import {
  computeFiscalInvoiceKpis,
  decimalToNumber,
  isFiscalInvoiceSyncPending,
  resolveFiscalInvoiceServiceLabel,
  type FiscalInvoiceKpis,
} from '../fiscal/fiscal-invoice-display';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { todayInBrazil } from '../fiscal/invoice-effective-date';

export type FiscalInvoicePersonDetailType = 'ALUNO' | 'RESPONSAVEL';

export type GetFiscalInvoicePersonDetailInput = {
  contaId: string;
  personType: FiscalInvoicePersonDetailType;
  personId: string;
  statusFilters?: InvoiceStatus[];
  effectiveDateFrom?: string;
  effectiveDateTo?: string;
};

export type FiscalInvoicePersonSummary = {
  id: string;
  tipo: FiscalInvoicePersonDetailType;
  nome: string;
  cpf: string | null;
  foto: string | null;
  turmaNome: string | null;
  alunosVinculados: Array<{ id: string; nome: string }>;
  responsavelPrincipal: { id: string; nome: string } | null;
};

export type FiscalInvoiceListItem = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  statusDescription: string | null;
  errorMessage: string | null;
  value: number;
  effectiveDate: string | null;
  serviceDescription: string | null;
  serviceLabel: string;
  pdfUrl: string | null;
  xmlUrl: string | null;
  cobrancaId: string | null;
  chargeId: string;
  cobrancaDescricao: string | null;
  alunoId: string | null;
  alunoNome: string | null;
  syncPending: boolean;
  statusUpdatedAt: string;
};

export type GetFiscalInvoicePersonDetailOutput = {
  pessoa: FiscalInvoicePersonSummary;
  kpis: FiscalInvoiceKpis;
  notas: FiscalInvoiceListItem[];
};

export type GetFiscalInvoicePersonDetailError = 'PESSOA_NAO_ENCONTRADA';

function parseDateBoundary(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(`${value.trim()}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function buildInvoiceWhere(
  input: GetFiscalInvoicePersonDetailInput,
  alunoMatriculaIds: string[],
): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { contaId: input.contaId };

  if (input.personType === 'ALUNO') {
    const alunoInvoiceFilters: Prisma.InvoiceWhereInput[] = [
      {
        responsavelId: null,
        matriculaId: null,
        charge: {
          customer: { payerType: 'ALUNO', payerId: input.personId, contaId: input.contaId },
        },
      },
    ];

    if (alunoMatriculaIds.length > 0) {
      alunoInvoiceFilters.unshift({
        responsavelId: null,
        matriculaId: { in: alunoMatriculaIds },
      });
    }

    where.OR = alunoInvoiceFilters;
  } else {
    where.OR = [
      { responsavelId: input.personId },
      {
        charge: {
          customer: { payerType: 'RESPONSAVEL', payerId: input.personId, contaId: input.contaId },
        },
      },
    ];
  }

  if (input.statusFilters?.length) {
    where.status = { in: input.statusFilters };
  }

  const effectiveDateFrom = parseDateBoundary(input.effectiveDateFrom, false);
  const effectiveDateTo = parseDateBoundary(input.effectiveDateTo, true);
  if (effectiveDateFrom || effectiveDateTo) {
    where.effectiveDate = {
      ...(effectiveDateFrom ? { gte: effectiveDateFrom } : {}),
      ...(effectiveDateTo ? { lte: effectiveDateTo } : {}),
    };
  }

  return where;
}

function mapInvoiceRow(
  invoice: {
    id: string;
    number: string | null;
    status: InvoiceStatus;
    statusDescription: string | null;
    errorMessage: string | null;
    value: Prisma.Decimal | null;
    effectiveDate: Date | null;
    serviceDescription: string | null;
    pdfUrl: string | null;
    xmlUrl: string | null;
    cobrancaId: string | null;
    chargeId: string;
    matriculaId: string | null;
    asaasInvoiceId: string | null;
    statusUpdatedAt: Date;
    charge: {
      cobranca: {
        descricao: string | null;
        competenciaInicio: Date;
        competenciaFim: Date;
      } | null;
      description: string | null;
    };
  },
  minEffectiveDate: string,
  matriculaById: Map<
    string,
    {
      aluno: { id: string; nome: string };
      plano: { nome: string } | null;
      turma: { nome: string } | null;
    }
  >,
): FiscalInvoiceListItem {
  const matricula = invoice.matriculaId ? matriculaById.get(invoice.matriculaId) : null;
  const aluno = matricula?.aluno ?? null;
  const cobrancaDescricao = invoice.charge.cobranca?.descricao ?? invoice.charge.description;

  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    statusDescription: invoice.statusDescription,
    errorMessage: invoice.errorMessage,
    value: decimalToNumber(invoice.value),
    effectiveDate: invoice.effectiveDate?.toISOString() ?? null,
    serviceDescription: invoice.serviceDescription,
    serviceLabel: resolveFiscalInvoiceServiceLabel({
      cobrancaDescricao,
      planoNome: matricula?.plano?.nome ?? null,
      turmaNome: matricula?.turma?.nome ?? null,
      alunoNome: aluno?.nome ?? null,
      competenciaInicio: invoice.charge.cobranca?.competenciaInicio ?? null,
      competenciaFim: invoice.charge.cobranca?.competenciaFim ?? null,
    }),
    pdfUrl: invoice.pdfUrl,
    xmlUrl: invoice.xmlUrl,
    cobrancaId: invoice.cobrancaId,
    chargeId: invoice.chargeId,
    cobrancaDescricao,
    alunoId: aluno?.id ?? null,
    alunoNome: aluno?.nome ?? null,
    syncPending: isFiscalInvoiceSyncPending({
      status: invoice.status,
      asaasInvoiceId: invoice.asaasInvoiceId,
      effectiveDate: invoice.effectiveDate,
      minEffectiveDate,
    }),
    statusUpdatedAt: invoice.statusUpdatedAt.toISOString(),
  };
}

async function loadAlunoSummary(contaId: string, alunoId: string): Promise<FiscalInvoicePersonSummary | null> {
  const prisma = getFiscalPrisma();
  const aluno = await prisma.aluno.findFirst({
    where: { id: alunoId, contaId },
    select: {
      id: true,
      nome: true,
      cpf: true,
      foto: true,
      matriculas: {
        where: { status: { in: ['ATIVA', 'PAUSADA'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          turma: { select: { nome: true } },
          responsavelFinanceiro: { select: { id: true, nome: true } },
        },
      },
    },
  });

  if (!aluno) return null;

  const matricula = aluno.matriculas[0];

  return {
    id: aluno.id,
    tipo: 'ALUNO',
    nome: aluno.nome,
    cpf: aluno.cpf,
    foto: aluno.foto,
    turmaNome: matricula?.turma?.nome ?? null,
    alunosVinculados: [],
    responsavelPrincipal: matricula?.responsavelFinanceiro
      ? {
          id: matricula.responsavelFinanceiro.id,
          nome: matricula.responsavelFinanceiro.nome,
        }
      : null,
  };
}

async function loadResponsavelSummary(
  contaId: string,
  responsavelId: string,
): Promise<FiscalInvoicePersonSummary | null> {
  const prisma = getFiscalPrisma();
  const responsavel = await prisma.responsavel.findFirst({
    where: { id: responsavelId, contaId },
    select: {
      id: true,
      nome: true,
      cpf: true,
      foto: true,
      alunos: {
        select: {
          aluno: { select: { id: true, nome: true } },
        },
      },
    },
  });

  if (!responsavel) return null;

  return {
    id: responsavel.id,
    tipo: 'RESPONSAVEL',
    nome: responsavel.nome,
    cpf: responsavel.cpf,
    foto: responsavel.foto,
    turmaNome: null,
    alunosVinculados: responsavel.alunos.map((link) => ({
      id: link.aluno.id,
      nome: link.aluno.nome,
    })),
    responsavelPrincipal: null,
  };
}

export async function getFiscalInvoicePersonDetail(
  input: GetFiscalInvoicePersonDetailInput,
): Promise<
  | { success: true; data: GetFiscalInvoicePersonDetailOutput }
  | { success: false; error: GetFiscalInvoicePersonDetailError }
> {
  const prisma = getFiscalPrisma();
  const minEffectiveDate = todayInBrazil();

  let pessoa: FiscalInvoicePersonSummary;
  if (input.personType === 'ALUNO') {
    const loaded = await loadAlunoSummary(input.contaId, input.personId);
    if (!loaded) return { success: false, error: 'PESSOA_NAO_ENCONTRADA' };
    pessoa = loaded;
  } else {
    const loaded = await loadResponsavelSummary(input.contaId, input.personId);
    if (!loaded) return { success: false, error: 'PESSOA_NAO_ENCONTRADA' };
    pessoa = loaded;
  }

  const alunoMatriculaIds =
    input.personType === 'ALUNO'
      ? (
          await prisma.matricula.findMany({
            where: { contaId: input.contaId, alunoId: input.personId },
            select: { id: true },
          })
        ).map((matricula) => matricula.id)
      : [];

  const invoiceSelect = {
    id: true,
    number: true,
    status: true,
    statusDescription: true,
    errorMessage: true,
    value: true,
    effectiveDate: true,
    serviceDescription: true,
    pdfUrl: true,
    xmlUrl: true,
    cobrancaId: true,
    chargeId: true,
    matriculaId: true,
    asaasInvoiceId: true,
    statusUpdatedAt: true,
    charge: {
      select: {
        cobranca: {
          select: {
            descricao: true,
            competenciaInicio: true,
            competenciaFim: true,
          },
        },
        description: true,
      },
    },
  } as const;

  const baseWhere = buildInvoiceWhere(
    {
      ...input,
      statusFilters: undefined,
      effectiveDateFrom: undefined,
      effectiveDateTo: undefined,
    },
    alunoMatriculaIds,
  );
  const filteredWhere = buildInvoiceWhere(input, alunoMatriculaIds);

  const [allInvoicesForKpis, filteredInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: baseWhere,
      select: {
        status: true,
        value: true,
        effectiveDate: true,
        statusUpdatedAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: filteredWhere,
      select: invoiceSelect,
      orderBy: [{ effectiveDate: 'desc' }, { statusUpdatedAt: 'desc' }],
    }),
  ]);

  const matriculaIds = [
    ...new Set(filteredInvoices.map((invoice) => invoice.matriculaId).filter(Boolean)),
  ] as string[];
  const matriculas = matriculaIds.length
    ? await prisma.matricula.findMany({
        where: { contaId: input.contaId, id: { in: matriculaIds } },
        select: {
          id: true,
          aluno: { select: { id: true, nome: true } },
          plano: { select: { nome: true } },
          turma: { select: { nome: true } },
        },
      })
    : [];
  const matriculaById = new Map(matriculas.map((matricula) => [matricula.id, matricula]));

  const notas = filteredInvoices.map((invoice) =>
    mapInvoiceRow(invoice, minEffectiveDate, matriculaById),
  );
  const kpis = computeFiscalInvoiceKpis(allInvoicesForKpis);

  return {
    success: true,
    data: { pessoa, kpis, notas },
  };
}
