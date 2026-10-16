import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
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
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
        const tenantScope = await resolveTenantScopeForJob('process-overdue-billing-notifications', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('process-overdue-billing-notifications');
const query = processOverdueBillingNotificationsJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      limit: url.searchParams.get('limit'),
    });

    const limit = query.limit;

    if (tenantScope.contaId) {
      const result = await processLocalOverdueBillingNotifications({
        contaId: tenantScope.contaId,
        limit,
      });
      logJobResult('process-overdue-billing-notifications', startedAt, {
        tenants: 1,
        emitted: result.emitted,
        skipped: result.skipped,
      }, { workStatus: result.emitted > 0 ? 'worked' : result.skipped > 0 ? 'unknown' : 'empty' });
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

    logJobResult('process-overdue-billing-notifications', startedAt, {
      tenants: contaIds.length,
      emitted,
      skipped,
    }, { workStatus: emitted > 0 ? 'worked' : skipped > 0 ? 'unknown' : 'empty' });

    return NextResponse.json({
      success: true,
      tenants: contaIds.length,
      emitted,
      skipped,
    });
  } catch (error) {
    if (startedAt) logJobFailure('process-overdue-billing-notifications', startedAt, error);
    return jsonError(
      500,
      'ERRO_JOB',
      'Não foi possível processar as notificações de cobrança vencida.',
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
