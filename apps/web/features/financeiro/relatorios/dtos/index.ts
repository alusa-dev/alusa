import { z } from 'zod';

export type {
  DelinquencyGroupItem,
  FinancialClassOccupancyItem,
  FinancialEnrollmentSeriesItem,
  FinancialEnrollmentHealth,
  DelinquencyReport,
  FinancialMetricSummary,
  FinancialOverviewReport,
  FinancialReportBreakdownItem,
  FinancialReportDataQuality,
  FinancialReportDetailItem,
  FinancialReportPage,
  FinancialReportQuery,
  FinancialReportRankingItem,
  FinancialReportSeriesItem,
  FinancialReportView,
  ReceiptsReport,
} from '@alusa/finance/reports/financial-reports';

const nullableDateSchema = z.string().datetime().nullable();

export const financialMetricSummaryDTOSchema = z.object({
  totalCharges: z.number(),
  received: z.number(),
  receivable: z.number(),
  overdue: z.number(),
  processing: z.number(),
  fees: z.number(),
  refunds: z.number(),
  net: z.number(),
  toSettle: z.number(),
  available: z.number(),
  averageTicket: z.number(),
  delinquencyRate: z.number(),
  chargeCount: z.number().int(),
  receivedCount: z.number().int(),
  overdueCount: z.number().int(),
});

export const financialReportDetailDTOSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  source: z.enum(['COBRANCA', 'CHARGE']),
  origin: z.enum(['ACADEMIC', 'STANDALONE']),
  type: z.string(),
  description: z.string().nullable(),
  status: z.enum(['OPEN', 'PROCESSING', 'PAID', 'OVERDUE', 'CANCELED', 'REFUNDED']),
  payerId: z.string().nullable(),
  payerName: z.string(),
  payerEmail: z.string().nullable(),
  payerPhone: z.string().nullable(),
  studentId: z.string().nullable(),
  studentName: z.string().nullable(),
  matriculaId: z.string().nullable(),
  turmaId: z.string().nullable(),
  turmaName: z.string().nullable(),
  planoId: z.string().nullable(),
  planoName: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  grossAmount: z.number(),
  receivedAmount: z.number(),
  outstandingAmount: z.number(),
  feeAmount: z.number(),
  refundedAmount: z.number(),
  netAmount: z.number(),
  dueDate: nullableDateSchema,
  paidAt: nullableDateSchema,
  settledAt: nullableDateSchema,
  competenceAt: nullableDateSchema,
  settlementStatus: z.string(),
  daysOverdue: z.number().int().nonnegative(),
});

const seriesItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  charged: z.number(),
  received: z.number(),
  overdue: z.number(),
  net: z.number(),
});

const enrollmentSeriesItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  enrollments: z.number().int().nonnegative(),
  cancellations: z.number().int().nonnegative(),
});

const enrollmentHealthSchema = z.object({
  activeEnrollments: z.number().int().nonnegative(),
  enrollmentsInPeriod: z.number().int().nonnegative(),
  cancellationsInPeriod: z.number().int().nonnegative(),
  openingActiveEnrollments: z.number().int().nonnegative(),
  retentionRate: z.number().min(0).max(100).nullable(),
});

const breakdownItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  amount: z.number(),
  count: z.number().int(),
  percentage: z.number(),
});

const rankingItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  charged: z.number(),
  received: z.number(),
  overdue: z.number(),
  delinquencyRate: z.number(),
  studentCount: z.number().int(),
});

const classOccupancyItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  capacity: z.number().int().nonnegative(),
  occupiedSeats: z.number().int().nonnegative(),
  occupancyRate: z.number().nonnegative(),
});

const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    totalPages: z.number().int(),
  });

const dataQualitySchema = z.object({
  excludedRecords: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const financialOverviewReportDTOSchema = z.object({
  view: z.literal('overview'),
  generatedAt: z.string().datetime(),
  timeZone: z.string(),
  dateBasis: z.enum(['DUE_DATE', 'PAID_AT', 'SETTLED_AT', 'COMPETENCE']),
  summary: financialMetricSummaryDTOSchema,
  series: z.array(seriesItemSchema),
  enrollmentSeries: z.array(enrollmentSeriesItemSchema),
  enrollmentHealth: enrollmentHealthSchema,
  statusBreakdown: z.array(breakdownItemSchema),
  typeBreakdown: z.array(breakdownItemSchema),
  paymentMethodBreakdown: z.array(breakdownItemSchema),
  rankingByClass: z.array(rankingItemSchema),
  rankingByPlan: z.array(rankingItemSchema),
  classOccupancy: z.array(classOccupancyItemSchema),
  details: pageSchema(financialReportDetailDTOSchema),
  dataQuality: dataQualitySchema,
});

const delinquencyGroupSchema = z.object({
  payerId: z.string().nullable(),
  payerName: z.string(),
  payerEmail: z.string().nullable(),
  payerPhone: z.string().nullable(),
  studentNames: z.array(z.string()),
  turmaNames: z.array(z.string()),
  chargeCount: z.number().int(),
  oldestDueDate: z.string().datetime(),
  daysOverdue: z.number().int(),
  overdueAmount: z.number(),
  matriculaIds: z.array(z.string()),
  chargeIds: z.array(z.string()),
});

export const delinquencyReportDTOSchema = z.object({
  view: z.literal('delinquency'),
  generatedAt: z.string().datetime(),
  timeZone: z.string(),
  dateBasis: z.literal('DUE_DATE'),
  summary: financialMetricSummaryDTOSchema.extend({
    payerCount: z.number().int(),
    enrollmentCount: z.number().int(),
    averageDaysOverdue: z.number(),
    recoveredAmount: z.number(),
  }),
  aging: z.array(breakdownItemSchema),
  details: pageSchema(delinquencyGroupSchema),
  dataQuality: dataQualitySchema,
});

export const receiptsReportDTOSchema = z.object({
  view: z.literal('receipts'),
  generatedAt: z.string().datetime(),
  timeZone: z.string(),
  dateBasis: z.enum(['DUE_DATE', 'PAID_AT', 'SETTLED_AT', 'COMPETENCE']),
  summary: financialMetricSummaryDTOSchema,
  series: z.array(seriesItemSchema),
  paymentMethodBreakdown: z.array(breakdownItemSchema),
  details: pageSchema(financialReportDetailDTOSchema),
  dataQuality: dataQualitySchema,
});

export const financialReportOptionsDTOSchema = z.object({
  turmas: z.array(z.object({ id: z.string(), nome: z.string() })),
  planos: z.array(z.object({ id: z.string(), nome: z.string() })),
});
