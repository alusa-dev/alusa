import { NextRequest } from 'next/server';

import { getReceiptsReport, validateFinancialReportDimensions } from '@alusa/finance';
import { receiptsReportDTOSchema } from '@/features/financeiro/relatorios/dtos';
import {
  financialReportJson,
  handleFinancialReportError,
  parseFinancialReportQuery,
  runFinancialReportRoute,
} from '../_shared';

export async function GET(request: NextRequest) {
  try {
    const query = parseFinancialReportQuery(request, {
      dateBasis: 'PAID_AT',
      sort: 'paidAt',
    });
    return runFinancialReportRoute(async ({ contaId, tx }) => {
      const invalidDimension = await validateFinancialReportDimensions({ contaId, query, db: tx });
      if (invalidDimension) return financialReportJson(422, { error: invalidDimension });
      const report = await getReceiptsReport({ contaId, query, db: tx });
      return financialReportJson(200, receiptsReportDTOSchema.parse(report));
    });
  } catch (error) {
    return handleFinancialReportError(error, 'receipts');
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

