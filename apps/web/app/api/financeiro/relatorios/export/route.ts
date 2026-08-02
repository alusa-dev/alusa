import { NextRequest, NextResponse } from 'next/server';

import {
  financialReportViewSchema,
  loadFinancialReportProjections,
  validateFinancialReportDimensions,
} from '@alusa/finance';
import {
  financialReportJson,
  handleFinancialReportError,
  parseFinancialReportQuery,
  runFinancialReportRoute,
} from '../_shared';

const EXPORT_LIMIT = 10_000;

export function sanitizeCsvCellValue(value: unknown): string {
  const raw = String(value ?? '');
  const withoutControls = raw.replace(/[\u0000-\u001F\u007F]/g, ' ');
  const leftTrimmed = withoutControls.trimStart();
  return /^[=+\-@]/.test(leftTrimmed) ? `'${leftTrimmed}` : withoutControls;
}

function csvCell(value: unknown): string {
  return `"${sanitizeCsvCellValue(value).replaceAll('"', '""')}"`;
}

function formatMoney(value: number) {
  return value.toFixed(2).replace('.', ',');
}

function formatDate(value: Date | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat('pt-BR', { timeZone }).format(value)
    : '';
}

export async function GET(request: NextRequest) {
  try {
    const view = financialReportViewSchema.parse(request.nextUrl.searchParams.get('view') ?? 'overview');
    const query = parseFinancialReportQuery(request, {
      dateBasis: view === 'receipts' ? 'PAID_AT' : 'DUE_DATE',
    });
    return runFinancialReportRoute(async ({ contaId, userId, tx }) => {
      const invalidDimension = await validateFinancialReportDimensions({ contaId, query, db: tx });
      if (invalidDimension) return financialReportJson(422, { error: invalidDimension });

      const effectiveQuery = {
        ...query,
        dateBasis: view === 'delinquency' ? ('DUE_DATE' as const) : query.dateBasis,
        status:
          view === 'delinquency'
            ? (['OVERDUE'] as const)
            : view === 'receipts'
              ? ([] as const)
              : query.status,
      };
      const loaded = await loadFinancialReportProjections({
        contaId,
        query: { ...effectiveQuery, status: [...effectiveQuery.status] },
        db: tx,
        maxRows: EXPORT_LIMIT,
        paymentEventMode: view === 'receipts',
      });
      const rows =
        view === 'receipts'
          ? loaded.rows.filter((row) => row.receivedAmount > 0)
          : loaded.rows;
      const { timeZone } = loaded;

      const metadata = [
        ['Relatório', view === 'overview' ? 'Visão geral' : view === 'delinquency' ? 'Inadimplência' : 'Recebimentos'],
        ['Período', `${query.startDate} a ${query.endDate}`],
        ['Critério de data', effectiveQuery.dateBasis],
        ['Gerado em', new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone }).format(new Date())],
        [],
      ];
      const headers = [
        'Origem',
        'Tipo',
        'Situação',
        'Responsável financeiro',
        'Aluno',
        'Turma',
        'Plano',
        'Forma de pagamento',
        'Vencimento',
        'Pagamento',
        'Liquidação',
        'Valor da cobrança',
        'Valor recebido',
        'Saldo em aberto',
        'Taxas',
        'Estornos',
        'Valor líquido',
        'Dias em atraso',
      ];
      const csvRows = rows.map((row) => [
        row.origin === 'ACADEMIC' ? 'Acadêmica' : 'Avulsa',
        row.type,
        row.status,
        row.payerName,
        row.studentName,
        row.turmaName,
        row.planoName,
        row.paymentMethod,
        formatDate(row.dueDate, timeZone),
        formatDate(row.paidAt, timeZone),
        formatDate(row.settledAt, timeZone),
        formatMoney(row.grossAmount),
        formatMoney(row.receivedAmount),
        formatMoney(row.outstandingAmount),
        formatMoney(row.feeAmount),
        formatMoney(row.refundedAmount),
        formatMoney(row.netAmount),
        row.daysOverdue,
      ]);
      const csv = `\uFEFF${[
        ...metadata.map((line) => line.map(csvCell).join(';')),
        headers.map(csvCell).join(';'),
        ...csvRows.map((line) => line.map(csvCell).join(';')),
      ].join('\r\n')}`;
      const correlationId = crypto.randomUUID();
      const auditFilters = {
        startDate: query.startDate,
        endDate: query.endDate,
        dateBasis: effectiveQuery.dateBasis,
        turmaId: query.turmaId,
        planoId: query.planoId,
        chargeType: query.chargeType,
        paymentMethod: query.paymentMethod,
        status: effectiveQuery.status,
        origin: query.origin,
        sort: query.sort,
        direction: query.direction,
        searchApplied: Boolean(query.search),
      };

      await tx.auditLog.create({
        data: {
          contaId,
          actorType: 'USER',
          actorId: userId,
          action: 'FINANCIAL_REPORT_EXPORTED',
          entityType: 'FinancialReport',
          entityId: view,
          correlationId,
          metadata: {
            view,
            filters: auditFilters,
            rowCount: rows.length,
            excludedRecords: loaded.dataQuality.excludedRecords,
            format: 'CSV',
          },
        },
      });

      const filename = `alusa-${view === 'delinquency' ? 'inadimplencia' : view === 'receipts' ? 'recebimentos' : 'visao-geral'}-${query.startDate}-${query.endDate}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'private, no-store, max-age=0',
          'x-correlation-id': correlationId,
        },
      });
    });
  } catch (error) {
    return handleFinancialReportError(error, 'export');
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
