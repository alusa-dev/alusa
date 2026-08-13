import type { FormaPagamento, Prisma, TipoCobranca } from '@prisma/client';
import { buildSeatOccupancyWhereClause } from '@alusa/lib';
import { z } from 'zod';

export const financialReportViewSchema = z.enum(['overview', 'delinquency', 'receipts']);
export const financialReportDateBasisSchema = z.enum([
  'DUE_DATE',
  'PAID_AT',
  'SETTLED_AT',
  'COMPETENCE',
]);
export const financialReportOriginSchema = z.enum(['ACADEMIC', 'STANDALONE']);
export const financialReportStatusSchema = z.enum([
  'OPEN',
  'PROCESSING',
  'PAID',
  'OVERDUE',
  'CANCELED',
  'REFUNDED',
]);
export const financialReportSortSchema = z.enum([
  'dueDate',
  'paidAt',
  'payerName',
  'studentName',
  'grossAmount',
  'daysOverdue',
]);

const listParam = (schema: z.ZodType<string>) =>
  z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(schema).default([]),
  );

function isValidCivilDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

const isoDaySchema = z
  .string()
  .refine(isValidCivilDay, 'Informe uma data civil válida no formato AAAA-MM-DD.');

export const financialReportQuerySchema = z
  .object({
    startDate: isoDaySchema,
    endDate: isoDaySchema,
    dateBasis: financialReportDateBasisSchema.default('DUE_DATE'),
    turmaId: z.string().trim().min(1).optional(),
    planoId: z.string().trim().min(1).optional(),
    chargeType: listParam(z.string().trim().min(1)),
    paymentMethod: listParam(z.string().trim().min(1)),
    status: listParam(financialReportStatusSchema),
    origin: listParam(financialReportOriginSchema),
    search: z.string().trim().max(120).default(''),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    sort: financialReportSortSchema.default('dueDate'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine((value, ctx) => {
    const start = Date.parse(`${value.startDate}T00:00:00.000Z`);
    const end = Date.parse(`${value.endDate}T00:00:00.000Z`);
    if (start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'A data final deve ser igual ou posterior à data inicial.',
      });
      return;
    }
    const maximumEnd = new Date(start);
    maximumEnd.setUTCMonth(maximumEnd.getUTCMonth() + 24);
    if (end >= maximumEnd.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'O período máximo permitido é de 24 meses.',
      });
    }
  });

export type FinancialReportQuery = z.infer<typeof financialReportQuerySchema>;
export type FinancialReportView = z.infer<typeof financialReportViewSchema>;
export type FinancialReportStatus = z.infer<typeof financialReportStatusSchema>;
export type FinancialReportOrigin = z.infer<typeof financialReportOriginSchema>;

export type FinancialReportProjection = {
  id: string;
  sourceId: string;
  source: 'COBRANCA' | 'CHARGE';
  origin: FinancialReportOrigin;
  type: string;
  description: string | null;
  status: FinancialReportStatus;
  payerId: string | null;
  payerName: string;
  payerEmail: string | null;
  payerPhone: string | null;
  studentId: string | null;
  studentName: string | null;
  matriculaId: string | null;
  turmaId: string | null;
  turmaName: string | null;
  planoId: string | null;
  planoName: string | null;
  paymentMethod: string | null;
  grossAmount: number;
  receivedAmount: number;
  outstandingAmount: number;
  feeAmount: number;
  refundedAmount: number;
  netAmount: number;
  dueDate: Date | null;
  paidAt: Date | null;
  settledAt: Date | null;
  competenceAt: Date | null;
  settlementStatus: string;
  daysOverdue: number;
};

export type FinancialMetricSummary = {
  totalCharges: number;
  received: number;
  receivable: number;
  overdue: number;
  processing: number;
  fees: number;
  refunds: number;
  net: number;
  toSettle: number;
  available: number;
  averageTicket: number;
  delinquencyRate: number;
  chargeCount: number;
  receivedCount: number;
  overdueCount: number;
};

export type FinancialReportDetailItem = Omit<
  FinancialReportProjection,
  'dueDate' | 'paidAt' | 'settledAt' | 'competenceAt'
> & {
  dueDate: string | null;
  paidAt: string | null;
  settledAt: string | null;
  competenceAt: string | null;
};

export type FinancialReportSeriesItem = {
  key: string;
  label: string;
  charged: number;
  received: number;
  overdue: number;
  net: number;
};

export type FinancialEnrollmentSeriesItem = {
  key: string;
  label: string;
  enrollments: number;
  cancellations: number;
};

export type FinancialEnrollmentHealth = {
  activeEnrollments: number;
  enrollmentsInPeriod: number;
  cancellationsInPeriod: number;
  openingActiveEnrollments: number;
  retentionRate: number | null;
};

export type FinancialCancellationRankingItem = {
  id: string;
  name: string;
  cancellations: number;
};

export type FinancialReportBreakdownItem = {
  key: string;
  label: string;
  amount: number;
  count: number;
  percentage: number;
};

export type FinancialReportRankingItem = {
  id: string;
  name: string;
  charged: number;
  received: number;
  overdue: number;
  delinquencyRate: number;
  studentCount: number;
};

export type FinancialClassOccupancyItem = {
  id: string;
  name: string;
  capacity: number;
  occupiedSeats: number;
  occupancyRate: number;
};

export type FinancialReportPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type FinancialReportDataQuality = {
  excludedRecords: number;
  warnings: string[];
};

export type FinancialOverviewReport = {
  view: 'overview';
  generatedAt: string;
  timeZone: string;
  dateBasis: FinancialReportQuery['dateBasis'];
  summary: FinancialMetricSummary;
  series: FinancialReportSeriesItem[];
  enrollmentSeries: FinancialEnrollmentSeriesItem[];
  enrollmentHealth: FinancialEnrollmentHealth;
  statusBreakdown: FinancialReportBreakdownItem[];
  typeBreakdown: FinancialReportBreakdownItem[];
  paymentMethodBreakdown: FinancialReportBreakdownItem[];
  rankingByClass: FinancialReportRankingItem[];
  rankingByPlan: FinancialReportRankingItem[];
  cancellationsByClass: FinancialCancellationRankingItem[];
  classOccupancy: FinancialClassOccupancyItem[];
  details: FinancialReportPage<FinancialReportDetailItem>;
  dataQuality: FinancialReportDataQuality;
};

export type DelinquencyGroupItem = {
  payerId: string | null;
  payerName: string;
  payerEmail: string | null;
  payerPhone: string | null;
  studentNames: string[];
  turmaNames: string[];
  chargeCount: number;
  oldestDueDate: string;
  daysOverdue: number;
  overdueAmount: number;
  matriculaIds: string[];
  chargeIds: string[];
};

export type DelinquencyReport = {
  view: 'delinquency';
  generatedAt: string;
  timeZone: string;
  dateBasis: 'DUE_DATE';
  summary: FinancialMetricSummary & {
    payerCount: number;
    enrollmentCount: number;
    averageDaysOverdue: number;
    recoveredAmount: number;
  };
  aging: FinancialReportBreakdownItem[];
  details: FinancialReportPage<DelinquencyGroupItem>;
  dataQuality: FinancialReportDataQuality;
};

export type ReceiptsReport = {
  view: 'receipts';
  generatedAt: string;
  timeZone: string;
  dateBasis: FinancialReportQuery['dateBasis'];
  summary: FinancialMetricSummary;
  series: FinancialReportSeriesItem[];
  paymentMethodBreakdown: FinancialReportBreakdownItem[];
  details: FinancialReportPage<FinancialReportDetailItem>;
  dataQuality: FinancialReportDataQuality;
};

type ReportDb = Pick<
  Prisma.TransactionClient,
  'conta' | 'cobranca' | 'charge' | 'pagamento' | 'turma' | 'plano' | 'matricula'
>;

