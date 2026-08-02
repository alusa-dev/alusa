import { NextRequest } from 'next/server';

import { getDelinquencyReport, validateFinancialReportDimensions } from '@alusa/finance';
import { delinquencyReportDTOSchema } from '@/features/financeiro/relatorios/dtos';
import {
  financialReportJson,
  handleFinancialReportError,
  parseFinancialReportQuery,
  runFinancialReportRoute,
} from '../_shared';

export async function GET(request: NextRequest) {
  try {
    const query = parseFinancialReportQuery(request, {
      dateBasis: 'DUE_DATE',
      sort: 'daysOverdue',
    });
    return runFinancialReportRoute(async ({ contaId, tx }) => {
      const invalidDimension = await validateFinancialReportDimensions({ contaId, query, db: tx });
      if (invalidDimension) return financialReportJson(422, { error: invalidDimension });
      const report = await getDelinquencyReport({ contaId, query, db: tx });
      return financialReportJson(200, delinquencyReportDTOSchema.parse(report));
    });
  } catch (error) {
    return handleFinancialReportError(error, 'delinquency');
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

