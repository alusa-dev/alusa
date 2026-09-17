import { getDashboardFinanceKpisLocal } from '@alusa/finance';

import { dashboardFinanceKpisResultDTOSchema } from '@/features/dashboard/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';
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
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    return Response.json(
      { success: false, error: 'Não autenticado' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }
  const { contaId } = auth;

  return cachedDashboardBlockWithTenant(contaId, 'finance-kpis', (tx) =>
    buildFinanceKpisBody(contaId, tx),
  );
}