const CANCELED_COBRANCA = new Set(['CANCELADO', 'CANCELAMENTO_PENDENTE']);
const PAID_COBRANCA = new Set(['PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL']);
const PROCESSING_COBRANCA = new Set(['PROCESSANDO']);
const CANCELED_CHARGE = new Set(['CANCELED']);
const PAID_CHARGE = new Set(['PAID', 'REFUNDED']);
const OPEN_CHARGE = new Set(['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE']);
const CONFIRMED_PAYMENT_STATUSES = new Set([
  'CONFIRMADO',
  'RECEBIDO',
  'PAGO',
  'RECEIVED',
  'CONFIRMED',
]);
const CONFIRMED_PAYMENT_STATUS_VALUES = [...CONFIRMED_PAYMENT_STATUSES];
const DEFAULT_REPORT_MAX_ROWS = 50_000;
const ACADEMIC_CHARGE_TYPES: TipoCobranca[] = [
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'EXTRA',
  'AVULSA',
  'PARCELADA',
  'RECORRENTE',
];
const ACADEMIC_PAYMENT_METHODS: FormaPagamento[] = [
  'BOLETO',
  'PIX',
  'CARTAO_CREDITO',
  'INDEFINIDO',
];

export class FinancialReportRowLimitError extends Error {
  constructor(readonly limit: number) {
    super(`O relatório excede o limite seguro de ${limit} registros.`);
    this.name = 'FinancialReportRowLimitError';
  }
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Math.round((Number.isFinite(parsed) ? parsed : 0) * 100) / 100;
}

function sum(values: number[]): number {
  return money(values.reduce((total, value) => total + value, 0));
}

function canonicalPaymentMethod(value: string | null): string | null {
  if (value === 'CREDIT_CARD') return 'CARTAO_CREDITO';
  if (value === 'UNDEFINED') return 'INDEFINIDO';
  return value;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : 'America/Sao_Paulo';
}

function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function zonedDayStart(date: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  let instant = Date.UTC(year, month - 1, day);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = partsAt(new Date(instant), timeZone);
    const actualUtc = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
    );
    instant -= actualUtc - Date.UTC(year, month - 1, day);
  }
  return new Date(instant);
}

function nextDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function localDayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localMonthKey(date: Date, timeZone: string): string {
  return localDayKey(date, timeZone).slice(0, 7);
}

function localTodayStart(now: Date, timeZone: string): Date {
  return zonedDayStart(localDayKey(now, timeZone), timeZone);
}

function daysBetween(start: Date, end: Date, timeZone: string): number {
  const startDay = Date.parse(`${localDayKey(start, timeZone)}T00:00:00.000Z`);
  const endDay = Date.parse(`${localDayKey(end, timeZone)}T00:00:00.000Z`);
  return Math.max(0, Math.floor((endDay - startDay) / 86_400_000));
}

function academicStatus(
  status: string,
  dueDate: Date,
  nowStart: Date,
  receivedAmount: number,
  outstandingAmount: number,
): FinancialReportStatus {
  if (CANCELED_COBRANCA.has(status)) return 'CANCELED';
  if (status === 'ESTORNADO' || status === 'ESTORNADO_PARCIAL') return 'REFUNDED';
  if (outstandingAmount <= 0 && (receivedAmount > 0 || PAID_COBRANCA.has(status))) return 'PAID';
  if (PROCESSING_COBRANCA.has(status)) return 'PROCESSING';
  if (dueDate < nowStart || status === 'ATRASADO') return 'OVERDUE';
  return 'OPEN';
}

function standaloneStatus(
  status: string,
  dueDate: Date | null,
  nowStart: Date,
): FinancialReportStatus {
  if (CANCELED_CHARGE.has(status)) return 'CANCELED';
  if (status === 'REFUNDED') return 'REFUNDED';
  if (PAID_CHARGE.has(status)) return 'PAID';
  if (status === 'PENDING_SYNC') return 'PROCESSING';
  if ((dueDate && dueDate < nowStart) || status === 'OVERDUE') return 'OVERDUE';
  return OPEN_CHARGE.has(status) ? 'OPEN' : 'PROCESSING';
}

function effectiveDate(
  row: FinancialReportProjection,
  basis: FinancialReportQuery['dateBasis'],
): Date | null {
  if (basis === 'PAID_AT') return row.paidAt;
  if (basis === 'SETTLED_AT') return row.settledAt;
  if (basis === 'COMPETENCE') return row.competenceAt;
  return row.dueDate;
}

function labelFor(key: string): string {
  const labels: Record<string, string> = {
    OPEN: 'A receber',
    PROCESSING: 'Em processamento',
    PAID: 'Recebido',
    OVERDUE: 'Em atraso',
    CANCELED: 'Cancelado',
    REFUNDED: 'Estornado',
    ACADEMIC: 'Acadêmica',
    STANDALONE: 'Avulsa',
    MENSALIDADE: 'Mensalidade',
    TAXA_MATRICULA: 'Taxa de matrícula',
    EXTRA: 'Extra',
    AVULSA: 'Avulsa',
    PARCELADA: 'Parcelada',
    RECORRENTE: 'Recorrente',
    BOLETO: 'Boleto',
    PIX: 'Pix',
    CARTAO_CREDITO: 'Cartão de crédito',
    CREDIT_CARD: 'Cartão de crédito',
    INDEFINIDO: 'Não definida',
    UNKNOWN: 'Não informada',
  };
  return labels[key] ?? key.replaceAll('_', ' ').toLocaleLowerCase('pt-BR');
}

function serialize(row: FinancialReportProjection): FinancialReportDetailItem {
  return {
    ...row,
    dueDate: row.dueDate?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    competenceAt: row.competenceAt?.toISOString() ?? null,
  };
}

function calculateSummary(
  rows: FinancialReportProjection[],
  nowStart: Date,
): FinancialMetricSummary {
  const validRows = rows.filter((row) => row.status !== 'CANCELED');
  const uniqueCharges = [
    ...new Map(validRows.map((row) => [`${row.source}:${row.sourceId}`, row])).values(),
  ];
  const receiptRows = validRows.filter((row) => row.receivedAmount > 0);
  const overdue = uniqueCharges.filter((row) => row.status === 'OVERDUE');
  const matured = uniqueCharges.filter((row) => row.dueDate && row.dueDate < nowStart);
  const received = sum(receiptRows.map((row) => row.receivedAmount));
  const receivedCount = receiptRows.length;
  const maturedAmount = sum(matured.map((row) => row.grossAmount));
  const overdueAmount = sum(overdue.map((row) => row.outstandingAmount));
  return {
    totalCharges: sum(uniqueCharges.map((row) => row.grossAmount)),
    received,
    receivable: sum(
      uniqueCharges.filter((row) => row.status === 'OPEN').map((row) => row.outstandingAmount),
    ),
    overdue: overdueAmount,
    processing: sum(
      uniqueCharges
        .filter((row) => row.status === 'PROCESSING')
        .map((row) => row.outstandingAmount),
    ),
    fees: sum(receiptRows.map((row) => row.feeAmount)),
    refunds: sum(receiptRows.map((row) => row.refundedAmount)),
    net: sum(receiptRows.map((row) => row.netAmount)),
    toSettle: sum(
      receiptRows.filter((row) => row.settlementStatus === 'PENDENTE').map((row) => row.netAmount),
    ),
    available: sum(
      receiptRows
        .filter((row) => row.settlementStatus === 'DISPONIVEL')
        .map((row) => row.netAmount),
    ),
    averageTicket: receivedCount ? money(received / receivedCount) : 0,
    delinquencyRate: maturedAmount ? money((overdueAmount / maturedAmount) * 100) : 0,
    chargeCount: uniqueCharges.length,
    receivedCount,
    overdueCount: overdue.length,
  };
}

