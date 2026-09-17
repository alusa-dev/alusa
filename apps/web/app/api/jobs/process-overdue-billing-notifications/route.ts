import { NextResponse } from 'next/server';
import { processOverdueBillingNotificationsJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  listContasForOverdueBillingNotifications,
  processLocalOverdueBillingNotifications,
} from '@alusa/lib/notifications/process-overdue-billing';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * GET/POST /api/jobs/process-overdue-billing-notifications
 *
 * Emite notificações de cobrança vencida (fallback local ao webhook PAYMENT_OVERDUE).
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const query = processOverdueBillingNotificationsJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      limit: url.searchParams.get('limit'),
    });
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: query.contaId,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const limit = query.limit;

    if (tenantScope.contaId) {
      const result = await processLocalOverdueBillingNotifications({
        contaId: tenantScope.contaId,
        limit,
      });
      return NextResponse.json({ success: true, tenants: 1, ...result });
    }

    const contaIds = await listContasForOverdueBillingNotifications();

    let emitted = 0;
    let skipped = 0;
    for (const contaId of contaIds) {
      const result = await processLocalOverdueBillingNotifications({
        contaId,
        limit,
      });
      emitted += result.emitted;
      skipped += result.skipped;
    }

    return NextResponse.json({
      success: true,
      tenants: contaIds.length,
      emitted,
      skipped,
    });
  } catch (error) {
    console.error('[Job Process Overdue Billing] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível processar as notificações de cobrança vencida.');
  }
}

export async function GET(req: Request) {
  return POST(req);
}
