import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { detectWebhookGaps, reconcileAsaasAccountsJob, reconcileWithAsaas } from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * POST /api/jobs/reconcile-finance-accounts
 *
 * Executa o job de reconciliação de contas financeiras com o provedor externo.
 * Sincroniza status de subcontas que estão em análise.
 *
 * Query params:
 * - contaId (opcional): se informado, processa apenas esta conta
 * - force (opcional): se "true", ignora throttle e força reconciliação
 * - mode (opcional): "accounts" (default) ou "webhooks"
 * - windowHours (opcional, mode=webhooks): janela de reconciliação (default 24)
 * - limit (opcional, mode=webhooks): limite por entidade (default 200)
 * - dryRun (opcional, mode=webhooks): se true, não persiste mudanças
 * - includeGaps (opcional, mode=webhooks): inclui detecção de gaps locais
 */
async function run(req: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('reconcile-finance-accounts', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('reconcile-finance-accounts');

    const contaId = tenantScope.contaId;
    const mode = (url.searchParams.get('mode') ?? 'accounts').toLowerCase();
    const forceReconcile = url.searchParams.get('force') === 'true';

    if (mode === 'webhooks') {
      const targetContaId = contaId;
      if (!targetContaId) {
        return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório para mode=webhooks.');
      }

      const windowHoursRaw = Number(url.searchParams.get('windowHours') ?? '24');
      const limitRaw = Number(url.searchParams.get('limit') ?? '200');
      const dryRun = url.searchParams.get('dryRun') === 'true';
      const includeGaps = url.searchParams.get('includeGaps') === 'true';

      const windowHours = Number.isFinite(windowHoursRaw)
        ? Math.max(1, Math.min(24 * 30, windowHoursRaw))
        : 24;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;

      const [reconcile, gaps] = await Promise.all([
        reconcileWithAsaas({
          contaId: targetContaId,
          windowHours,
          limit,
          dryRun,
        }),
        includeGaps
          ? detectWebhookGaps(targetContaId, {
              windowDays: Math.max(1, Math.ceil(windowHours / 24)),
            })
          : Promise.resolve(null),
      ]);

      logJobResult('reconcile-finance-accounts', startedAt, {
        checkedPayments: reconcile.checkedPayments,
        reconciledPayments: reconcile.reconciledPayments,
        checkedSubscriptions: reconcile.checkedSubscriptions,
        reconciledSubscriptions: reconcile.reconciledSubscriptions,
        checkedInstallments: reconcile.checkedInstallments,
        installmentDrift: reconcile.installmentDrift,
        errors: reconcile.errors.length,
        findingCount: gaps
          ? gaps.chargesWithMissingFinalStatus.length + gaps.subscriptionsWithMissingEvents.length
          : 0,
      }, {
        dryRun,
        partialFailure: reconcile.errors.length > 0 || reconcile.budgetExhausted,
        workStatus: reconcile.checkedPayments + reconcile.checkedSubscriptions +
          reconcile.checkedInstallments > 0 ? 'worked' : 'unknown',
      });

      return NextResponse.json({
        success: true,
        mode: 'webhooks',
        reconcile,
        gaps,
      });
    }

    const result = await reconcileAsaasAccountsJob({ contaId, forceReconcile });

    logJobResult('reconcile-finance-accounts', startedAt, {
      processadas: result.processadas,
      reconciliadas: result.reconciliadas,
      skippedThrottle: result.skippedThrottle,
      errors: result.erros.length,
    }, { partialFailure: result.erros.length > 0, workStatus: result.reconciliadas > 0 ? 'worked' : result.erros.length > 0 || result.skippedThrottle > 0 || result.processadas > 0 ? 'unknown' : 'empty' });

    return NextResponse.json({
      success: true,
      mode: 'accounts',
      ...result,
    });
  } catch (error) {
    if (startedAt) logJobFailure('reconcile-finance-accounts', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível reconciliar as contas financeiras.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
