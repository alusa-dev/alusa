import { NextResponse } from 'next/server';
import { notifyContractsExpiringJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  listContasForContractExpiration,
  notifyContractsExpiring,
} from '@alusa/lib/jobs/notify-contracts-expiring';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * GET/POST /api/jobs/notify-contracts-expiring
 *
 * Alerta contratos que vencem em 7, 3 ou 1 dia(s).
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const query = notifyContractsExpiringJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
    });
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: query.contaId,
      requireContaIdForCron: false,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const operationNow = new Date();
    if (tenantScope.contaId) {
      const result = await notifyContractsExpiring(tenantScope.contaId, { now: operationNow });
      return NextResponse.json({ success: true, tenants: 1, ...result });
    }

    const contaIds = await listContasForContractExpiration();

    let evaluated = 0;
    let notified = 0;
    for (const contaId of contaIds) {
      const result = await notifyContractsExpiring(contaId, { now: operationNow });
      evaluated += result.evaluated;
      notified += result.notified;
    }

    return NextResponse.json({
      success: true,
      tenants: contaIds.length,
      evaluated,
      notified,
    });
  } catch (error) {
    console.error('[Job Notify Contracts Expiring] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível notificar contratos próximos do vencimento.');
  }
}

export async function GET(req: Request) {
  return POST(req);
}
