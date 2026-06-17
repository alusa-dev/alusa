import type { InvoiceStatus, Prisma } from '@prisma/client';

import {
  buildFiscalInvoiceClientKey,
  resolveFiscalInvoiceClient,
  type FiscalInvoiceClientType,
} from '../fiscal/fiscal-invoice-client-resolution';
import {
  computeFiscalInvoiceKpis,
  resolveFiscalInvoiceHighlightStatus,
} from '../fiscal/fiscal-invoice-display';
import { getFiscalPrisma } from '../fiscal/fiscal-prisma';

export type FiscalInvoicePersonType = FiscalInvoiceClientType;

export type ListFiscalInvoicePersonIndexInput = {
  contaId: string;
  search?: string;
  statusFilters?: InvoiceStatus[];
  effectiveDateFrom?: string;
  effectiveDateTo?: string;
  page: number;
  pageSize: number;
};

export type FiscalInvoicePersonIndexItem = {
  id: string;
  tipo: FiscalInvoicePersonType;
  nome: string;
  cpf: string | null;
  foto: string | null;
  totalNotas: number;
  notasEmitidas: number;
  valorTotalEmitido: number;
  ultimaNotaEm: string | null;
  statusDestaque: InvoiceStatus | null;
};

export type FiscalReadinessSnapshot = {
  ready: boolean;
  issues: Array<{ code: string; message: string }>;
};

export type ListFiscalInvoicePersonIndexOutput = {
  data: FiscalInvoicePersonIndexItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  readiness: FiscalReadinessSnapshot;
};

type CompactInvoice = {
  id: string;
  chargeId: string;
  matriculaId: string | null;
  responsavelId: string | null;
  status: InvoiceStatus;
  value: Prisma.Decimal | null;
  effectiveDate: Date | null;
  statusUpdatedAt: Date;
};

type PersonBucket = {
  id: string;
  tipo: FiscalInvoicePersonType;
  invoices: CompactInvoice[];
};