function monthlyEquivalent(value: number, cycle: string | null | undefined): number {
  const normalizedCycle = cycle?.trim().toUpperCase();
  if (normalizedCycle === 'SEMANAL' || normalizedCycle === 'WEEKLY') return value * (52 / 12);
  if (normalizedCycle === 'QUINZENAL' || normalizedCycle === 'BIWEEKLY') {
    return value * (26 / 12);
  }
  if (normalizedCycle === 'TRIMESTRAL' || normalizedCycle === 'QUARTERLY') return value / 3;
  if (normalizedCycle === 'SEMESTRAL' || normalizedCycle === 'SEMIANNUALLY') return value / 6;
  if (normalizedCycle === 'ANUAL' || normalizedCycle === 'YEARLY') return value / 12;
  return value;
}

export async function getCurrentAverageTicket(params: {
  contaId: string;
  db: ReportDb;
  referenceDate?: Date;
}): Promise<number> {
  const referenceDate = params.referenceDate ?? new Date();
  const enrollments = await params.db.matricula.findMany({
    where: {
      contaId: params.contaId,
      dataInicio: { lte: referenceDate },
      dataFimContrato: { gt: referenceDate },
      OR: [{ status: 'ATIVA' }, { status: 'PAUSADA', cobrarDurantePausa: true }],
    },
    select: {
      id: true,
      plano: { select: { valor: true, periodicidade: true } },
      combo: { select: { valor: true, periodicidade: true } },
      billingAllocations: {
        where: {
          kind: 'TUITION',
          recurring: true,
          status: { in: ['ACTIVE', 'SCHEDULED'] },
          validFrom: { lte: referenceDate },
          OR: [{ validUntil: null }, { validUntil: { gt: referenceDate } }],
          agreement: {
            status: {
              in: [
                'ACTIVE',
                'PENDING_PROVISION',
                'CANCELLATION_PENDING',
                'REQUIRES_RECONCILIATION',
              ],
            },
          },
        },
        select: {
          netAmount: true,
          agreement: { select: { cycle: true } },
        },
      },
    },
  });
  if (enrollments.length === 0) return 0;

  const totalMonthlyValue = enrollments.reduce((total, enrollment) => {
    const billingAllocations = enrollment.billingAllocations ?? [];
    if (billingAllocations.length > 0) {
      return (
        total +
        sum(
          billingAllocations.map((allocation) =>
            monthlyEquivalent(Number(allocation.netAmount), allocation.agreement.cycle),
          ),
        )
      );
    }
    const pricing = enrollment.combo ?? enrollment.plano;
    return total + monthlyEquivalent(Number(pricing?.valor ?? 0), pricing?.periodicidade);
  }, 0);

  return money(totalMonthlyValue / enrollments.length);
}

