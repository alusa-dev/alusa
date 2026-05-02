import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { detectWebhookGaps, reconcileAsaasAccountsJob, reconcileWithAsaas } from '@alusa/finance';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
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
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

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

      const windowHours = Number.isFinite(windowHoursRaw) ? Math.max(1, Math.min(24 * 30, windowHoursRaw)) : 24;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;

      const [reconcile, gaps] = await Promise.all([
        reconcileWithAsaas({
          contaId: targetContaId,
          windowHours,
          limit,
          dryRun,
        }),
        includeGaps
          ? detectWebhookGaps(targetContaId, { windowDays: Math.max(1, Math.ceil(windowHours / 24)) })
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        success: true,
        mode: 'webhooks',
        reconcile,
        gaps,
      });
    }

    const result = await reconcileAsaasAccountsJob({ contaId, forceReconcile });

    return NextResponse.json({
      success: true,
      mode: 'accounts',
      ...result,
    });
  } catch (error) {
    console.error('[Job Reconcile Finance Accounts] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Falha ao reconciliar contas financeiras.');
  }
}