function parseDateBoundary(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value?.trim()) return undefined;
  const parsed = new Date(`${value.trim()}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function buildInvoiceWhere(input: ListFiscalInvoicePersonIndexInput): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = { contaId: input.contaId };

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

async function loadReadinessSnapshot(contaId: string): Promise<FiscalReadinessSnapshot> {
  const prisma = getFiscalPrisma();
  const settings = await prisma.contaFiscalSettings.findUnique({
    where: { contaId },
    select: { readinessStatus: true, readinessIssues: true },
  });

  if (!settings) {
    return {
      ready: false,
      issues: [{ code: 'NOT_CONFIGURED', message: 'Configure a emissão fiscal da escola.' }],
    };
  }

  const issues = Array.isArray(settings.readinessIssues)
    ? settings.readinessIssues
        .filter(
          (issue): issue is { code?: string; message?: string } =>
            Boolean(issue) && typeof issue === 'object',
        )
        .map((issue) => ({
          code: String(issue.code ?? 'UNKNOWN'),
          message: String(issue.message ?? 'Configuração fiscal incompleta.'),
        }))
    : [];

  return {
    ready: settings.readinessStatus === 'READY',
    issues,
  };
}

export async function listFiscalInvoicePersonIndex(
  input: ListFiscalInvoicePersonIndexInput,
): Promise<ListFiscalInvoicePersonIndexOutput> {
  const prisma = getFiscalPrisma();
  const pageSize = Math.min(Math.max(input.pageSize, 1), 50);
  const page = Math.max(input.page, 1);

  const [invoices, readiness] = await Promise.all([
    prisma.invoice.findMany({
      where: buildInvoiceWhere(input),
      select: {
        id: true,
        chargeId: true,
        matriculaId: true,
        responsavelId: true,
        status: true,
        value: true,
        effectiveDate: true,
        statusUpdatedAt: true,
      },
    }),
    loadReadinessSnapshot(input.contaId),
  ]);

  const matriculaIds = [...new Set(invoices.map((invoice) => invoice.matriculaId).filter(Boolean))] as string[];
  const chargeIds = [...new Set(invoices.map((invoice) => invoice.chargeId))];

  const [matriculas, charges] = await Promise.all([
    matriculaIds.length
      ? prisma.matricula.findMany({
          where: { contaId: input.contaId, id: { in: matriculaIds } },
          select: { id: true, alunoId: true },
        })
      : [],
    chargeIds.length
      ? prisma.charge.findMany({
          where: { contaId: input.contaId, id: { in: chargeIds } },
          select: {
            id: true,
            customer: { select: { payerType: true, payerId: true } },
          },
        })
      : [],
  ]);

  const matriculaToAluno = new Map(matriculas.map((matricula) => [matricula.id, matricula.alunoId]));
  const chargeCustomerById = new Map(
    charges.map((charge) => [
      charge.id,
      charge.customer
        ? {
            payerType: charge.customer.payerType as FiscalInvoiceClientType,
            payerId: charge.customer.payerId,
          }
        : null,
    ]),
  );

  const bucketMap = new Map<string, PersonBucket>();

  for (const invoice of invoices) {
    const customer = chargeCustomerById.get(invoice.chargeId);
    const client = resolveFiscalInvoiceClient({
      responsavelId: invoice.responsavelId,
      matriculaAlunoId: invoice.matriculaId ? matriculaToAluno.get(invoice.matriculaId) ?? null : null,
      customerPayerType: customer?.payerType ?? null,
      customerPayerId: customer?.payerId ?? null,
    });

    if (!client) continue;

    const bucketKey = buildFiscalInvoiceClientKey(client);
    const bucket = bucketMap.get(bucketKey) ?? {
      id: client.id,
      tipo: client.tipo,
      invoices: [],
    };

    bucket.invoices.push(invoice);
    bucketMap.set(bucketKey, bucket);
  }

  const alunoIds = [...bucketMap.values()]
    .filter((bucket) => bucket.tipo === 'ALUNO')
    .map((bucket) => bucket.id);
  const responsavelIds = [...bucketMap.values()]
    .filter((bucket) => bucket.tipo === 'RESPONSAVEL')
    .map((bucket) => bucket.id);

  const [alunos, responsaveis] = await Promise.all([
    alunoIds.length
      ? prisma.aluno.findMany({
          where: { contaId: input.contaId, id: { in: alunoIds } },
          select: { id: true, nome: true, cpf: true, foto: true },
        })
      : [],
    responsavelIds.length
      ? prisma.responsavel.findMany({
          where: { contaId: input.contaId, id: { in: responsavelIds } },
          select: { id: true, nome: true, cpf: true, foto: true },
        })
      : [],
  ]);

  const alunoById = new Map(alunos.map((aluno) => [aluno.id, aluno]));
  const responsavelById = new Map(responsaveis.map((responsavel) => [responsavel.id, responsavel]));

  const search = input.search?.trim().toLowerCase();

  const items = [...bucketMap.values()]
    .map((bucket) => {
      const kpis = computeFiscalInvoiceKpis(bucket.invoices);
      const person =
        bucket.tipo === 'ALUNO' ? alunoById.get(bucket.id) : responsavelById.get(bucket.id);

      const nome =
        person?.nome ?? (bucket.tipo === 'ALUNO' ? 'Aluno removido' : 'Responsável removido');

      return {
        id: bucket.id,
        tipo: bucket.tipo,
        nome,
        cpf: person?.cpf ?? null,
        foto: person?.foto ?? null,
        totalNotas: kpis.totalNotas,
        notasEmitidas: kpis.totalEmitidas,
        valorTotalEmitido: kpis.totalValor,
        ultimaNotaEm: kpis.ultimaNotaEm,
        statusDestaque: resolveFiscalInvoiceHighlightStatus(bucket.invoices),
        _sortDate: kpis.ultimaNotaEm,
      };
    })
    .filter((item) => {
      if (!search) return true;
      return item.nome.toLowerCase().includes(search);
    })
    .sort((left, right) => {
      if (left._sortDate && right._sortDate) {
        return right._sortDate.localeCompare(left._sortDate);
      }
      if (left._sortDate) return -1;
      if (right._sortDate) return 1;
      return left.nome.localeCompare(right.nome, 'pt-BR');
    })
    .map(({ _sortDate, ...item }) => {
      void _sortDate;
      return item;
    });

  const total = items.length;
  const data = items.slice((page - 1) * pageSize, page * pageSize);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    readiness,
  };
}