function breakdown(
  rows: FinancialReportProjection[],
  keyOf: (row: FinancialReportProjection) => string,
  amountOf: (row: FinancialReportProjection) => number = (row) => row.grossAmount,
): FinancialReportBreakdownItem[] {
  const groups = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const key = keyOf(row) || 'UNKNOWN';
    const current = groups.get(key) ?? { amount: 0, count: 0 };
    current.amount += amountOf(row);
    current.count += 1;
    groups.set(key, current);
  }
  const total = sum([...groups.values()].map((item) => item.amount));
  return [...groups.entries()]
    .map(([key, value]) => ({
      key,
      label: labelFor(key),
      amount: money(value.amount),
      count: value.count,
      percentage: total ? money((value.amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function series(
  rows: FinancialReportProjection[],
  timeZone: string,
  basis: FinancialReportQuery['dateBasis'],
): FinancialReportSeriesItem[] {
  const groups = new Map<string, FinancialReportSeriesItem>();
  const chargedSources = new Set<string>();
  const orderedRows = [...rows].sort((left, right) => {
    const leftDate = effectiveDate(left, basis)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightDate = effectiveDate(right, basis)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftDate - rightDate || left.id.localeCompare(right.id);
  });
  for (const row of orderedRows) {
    const date = effectiveDate(row, basis);
    if (!date) continue;
    const key = localMonthKey(date, timeZone);
    const current = groups.get(key) ?? {
      key,
      label: new Intl.DateTimeFormat('pt-BR', {
        month: 'short',
        year: 'numeric',
        timeZone,
      }).format(date),
      charged: 0,
      received: 0,
      overdue: 0,
      net: 0,
    };
    const sourceKey = `${row.source}:${row.sourceId}`;
    if (row.status !== 'CANCELED' && !chargedSources.has(sourceKey)) {
      current.charged += row.grossAmount;
      chargedSources.add(sourceKey);
    }
    if (row.receivedAmount > 0) {
      current.received += row.receivedAmount;
      current.net += row.netAmount;
    }
    if (row.status === 'OVERDUE') current.overdue += row.outstandingAmount;
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((item) => ({
      ...item,
      charged: money(item.charged),
      received: money(item.received),
      overdue: money(item.overdue),
      net: money(item.net),
    }));
}

function ranking(
  rows: FinancialReportProjection[],
  dimension: 'class' | 'plan',
  nowStart: Date,
): FinancialReportRankingItem[] {
  const groups = new Map<
    string,
    FinancialReportRankingItem & {
      students: Set<string>;
      sources: Set<string>;
      maturedAmount: number;
    }
  >();
  for (const row of rows.filter((item) => item.origin === 'ACADEMIC')) {
    const id = dimension === 'class' ? row.turmaId : row.planoId;
    const name = dimension === 'class' ? row.turmaName : row.planoName;
    if (!id || !name) continue;
    const current = groups.get(id) ?? {
      id,
      name,
      charged: 0,
      received: 0,
      overdue: 0,
      delinquencyRate: 0,
      studentCount: 0,
      students: new Set<string>(),
      sources: new Set<string>(),
      maturedAmount: 0,
    };
    const sourceKey = `${row.source}:${row.sourceId}`;
    if (!current.sources.has(sourceKey)) {
      if (row.status !== 'CANCELED') current.charged += row.grossAmount;
      if (row.status !== 'CANCELED' && row.dueDate && row.dueDate < nowStart) {
        current.maturedAmount += row.grossAmount;
      }
      if (row.status === 'OVERDUE') current.overdue += row.outstandingAmount;
      current.sources.add(sourceKey);
    }
    if (row.receivedAmount > 0) current.received += row.receivedAmount;
    if (row.studentId) current.students.add(row.studentId);
    groups.set(id, current);
  }
  return [...groups.values()]
    .map(({ students, sources: _sources, maturedAmount, ...item }) => ({
      ...item,
      charged: money(item.charged),
      received: money(item.received),
      overdue: money(item.overdue),
      delinquencyRate: maturedAmount ? money((item.overdue / maturedAmount) * 100) : 0,
      studentCount: students.size,
    }))
    .sort((a, b) => b.charged - a.charged)
    .slice(0, 10);
}

async function loadClassOccupancy(params: {
  contaId: string;
  turmaId?: string;
  db: ReportDb;
  referenceDate: Date;
}): Promise<FinancialClassOccupancyItem[]> {
  const classes = await params.db.turma.findMany({
    where: {
      contaId: params.contaId,
      status: 'ATIVO',
      ...(params.turmaId ? { id: params.turmaId } : {}),
    },
    select: { id: true, nome: true, capacidade: true },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
  });
  const classIds = classes.map((item) => item.id);
  if (classIds.length === 0) return [];

  const enrollments = await params.db.matricula.findMany({
    where: {
      contaId: params.contaId,
      ...buildSeatOccupancyWhereClause(params.referenceDate),
      OR: [
        { turmaId: { in: classIds } },
        { matriculaTurmas: { some: { turmaId: { in: classIds } } } },
      ],
    },
    select: {
      id: true,
      turmaId: true,
      matriculaTurmas: {
        where: { turmaId: { in: classIds } },
        select: { turmaId: true },
      },
    },
  });

  const occupiedByClass = new Map<string, Set<string>>();
  for (const enrollment of enrollments) {
    const enrollmentClasses = new Set<string>();
    if (enrollment.turmaId) enrollmentClasses.add(enrollment.turmaId);
    for (const relation of enrollment.matriculaTurmas) enrollmentClasses.add(relation.turmaId);
    for (const classId of enrollmentClasses) {
      const occupied = occupiedByClass.get(classId) ?? new Set<string>();
      occupied.add(enrollment.id);
      occupiedByClass.set(classId, occupied);
    }
  }

  return classes
    .map((item) => {
      const occupiedSeats = occupiedByClass.get(item.id)?.size ?? 0;
      return {
        id: item.id,
        name: item.nome,
        capacity: item.capacidade,
        occupiedSeats,
        occupancyRate: item.capacidade > 0 ? money((occupiedSeats / item.capacidade) * 100) : 0,
      };
    })
    .sort(
      (left, right) =>
        right.occupancyRate - left.occupancyRate || left.name.localeCompare(right.name),
    );
}

async function loadEnrollmentSeries(params: {
  contaId: string;
  query: FinancialReportQuery;
  db: ReportDb;
  timeZone: string;
}): Promise<{
  series: FinancialEnrollmentSeriesItem[];
  health: FinancialEnrollmentHealth;
  cancellationsByClass: FinancialCancellationRankingItem[];
}> {
  const start = zonedDayStart(params.query.startDate, params.timeZone);
  const end = zonedDayStart(nextDay(params.query.endDate), params.timeZone);
  const dimensionWhere: Prisma.MatriculaWhereInput = {
    ...(params.query.turmaId
      ? {
          OR: [
            { turmaId: params.query.turmaId },
            { matriculaTurmas: { some: { turmaId: params.query.turmaId } } },
          ],
        }
      : {}),
    ...(params.query.planoId ? { planoId: params.query.planoId } : {}),
  };
  const enrollments = await params.db.matricula.findMany({
    where: {
      contaId: params.contaId,
      AND: [
        dimensionWhere,
        {
          OR: [
            { status: { in: ['ATIVA', 'PAUSADA'] } },
            { createdAt: { gte: start, lt: end } },
            { status: 'CANCELADA', updatedAt: { gte: start, lt: end } },
          ],
        },
      ],
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      turma: { select: { id: true, nome: true } },
      matriculaTurmas: {
        select: { turma: { select: { id: true, nome: true } } },
      },
    },
  });
  const groups = new Map<string, FinancialEnrollmentSeriesItem>();
  const cursor = new Date(`${params.query.startDate.slice(0, 7)}-01T00:00:00.000Z`);
  const finalMonth = params.query.endDate.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= finalMonth) {
    const key = cursor.toISOString().slice(0, 7);
    groups.set(key, {
      key,
      label: new Intl.DateTimeFormat('pt-BR', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      }).format(cursor),
      enrollments: 0,
      cancellations: 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  for (const enrollment of enrollments) {
    if (enrollment.createdAt >= start && enrollment.createdAt < end) {
      const key = localMonthKey(enrollment.createdAt, params.timeZone);
      const item = groups.get(key);
      if (item) item.enrollments += 1;
    }
    if (
      enrollment.status === 'CANCELADA' &&
      enrollment.updatedAt >= start &&
      enrollment.updatedAt < end
    ) {
      const key = localMonthKey(enrollment.updatedAt, params.timeZone);
      const item = groups.get(key);
      if (item) item.cancellations += 1;
    }
  }
  const series = [...groups.values()];
  const cancellationsByClassMap = new Map<string, FinancialCancellationRankingItem>();
  for (const enrollment of enrollments) {
    if (
      enrollment.status !== 'CANCELADA' ||
      enrollment.updatedAt < start ||
      enrollment.updatedAt >= end
    ) {
      continue;
    }

    const classes = new Map<string, string>();
    if (enrollment.turma) classes.set(enrollment.turma.id, enrollment.turma.nome);
    for (const relation of enrollment.matriculaTurmas) {
      classes.set(relation.turma.id, relation.turma.nome);
    }
    for (const [id, name] of classes) {
      const current = cancellationsByClassMap.get(id) ?? { id, name, cancellations: 0 };
      current.cancellations += 1;
      cancellationsByClassMap.set(id, current);
    }
  }
  const cancellationsByClass = [...cancellationsByClassMap.values()].sort(
    (left, right) =>
      right.cancellations - left.cancellations || left.name.localeCompare(right.name),
  );
  const activeEnrollments = enrollments.filter((item) =>
    ['ATIVA', 'PAUSADA'].includes(item.status),
  ).length;
  const enrollmentsInPeriod = series.reduce((total, item) => total + item.enrollments, 0);
  const cancellationsInPeriod = series.reduce((total, item) => total + item.cancellations, 0);
  const openingActiveEnrollments = Math.max(
    0,
    activeEnrollments - enrollmentsInPeriod + cancellationsInPeriod,
  );
  const retentionRate =
    openingActiveEnrollments > 0
      ? money(Math.max(0, 1 - cancellationsInPeriod / openingActiveEnrollments) * 100)
      : null;
  return {
    series,
    health: {
      activeEnrollments,
      enrollmentsInPeriod,
      cancellationsInPeriod,
      openingActiveEnrollments,
      retentionRate,
    },
    cancellationsByClass,
  };
}

function paginate<T>(items: T[], page: number, pageSize: number): FinancialReportPage<T> {
  const total = items.length;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function sortRows(
  rows: FinancialReportProjection[],
  query: FinancialReportQuery,
): FinancialReportProjection[] {
  const factor = query.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left =
      query.sort === 'grossAmount' || query.sort === 'daysOverdue'
        ? a[query.sort]
        : query.sort === 'payerName' || query.sort === 'studentName'
          ? (a[query.sort] ?? '')
          : (a[query.sort]?.getTime() ?? 0);
    const right =
      query.sort === 'grossAmount' || query.sort === 'daysOverdue'
        ? b[query.sort]
        : query.sort === 'payerName' || query.sort === 'studentName'
          ? (b[query.sort] ?? '')
          : (b[query.sort]?.getTime() ?? 0);
    const comparison =
      (typeof left === 'string'
        ? left.localeCompare(String(right), 'pt-BR')
        : Number(left) - Number(right)) * factor;
    return comparison || a.id.localeCompare(b.id);
  });
}

function matchesFilters(row: FinancialReportProjection, query: FinancialReportQuery): boolean {
  if (query.turmaId && row.turmaId !== query.turmaId) return false;
  if (query.planoId && row.planoId !== query.planoId) return false;
  if (query.chargeType.length && !query.chargeType.includes(row.type)) return false;
  if (query.paymentMethod.length && !query.paymentMethod.includes(row.paymentMethod ?? 'UNKNOWN'))
    return false;
  if (query.status.length && !query.status.includes(row.status)) return false;
  if (query.origin.length && !query.origin.includes(row.origin)) return false;
  if (query.search) {
    const haystack = [row.payerName, row.studentName, row.description, row.turmaName, row.planoName]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('pt-BR');
    if (!haystack.includes(query.search.toLocaleLowerCase('pt-BR'))) return false;
  }
  return true;
}

export async function validateFinancialReportDimensions(params: {
  contaId: string;
  query: FinancialReportQuery;
  db: ReportDb;
}): Promise<'TURMA_INVALIDA' | 'PLANO_INVALIDO' | null> {
  if (params.query.turmaId) {
    const turma = await params.db.turma.findFirst({
      where: { id: params.query.turmaId, contaId: params.contaId },
      select: { id: true },
    });
    if (!turma) return 'TURMA_INVALIDA';
  }
  if (params.query.planoId) {
    const plano = await params.db.plano.findFirst({
      where: { id: params.query.planoId, contaId: params.contaId },
      select: { id: true },
    });
    if (!plano) return 'PLANO_INVALIDO';
  }
  return null;
}

type PaymentRecord = {
  id: string;
  contaId: string;
  valorPago: unknown;
  status: string;
  dataPagamento: Date | null;
  formaPagamento: string;
  asaasPaymentId: string | null;
};

type AcademicRecord = {
  id: string;
  contaId: string;
  asaasPaymentId: string | null;
  tipo: string;
  descricao: string | null;
  valor: unknown;
  valorFinal: unknown;
  vencimento: Date;
  dataPagamento: Date | null;
  pagoEm: Date | null;
  formaPagamento: string;
  pagoPor: string | null;
  status: string;
  estornadoValor: unknown;
  asaasValue: unknown;
  asaasNetValue: unknown;
  asaasFeeValue: unknown;
  liquidacaoStatus: string;
  liquidadoEm: Date | null;
  asaasCreditDate: Date | null;
  competenciaInicio: Date;
  pagamentos: PaymentRecord[];
  matricula: {
    id: string;
    contaId: string;
    aluno: { id: string; contaId: string; nome: string };
    responsavelFinanceiro: {
      id: string;
      contaId: string;
      nome: string;
      email: string;
      telefone: string;
    } | null;
    turma: { id: string; contaId: string; nome: string } | null;
    plano: { id: string; contaId: string; nome: string } | null;
  };
};

type StandaloneRecord = {
  id: string;
  contaId: string;
  asaasPaymentId: string | null;
  description: string | null;
  value: unknown;
  dueDate: Date | null;
  billingType: string | null;
  payerName: string | null;
  status: string;
  asaasValue: unknown;
  asaasNetValue: unknown;
  asaasFeeValue: unknown;
  liquidacaoStatus: string;
  liquidadoEm: Date | null;
  asaasCreditDate: Date | null;
  customer: { contaId: string; payerType: string; payerId: string } | null;
};

function academicOwnershipIsValid(item: AcademicRecord, contaId: string): boolean {
  const enrollment = item.matricula;
  return (
    item.contaId === contaId &&
    enrollment.contaId === contaId &&
    enrollment.aluno.contaId === contaId &&
    (!enrollment.responsavelFinanceiro || enrollment.responsavelFinanceiro.contaId === contaId) &&
    (!enrollment.turma || enrollment.turma.contaId === contaId) &&
    (!enrollment.plano || enrollment.plano.contaId === contaId) &&
    item.pagamentos.every((payment) => payment.contaId === contaId)
  );
}

function standaloneOwnershipIsValid(item: StandaloneRecord, contaId: string): boolean {
  return item.contaId === contaId && (!item.customer || item.customer.contaId === contaId);
}

function confirmedPayments(item: AcademicRecord): PaymentRecord[] {
  return item.pagamentos.filter((payment) =>
    CONFIRMED_PAYMENT_STATUSES.has(payment.status.toUpperCase()),
  );
}

function allocateAcrossPayments(total: number, eventId: string, payments: PaymentRecord[]): number {
  if (total <= 0 || payments.length === 0) return 0;
  const ordered = [...payments].sort(
    (left, right) =>
      (left.dataPagamento?.getTime() ?? 0) - (right.dataPagamento?.getTime() ?? 0) ||
      left.id.localeCompare(right.id),
  );
  const denominator = sum(ordered.map((payment) => money(payment.valorPago)));
  if (denominator <= 0) return 0;
  let allocated = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const payment = ordered[index];
    const portion =
      index === ordered.length - 1
        ? money(total - allocated)
        : money(total * (money(payment.valorPago) / denominator));
    if (payment.id === eventId) return portion;
    allocated = money(allocated + portion);
  }
  return 0;
}

function mapAcademicProjection(params: {
  item: AcademicRecord;
  paymentEvent?: PaymentRecord;
  now: Date;
  nowStart: Date;
  timeZone: string;
}): FinancialReportProjection {
  const { item, paymentEvent, now, nowStart, timeZone } = params;
  const payments = confirmedPayments(item);
  const grossAmount = money(item.asaasValue ?? item.valorFinal ?? item.valor);
  const legacyReceived = payments.length === 0 && PAID_COBRANCA.has(item.status) ? grossAmount : 0;
  const totalReceived = sum(payments.map((payment) => money(payment.valorPago))) || legacyReceived;
  const totalRefunded =
    item.status === 'ESTORNADO'
      ? totalReceived || grossAmount
      : item.status === 'ESTORNADO_PARCIAL'
        ? money(item.estornadoValor)
        : 0;
  const terminalWithoutOutstanding =
    CANCELED_COBRANCA.has(item.status) ||
    item.status === 'ESTORNADO' ||
    item.status === 'ESTORNADO_PARCIAL';
  const outstandingAmount = terminalWithoutOutstanding
    ? 0
    : money(Math.max(0, grossAmount - totalReceived));
  const status = academicStatus(
    item.status,
    item.vencimento,
    nowStart,
    totalReceived,
    outstandingAmount,
  );
  const totalFee = money(
    item.asaasFeeValue ??
      (item.asaasValue !== null && item.asaasNetValue !== null
        ? money(item.asaasValue) - money(item.asaasNetValue)
        : 0),
  );
  const eventReceived = paymentEvent ? money(paymentEvent.valorPago) : totalReceived;
  const feeAmount = paymentEvent
    ? allocateAcrossPayments(totalFee, paymentEvent.id, payments)
    : totalFee;
  const refundedAmount = paymentEvent
    ? allocateAcrossPayments(totalRefunded, paymentEvent.id, payments)
    : totalRefunded;
  const payer = item.matricula.responsavelFinanceiro;
  const canonicalPaidAt =
    paymentEvent?.dataPagamento ??
    [...payments]
      .sort(
        (left, right) =>
          (left.dataPagamento?.getTime() ?? 0) - (right.dataPagamento?.getTime() ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .at(-1)?.dataPagamento ??
    item.pagoEm ??
    item.dataPagamento ??
    null;

  return {
    id: paymentEvent ? `COBRANCA:${item.id}:PAGAMENTO:${paymentEvent.id}` : `COBRANCA:${item.id}`,
    sourceId: item.id,
    source: 'COBRANCA',
    origin: 'ACADEMIC',
    type: item.tipo,
    description: item.descricao,
    status,
    payerId: payer?.id ?? null,
    payerName: payer?.nome ?? item.matricula.aluno.nome,
    payerEmail: payer?.email ?? null,
    payerPhone: payer?.telefone ?? null,
    studentId: item.matricula.aluno.id,
    studentName: item.matricula.aluno.nome,
    matriculaId: item.matricula.id,
    turmaId: item.matricula.turma?.id ?? null,
    turmaName: item.matricula.turma?.nome ?? null,
    planoId: item.matricula.plano?.id ?? null,
    planoName: item.matricula.plano?.nome ?? null,
    paymentMethod:
      paymentEvent?.formaPagamento?.trim() || item.pagoPor?.trim() || item.formaPagamento,
    grossAmount,
    receivedAmount: eventReceived,
    outstandingAmount,
    feeAmount,
    refundedAmount,
    netAmount: money(eventReceived - feeAmount - refundedAmount),
    dueDate: item.vencimento,
    paidAt: canonicalPaidAt,
    settledAt: item.liquidadoEm ?? item.asaasCreditDate,
    competenceAt: item.competenciaInicio,
    settlementStatus: item.liquidacaoStatus,
    daysOverdue: status === 'OVERDUE' ? daysBetween(item.vencimento, now, timeZone) : 0,
  };
}

function buildDataQuality(params: {
  inconsistentOwnership: number;
  duplicateStandalone: number;
  standaloneWithoutCanonicalPaidAt: number;
  academicWithoutCanonicalPaidAt: number;
}): FinancialReportDataQuality {
  const warnings: string[] = [];
  if (params.inconsistentOwnership > 0) {
    warnings.push(
      `${params.inconsistentOwnership} registro(s) foram excluídos por vínculo de tenant inconsistente.`,
    );
  }
  if (params.duplicateStandalone > 0) {
    warnings.push(
      `${params.duplicateStandalone} cobrança(s) avulsa(s) duplicadas por identificador de pagamento foram excluídas.`,
    );
  }
  if (params.standaloneWithoutCanonicalPaidAt > 0) {
    warnings.push(
      `${params.standaloneWithoutCanonicalPaidAt} cobrança(s) avulsa(s) recebidas não entraram na visão por pagamento porque não possuem data canônica de recebimento.`,
    );
  }
  if (params.academicWithoutCanonicalPaidAt > 0) {
    warnings.push(
      `${params.academicWithoutCanonicalPaidAt} cobrança(s) acadêmica(s) legadas recebidas foram excluídas porque não possuem pagoEm nem dataPagamento.`,
    );
  }
  return {
    excludedRecords:
      params.inconsistentOwnership +
      params.duplicateStandalone +
      params.standaloneWithoutCanonicalPaidAt +
      params.academicWithoutCanonicalPaidAt,
    warnings,
  };
}

export async function loadFinancialReportProjections(params: {
  contaId: string;
  query: FinancialReportQuery;
  db: ReportDb;
  now?: Date;
  maxRows?: number;
  paymentEventMode?: boolean;
}): Promise<{
  rows: FinancialReportProjection[];
  timeZone: string;
  nowStart: Date;
  dataQuality: FinancialReportDataQuality;
}> {
  const account = await params.db.conta.findFirst({
    where: { id: params.contaId },
    select: { timezone: true },
  });
  if (!account) throw new Error('TENANT_NOT_FOUND');
  const timeZone = normalizeTimeZone(account.timezone);
  const now = params.now ?? new Date();
  const nowStart = localTodayStart(now, timeZone);
  const start = zonedDayStart(params.query.startDate, timeZone);
  const endExclusive = zonedDayStart(nextDay(params.query.endDate), timeZone);
  const maxRows = params.maxRows ?? DEFAULT_REPORT_MAX_ROWS;
  const academicRelationWhere: Prisma.MatriculaWhereInput = {
    contaId: params.contaId,
    ...(params.query.turmaId ? { turmaId: params.query.turmaId } : {}),
    ...(params.query.planoId ? { planoId: params.query.planoId } : {}),
  };
  const academicChargeTypes = ACADEMIC_CHARGE_TYPES.filter((type) =>
    params.query.chargeType.includes(type),
  );
  const academicPaymentMethods = ACADEMIC_PAYMENT_METHODS.filter((method) =>
    params.query.paymentMethod.includes(method),
  );
  const standalonePaymentMethods = params.query.paymentMethod.flatMap((method) =>
    method === 'CARTAO_CREDITO'
      ? ['CARTAO_CREDITO', 'CREDIT_CARD']
      : method === 'INDEFINIDO'
        ? ['INDEFINIDO', 'UNDEFINED']
        : [method],
  );
  const academicBaseWhere: Prisma.CobrancaWhereInput = {
    contaId: params.contaId,
    ...(academicChargeTypes.length ? { tipo: { in: academicChargeTypes } } : {}),
    matricula: { is: academicRelationWhere },
  };
  const academicSelect = {
    id: true,
    contaId: true,
    asaasPaymentId: true,
    tipo: true,
    descricao: true,
    valor: true,
    valorFinal: true,
    vencimento: true,
    dataPagamento: true,
    pagoEm: true,
    formaPagamento: true,
    pagoPor: true,
    status: true,
    estornadoValor: true,
    asaasValue: true,
    asaasNetValue: true,
    asaasFeeValue: true,
    liquidacaoStatus: true,
    liquidadoEm: true,
    asaasCreditDate: true,
    competenciaInicio: true,
    pagamentos: {
      where: {
        contaId: params.contaId,
        status: { in: CONFIRMED_PAYMENT_STATUS_VALUES },
      },
      select: {
        id: true,
        contaId: true,
        valorPago: true,
        status: true,
        dataPagamento: true,
        formaPagamento: true,
        asaasPaymentId: true,
      },
      orderBy: [{ dataPagamento: 'asc' as const }, { id: 'asc' as const }],
    },
    matricula: {
      select: {
        id: true,
        contaId: true,
        aluno: { select: { id: true, contaId: true, nome: true } },
        responsavelFinanceiro: {
          select: {
            id: true,
            contaId: true,
            nome: true,
            email: true,
            telefone: true,
          },
        },
        turma: { select: { id: true, contaId: true, nome: true } },
        plano: { select: { id: true, contaId: true, nome: true } },
      },
    },
  } satisfies Prisma.CobrancaSelect;

  const academicRows: FinancialReportProjection[] = [];
  let inconsistentOwnership = 0;
  let academicWithoutCanonicalPaidAt = 0;
  const academicDateWhere: Prisma.CobrancaWhereInput =
    params.query.dateBasis === 'SETTLED_AT'
      ? {
          OR: [
            { liquidadoEm: { gte: start, lt: endExclusive } },
            {
              liquidadoEm: null,
              asaasCreditDate: { gte: start, lt: endExclusive },
            },
          ],
        }
      : params.query.dateBasis === 'COMPETENCE'
        ? { competenciaInicio: { gte: start, lt: endExclusive } }
        : { vencimento: { gte: start, lt: endExclusive } };
  const usePaymentEvents = params.query.dateBasis === 'PAID_AT' || params.paymentEventMode === true;

  const academicIsInScope =
    (params.query.origin.length === 0 || params.query.origin.includes('ACADEMIC')) &&
    (params.query.chargeType.length === 0 || academicChargeTypes.length > 0) &&
    (params.query.paymentMethod.length === 0 || academicPaymentMethods.length > 0);
  if (academicIsInScope) {
    if (usePaymentEvents) {
      const paymentEvents = await params.db.pagamento.findMany({
        where: {
          contaId: params.contaId,
          status: { in: CONFIRMED_PAYMENT_STATUS_VALUES },
          ...(params.query.dateBasis === 'PAID_AT'
            ? { dataPagamento: { gte: start, lt: endExclusive } }
            : {}),
          ...(academicPaymentMethods.length
            ? { formaPagamento: { in: academicPaymentMethods } }
            : {}),
          cobranca: {
            is: {
              ...academicBaseWhere,
              ...(params.query.dateBasis === 'PAID_AT' ? {} : academicDateWhere),
            },
          },
        },
        select: {
          id: true,
          contaId: true,
          valorPago: true,
          status: true,
          dataPagamento: true,
          formaPagamento: true,
          asaasPaymentId: true,
          cobranca: { select: academicSelect },
        },
        orderBy: [{ dataPagamento: 'asc' }, { id: 'asc' }],
        take: maxRows + 1,
      });
      if (paymentEvents.length > maxRows) throw new FinancialReportRowLimitError(maxRows);
      for (const event of paymentEvents) {
        if (
          event.contaId !== params.contaId ||
          (params.query.dateBasis === 'PAID_AT' && !event.dataPagamento) ||
          !academicOwnershipIsValid(event.cobranca, params.contaId)
        ) {
          inconsistentOwnership += 1;
          continue;
        }
        academicRows.push(
          mapAcademicProjection({
            item: event.cobranca,
            paymentEvent: event,
            now,
            nowStart,
            timeZone,
          }),
        );
      }
      if (params.query.dateBasis === 'PAID_AT') {
        const legacyPaymentMethodWhere: Prisma.CobrancaWhereInput =
          academicPaymentMethods.length > 0
            ? {
                OR: [
                  { pagoPor: { in: academicPaymentMethods } },
                  {
                    pagoPor: null,
                    formaPagamento: { in: academicPaymentMethods },
                  },
                ],
              }
            : {};
        const legacyBaseWhere: Prisma.CobrancaWhereInput = {
          ...academicBaseWhere,
          status: { in: ['PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
          pagamentos: { none: { contaId: params.contaId } },
          ...legacyPaymentMethodWhere,
        };
        academicWithoutCanonicalPaidAt = await params.db.cobranca.count({
          where: {
            ...legacyBaseWhere,
            pagoEm: null,
            dataPagamento: null,
          },
        });
        const remainingRows = Math.max(0, maxRows - academicRows.length);
        const legacyAcademic = await params.db.cobranca.findMany({
          where: {
            ...legacyBaseWhere,
            OR: [
              { pagoEm: { gte: start, lt: endExclusive } },
              {
                pagoEm: null,
                dataPagamento: { gte: start, lt: endExclusive },
              },
            ],
          },
          select: academicSelect,
          orderBy: [{ pagoEm: 'asc' }, { dataPagamento: 'asc' }, { id: 'asc' }],
          take: remainingRows + 1,
        });
        if (legacyAcademic.length > remainingRows) {
          throw new FinancialReportRowLimitError(maxRows);
        }
        for (const item of legacyAcademic) {
          if (!PAID_COBRANCA.has(item.status)) continue;
          if (confirmedPayments(item).length > 0) continue;
          if (!academicOwnershipIsValid(item, params.contaId)) {
            inconsistentOwnership += 1;
            continue;
          }
          academicRows.push(mapAcademicProjection({ item, now, nowStart, timeZone }));
        }
      }
    } else {
      const academic = await params.db.cobranca.findMany({
        where: {
          ...academicBaseWhere,
          ...academicDateWhere,
          ...(academicPaymentMethods.length
            ? { formaPagamento: { in: academicPaymentMethods } }
            : {}),
        },
        select: academicSelect,
        orderBy: [{ vencimento: 'asc' }, { id: 'asc' }],
        take: maxRows + 1,
      });
      if (academic.length > maxRows) throw new FinancialReportRowLimitError(maxRows);
      for (const item of academic) {
        if (!academicOwnershipIsValid(item, params.contaId)) {
          inconsistentOwnership += 1;
          continue;
        }
        academicRows.push(mapAcademicProjection({ item, now, nowStart, timeZone }));
      }
    }
  }

  const remainingRows = Math.max(0, maxRows - academicRows.length);
  let standaloneWithoutCanonicalPaidAt = 0;
  let standalone: StandaloneRecord[] = [];
  const standaloneIsInScope =
    (params.query.origin.length === 0 || params.query.origin.includes('STANDALONE')) &&
    (params.query.chargeType.length === 0 || params.query.chargeType.includes('AVULSA')) &&
    !params.query.turmaId &&
    !params.query.planoId;
  const standaloneBaseWhere: Prisma.ChargeWhereInput = {
    contaId: params.contaId,
    cobrancaId: null,
    ...(standalonePaymentMethods.length ? { billingType: { in: standalonePaymentMethods } } : {}),
    ...(params.query.search
      ? {
          OR: [
            {
              payerName: {
                contains: params.query.search,
                mode: 'insensitive' as const,
              },
            },
            {
              description: {
                contains: params.query.search,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {}),
  };
  if (standaloneIsInScope && params.query.dateBasis === 'PAID_AT') {
    standaloneWithoutCanonicalPaidAt = await params.db.charge.count({
      where: {
        ...standaloneBaseWhere,
        status: { in: ['PAID', 'REFUNDED'] },
      },
    });
  }
  if (
    standaloneIsInScope &&
    params.query.dateBasis !== 'PAID_AT' &&
    params.query.dateBasis !== 'COMPETENCE'
  ) {
    const standaloneDateWhere =
      params.query.dateBasis === 'SETTLED_AT'
        ? {
            OR: [
              { liquidadoEm: { gte: start, lt: endExclusive } },
              {
                liquidadoEm: null,
                asaasCreditDate: { gte: start, lt: endExclusive },
              },
            ],
          }
        : { dueDate: { gte: start, lt: endExclusive } };
    standalone = (await params.db.charge.findMany({
      where: {
        ...standaloneBaseWhere,
        ...standaloneDateWhere,
      },
      select: {
        id: true,
        contaId: true,
        asaasPaymentId: true,
        description: true,
        value: true,
        dueDate: true,
        billingType: true,
        payerName: true,
        status: true,
        asaasValue: true,
        asaasNetValue: true,
        asaasFeeValue: true,
        liquidacaoStatus: true,
        liquidadoEm: true,
        asaasCreditDate: true,
        customer: {
          select: { contaId: true, payerType: true, payerId: true },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      take: remainingRows + 1,
    })) as StandaloneRecord[];
    if (standalone.length > remainingRows) throw new FinancialReportRowLimitError(maxRows);
  }

  const standalonePaymentIds = standalone
    .map((item) => item.asaasPaymentId)
    .filter((value): value is string => Boolean(value));
  const duplicatePaymentIds = new Set<string>();
  if (standalonePaymentIds.length > 0) {
    const duplicateAcademic = await params.db.cobranca.findMany({
      where: {
        contaId: params.contaId,
        OR: [
          { asaasPaymentId: { in: standalonePaymentIds } },
          {
            pagamentos: {
              some: {
                contaId: params.contaId,
                asaasPaymentId: { in: standalonePaymentIds },
              },
            },
          },
        ],
      },
      select: {
        asaasPaymentId: true,
        pagamentos: {
          where: {
            contaId: params.contaId,
            asaasPaymentId: { in: standalonePaymentIds },
          },
          select: { asaasPaymentId: true },
        },
      },
    });
    for (const item of duplicateAcademic) {
      if (item.asaasPaymentId) duplicatePaymentIds.add(item.asaasPaymentId);
      for (const payment of item.pagamentos) {
        if (payment.asaasPaymentId) duplicatePaymentIds.add(payment.asaasPaymentId);
      }
    }
  }

  const standaloneRows: FinancialReportProjection[] = [];
  let duplicateStandalone = 0;
  for (const item of standalone) {
    if (!standaloneOwnershipIsValid(item, params.contaId)) {
      inconsistentOwnership += 1;
      continue;
    }
    if (item.asaasPaymentId && duplicatePaymentIds.has(item.asaasPaymentId)) {
      duplicateStandalone += 1;
      continue;
    }
    const status = standaloneStatus(item.status, item.dueDate, nowStart);
    const grossAmount = money(item.asaasValue ?? item.value);
    const receivedAmount = status === 'PAID' || status === 'REFUNDED' ? grossAmount : 0;
    const feeAmount = money(
      item.asaasFeeValue ??
        (item.asaasValue !== null && item.asaasNetValue !== null
          ? money(item.asaasValue) - money(item.asaasNetValue)
          : 0),
    );
    const refundedAmount = status === 'REFUNDED' ? receivedAmount : 0;
    standaloneRows.push({
      id: `CHARGE:${item.id}`,
      sourceId: item.id,
      source: 'CHARGE',
      origin: 'STANDALONE',
      type: 'AVULSA',
      description: item.description,
      status,
      payerId: null,
      payerName: item.payerName ?? 'Pagador não informado',
      payerEmail: null,
      payerPhone: null,
      studentId: null,
      studentName: item.customer?.payerType === 'ALUNO' ? item.payerName : null,
      matriculaId: null,
      turmaId: null,
      turmaName: null,
      planoId: null,
      planoName: null,
      paymentMethod: canonicalPaymentMethod(item.billingType),
      grossAmount,
      receivedAmount,
      outstandingAmount:
        status === 'OPEN' || status === 'OVERDUE' || status === 'PROCESSING' ? grossAmount : 0,
      feeAmount,
      refundedAmount,
      netAmount: money(receivedAmount - feeAmount - refundedAmount),
      dueDate: item.dueDate,
      paidAt: null,
      settledAt: item.liquidadoEm ?? item.asaasCreditDate,
      competenceAt: null,
      settlementStatus: item.liquidacaoStatus,
      daysOverdue:
        status === 'OVERDUE' && item.dueDate ? daysBetween(item.dueDate, now, timeZone) : 0,
    });
  }

  const dataQuality = buildDataQuality({
    inconsistentOwnership,
    duplicateStandalone,
    standaloneWithoutCanonicalPaidAt,
    academicWithoutCanonicalPaidAt,
  });
  const rows = [...academicRows, ...standaloneRows].filter((row) =>
    matchesFilters(row, params.query),
  );
  return {
    rows,
    timeZone,
    nowStart,
    dataQuality,
  };
}

export async function getFinancialOverviewReport(params: {
  contaId: string;
  query: FinancialReportQuery;
  db: ReportDb;
  now?: Date;
}): Promise<FinancialOverviewReport> {
  const loaded = await loadFinancialReportProjections(params);
  const sorted = sortRows(loaded.rows, params.query);
  const classOccupancy = await loadClassOccupancy({
    contaId: params.contaId,
    turmaId: params.query.turmaId,
    db: params.db,
    referenceDate: params.now ?? new Date(),
  });
  const enrollment = await loadEnrollmentSeries({
    contaId: params.contaId,
    query: params.query,
    db: params.db,
    timeZone: loaded.timeZone,
  });
  const currentAverageTicket = await getCurrentAverageTicket({
    contaId: params.contaId,
    db: params.db,
    referenceDate: params.now ?? new Date(),
  });
  const summary = calculateSummary(sorted, loaded.nowStart);
  return {
    view: 'overview',
    generatedAt: (params.now ?? new Date()).toISOString(),
    timeZone: loaded.timeZone,
    dateBasis: params.query.dateBasis,
    summary: { ...summary, averageTicket: currentAverageTicket },
    series: series(sorted, loaded.timeZone, params.query.dateBasis),
    enrollmentSeries: enrollment.series,
    enrollmentHealth: enrollment.health,
    statusBreakdown: breakdown(
      sorted,
      (row) => row.status,
      (row) => {
        if (row.status === 'OPEN' || row.status === 'OVERDUE' || row.status === 'PROCESSING') {
          return row.outstandingAmount;
        }
        if (row.status === 'PAID' || row.status === 'REFUNDED') {
          return row.receivedAmount;
        }
        return row.grossAmount;
      },
    ),
    typeBreakdown: breakdown(
      sorted.filter((row) => row.status !== 'CANCELED'),
      (row) => row.type,
    ),
    paymentMethodBreakdown: breakdown(
      sorted.filter((row) => row.receivedAmount > 0),
      (row) => row.paymentMethod ?? 'UNKNOWN',
      (row) => row.receivedAmount,
    ),
    rankingByClass: ranking(sorted, 'class', loaded.nowStart),
    rankingByPlan: ranking(sorted, 'plan', loaded.nowStart),
    cancellationsByClass: enrollment.cancellationsByClass,
    classOccupancy,
    details: paginate(sorted.map(serialize), params.query.page, params.query.pageSize),
    dataQuality: loaded.dataQuality,
  };
}

export async function getDelinquencyReport(params: {
  contaId: string;
  query: FinancialReportQuery;
  db: ReportDb;
  now?: Date;
}): Promise<DelinquencyReport> {
  const loaded = await loadFinancialReportProjections({
    ...params,
    query: { ...params.query, dateBasis: 'DUE_DATE', status: [] },
  });
  const overdue = sortRows(
    loaded.rows.filter((row) => row.status === 'OVERDUE'),
    { ...params.query, sort: 'daysOverdue', direction: 'desc' },
  );
  const recovered = await loadFinancialReportProjections({
    ...params,
    query: {
      ...params.query,
      dateBasis: 'PAID_AT',
      status: [],
    },
  });
  const grouped = new Map<string, DelinquencyGroupItem>();
  for (const row of overdue) {
    if (!row.dueDate) continue;
    const key = row.payerId ?? `${row.payerName}:${row.matriculaId ?? row.sourceId}`;
    const current = grouped.get(key) ?? {
      payerId: row.payerId,
      payerName: row.payerName,
      payerEmail: row.payerEmail,
      payerPhone: row.payerPhone,
      studentNames: [],
      turmaNames: [],
      chargeCount: 0,
      oldestDueDate: row.dueDate.toISOString(),
      daysOverdue: row.daysOverdue,
      overdueAmount: 0,
      matriculaIds: [],
      chargeIds: [],
    };
    if (row.studentName && !current.studentNames.includes(row.studentName))
      current.studentNames.push(row.studentName);
    if (row.turmaName && !current.turmaNames.includes(row.turmaName))
      current.turmaNames.push(row.turmaName);
    if (row.matriculaId && !current.matriculaIds.includes(row.matriculaId))
      current.matriculaIds.push(row.matriculaId);
    current.chargeIds.push(row.sourceId);
    current.chargeCount += 1;
    current.overdueAmount = money(current.overdueAmount + row.outstandingAmount);
    if (row.dueDate.toISOString() < current.oldestDueDate)
      current.oldestDueDate = row.dueDate.toISOString();
    current.daysOverdue = Math.max(current.daysOverdue, row.daysOverdue);
    grouped.set(key, current);
  }
  const details = [...grouped.values()].sort((a, b) => b.overdueAmount - a.overdueAmount);
  const summary = calculateSummary(loaded.rows, loaded.nowStart);
  const enrollmentIds = new Set(overdue.map((row) => row.matriculaId).filter(Boolean));
  const agingKey = (row: FinancialReportProjection) => {
    if (row.daysOverdue <= 7) return '1–7 dias';
    if (row.daysOverdue <= 15) return '8–15 dias';
    if (row.daysOverdue <= 30) return '16–30 dias';
    if (row.daysOverdue <= 60) return '31–60 dias';
    return 'Mais de 60 dias';
  };
  return {
    view: 'delinquency',
    generatedAt: (params.now ?? new Date()).toISOString(),
    timeZone: loaded.timeZone,
    dateBasis: 'DUE_DATE',
    summary: {
      ...summary,
      payerCount: details.length,
      enrollmentCount: enrollmentIds.size,
      averageDaysOverdue: overdue.length
        ? Math.round(overdue.reduce((total, row) => total + row.daysOverdue, 0) / overdue.length)
        : 0,
      recoveredAmount: sum(
        recovered.rows
          .filter(
            (row) => row.paidAt && row.dueDate && row.paidAt.getTime() > row.dueDate.getTime(),
          )
          .map((row) => money(row.receivedAmount - row.refundedAmount)),
      ),
    },
    aging: breakdown(overdue, agingKey, (row) => row.outstandingAmount),
    details: paginate(details, params.query.page, params.query.pageSize),
    dataQuality: {
      excludedRecords: loaded.dataQuality.excludedRecords + recovered.dataQuality.excludedRecords,
      warnings: [...new Set([...loaded.dataQuality.warnings, ...recovered.dataQuality.warnings])],
    },
  };
}

export async function getReceiptsReport(params: {
  contaId: string;
  query: FinancialReportQuery;
  db: ReportDb;
  now?: Date;
}): Promise<ReceiptsReport> {
  const loaded = await loadFinancialReportProjections({
    ...params,
    paymentEventMode: true,
    query: {
      ...params.query,
      dateBasis: params.query.dateBasis === 'DUE_DATE' ? 'PAID_AT' : params.query.dateBasis,
      status: [],
    },
  });
  const sorted = sortRows(
    loaded.rows.filter((row) => row.receivedAmount > 0),
    {
      ...params.query,
      sort: params.query.sort === 'dueDate' ? 'paidAt' : params.query.sort,
    },
  );
  const effectiveBasis = params.query.dateBasis === 'DUE_DATE' ? 'PAID_AT' : params.query.dateBasis;
  return {
    view: 'receipts',
    generatedAt: (params.now ?? new Date()).toISOString(),
    timeZone: loaded.timeZone,
    dateBasis: effectiveBasis,
    summary: calculateSummary(sorted, loaded.nowStart),
    series: series(sorted, loaded.timeZone, effectiveBasis),
    paymentMethodBreakdown: breakdown(
      sorted,
      (row) => row.paymentMethod ?? 'UNKNOWN',
      (row) => row.receivedAmount,
    ),
    details: paginate(sorted.map(serialize), params.query.page, params.query.pageSize),
    dataQuality: loaded.dataQuality,
  };
}

export async function getFinancialReportFilterOptions(params: { contaId: string; db: ReportDb }) {
  const [turmas, planos] = await Promise.all([
    params.db.turma.findMany({
      where: { contaId: params.contaId },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
    params.db.plano.findMany({
      where: { contaId: params.contaId },
      select: { id: true, nome: true },
      orderBy: { nome: 'asc' },
    }),
  ]);
  return { turmas, planos };
}
