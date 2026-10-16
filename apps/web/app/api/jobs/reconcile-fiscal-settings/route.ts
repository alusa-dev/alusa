import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';

import { reconcileFiscalSettingsJobQueryDTOSchema } from '@/features/jobs/dtos';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  listFiscalAccountsForReconciliation,
  syncFiscalSettingsFromProvider,
} from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * GET/POST /api/jobs/reconcile-fiscal-settings
 *
 * Reconcilia as configurações fiscais locais com o snapshot oficial do Asaas.
 *
 * Query params:
 * - contaId (opcional): processa apenas uma conta, validada contra sessão ou cron token
 * - maxAccounts (opcional): limite do cron multi-tenant, default 20
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
        const tenantScope = await resolveTenantScopeForJob('reconcile-fiscal-settings', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('reconcile-fiscal-settings');
const query = reconcileFiscalSettingsJobQueryDTOSchema.parse({
      contaId: url.searchParams.get('contaId'),
      maxAccounts: url.searchParams.get('maxAccounts'),
    });

    const maxAccounts = query.maxAccounts;
    const contaIds = tenantScope.contaId
      ? [tenantScope.contaId]
      : await listFiscalAccountsForReconciliation(maxAccounts);

    const results = await Promise.allSettled(
      contaIds.map(async (contaId) => ({
        contaId,
        result: await syncFiscalSettingsFromProvider({ contaId }),
      })),
    );

    const reconciled = results.map((item, index) => {
      const contaId = contaIds[index];
      if (item.status === 'rejected') {
        return {
          contaId,
          success: false,
          error: item.reason instanceof Error ? item.reason.message : 'Erro interno',
        };
      }

      return {
        contaId,
        success: item.value.result.success,
        data: item.value.result.success ? item.value.result.data : null,
        error: item.value.result.success ? null : item.value.result.error,
      };
    });
    const failed = reconciled.filter((item) => !item.success).length;
    logJobResult('reconcile-fiscal-settings', startedAt, {
      processed: reconciled.length,
      failed,
      reconciled: reconciled.length - failed,
    }, { partialFailure: failed > 0, workStatus: reconciled.length - failed > 0 ? 'worked' : failed > 0 || tenantScope.contaId ? 'unknown' : 'empty' });

    return NextResponse.json({
      success: reconciled.every((item) => item.success),
      mode: tenantScope.contaId ? 'single-account' : 'cron',
      processed: reconciled.length,
      reconciled,
    });
  } catch (error) {
    if (startedAt) logJobFailure('reconcile-fiscal-settings', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconciliar as configurações fiscais.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
