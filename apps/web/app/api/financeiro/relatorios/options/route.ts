import {
  getFinancialReportFilterOptions,
} from '@alusa/finance';
import { financialReportOptionsDTOSchema } from '@/features/financeiro/relatorios/dtos';
import {
  financialReportJson,
  handleFinancialReportError,
  runFinancialReportRoute,
} from '../_shared';

export async function GET() {
  try {
    return runFinancialReportRoute(async ({ contaId, tx }) => {
      const options = await getFinancialReportFilterOptions({ contaId, db: tx });
      return financialReportJson(200, financialReportOptionsDTOSchema.parse(options));
    });
  } catch (error) {
    return handleFinancialReportError(error, 'options');
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

