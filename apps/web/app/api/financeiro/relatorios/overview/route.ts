import { NextRequest } from 'next/server';

import {
  getFinancialOverviewReport,
  validateFinancialReportDimensions,
} from '@alusa/finance';
import { financialOverviewReportDTOSchema } from '@/features/financeiro/relatorios/dtos';
import {
  financialReportJson,
  handleFinancialReportError,
  parseFinancialReportQuery,
  runFinancialReportRoute,
} from '../_shared';

export async function GET(request: NextRequest) {
  try {
    const query = parseFinancialReportQuery(request);
    return runFinancialReportRoute(async ({ contaId, tx }) => {
      const invalidDimension = await validateFinancialReportDimensions({ contaId, query, db: tx });
      if (invalidDimension) return financialReportJson(422, { error: invalidDimension });
      const report = await getFinancialOverviewReport({ contaId, query, db: tx });
      return financialReportJson(200, financialOverviewReportDTOSchema.parse(report));
    });
  } catch (error) {
    return handleFinancialReportError(error, 'overview');
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

