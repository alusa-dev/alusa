import { getServerSession } from 'next-auth';
import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import { authOptions } from '@/lib/auth-options';
import { dashboardFinanceKpisResultDTOSchema } from '@/features/dashboard/dtos';
import { runWithTenant, type TenantTransactionClient } from '@/lib/prisma-tenant';
import { logRuntimeEnvironmentOnce } from '@/lib/runtime-environment';
import { cachedDashboardBlockWithTenant } from '../_blocks';

async function buildFinanceKpisBody(contaId: string, tx: TenantTransactionClient) {
  const snapshot = await getDashboardFinanceKpisLocal({ contaId, db: tx });
  return dashboardFinanceKpisResultDTOSchema.parse({
    success: true,
    data: snapshot,
  });
}

export async function GET() {
  logRuntimeEnvironmentOnce('api/dashboard/finance-kpis');
  const session = await getServerSession(authOptions);
  const contaId = (session?.user as { contaId?: string | null } | undefined)?.contaId;

  if (!contaId) {
    return Response.json(
      { success: false, error: 'Não autenticado' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  return cachedDashboardBlockWithTenant(contaId, 'finance-kpis', (tx) =>
    buildFinanceKpisBody(contaId, tx),
  );
}
