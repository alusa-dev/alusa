import { NextResponse } from 'next/server';
import {
  evaluateFinancialOperationalHealth,
  listOpenFinancialOperationalAlerts,
} from '@alusa/finance';

import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { mapAdminFinancialOperationalHealthResultToDTO } from '@/features/system/mappers';
import { adminFinancialOperationalHealthResultDTOSchema } from '@/features/system/dtos';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  try {
    const auth = await resolveTenantSession();
    if (!auth.ok) return json(auth.reason === 'CONTA_MISMATCH' ? 403 : 401, { error: auth.reason === 'CONTA_MISMATCH' ? 'CONTA_INVALIDA' : 'NAO_AUTENTICADO' });
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return json(403, { error: 'SEM_PERMISSAO' });
    }

    const result = await evaluateFinancialOperationalHealth({ contaId: auth.contaId });
    const alerts = await listOpenFinancialOperationalAlerts(auth.contaId);

    return json(
      200,
      adminFinancialOperationalHealthResultDTOSchema.parse(
        mapAdminFinancialOperationalHealthResultToDTO({
          success: true,
          result,
          alerts,
        }),
      ),
    );
  } catch (error) {
    console.error('[Admin Financial Operational Health][GET]', error);
    return json(500, { error: 'ERRO_INTERNO' });
  }
}
