import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  detectWebhookGaps,
  reconcileFinanceWebhooksJob,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/reconcile-finance-webhooks
 *
 * Reconcilia estado local com Asaas para pagamentos/assinaturas/parcelamentos.
 * Sem contaId (cron): processa até N contas ativas por execução.
 *
 * Query params:
 * - contaId (opcional): conta alvo
 * - asaasPaymentId (opcional): reconcilia um pagamento específico
 * - eventName (opcional): força evento sintético específico
 * - windowHours (opcional): janela de análise, default 24
 * - limit (opcional): limite por entidade, default 100
 * - maxAccounts (opcional): limite de contas no cron multi-tenant, default 20
 * - dryRun (opcional): se true não persiste mudanças
 * - includeGaps (opcional): se true inclui detecção de gaps local (default true no cron)
 */
async function run(req: Request) {
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
    const asaasPaymentId = url.searchParams.get('asaasPaymentId')?.trim();
    const eventName = url.searchParams.get('eventName')?.trim() || undefined;

    if (asaasPaymentId) {
      if (!contaId) {
        return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório para pagamento específico.');
      }

      const result = await syncPaymentStateFromAsaas({
        contaId,
        asaasPaymentId,
        eventName,
      });

      if (!result.success) {
        return jsonError(422, 'PAGAMENTO_NAO_RECONCILIADO', result.error);
      }

      return NextResponse.json({
        success: true,
        mode: 'payment',
        reconcilePayment: result,
      });
    }

    const windowHoursRaw = Number(url.searchParams.get('windowHours') ?? '24');
    const limitRaw = Number(url.searchParams.get('limit') ?? '100');
    const maxAccountsRaw = Number(url.searchParams.get('maxAccounts') ?? '20');
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const includeGapsParam = url.searchParams.get('includeGaps');
    const includeGaps = includeGapsParam === null ? tenantScope.isCron : includeGapsParam === 'true';

    const windowHours = Number.isFinite(windowHoursRaw) ? Math.max(1, Math.min(24 * 30, windowHoursRaw)) : 24;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
    const maxAccounts = Number.isFinite(maxAccountsRaw) ? Math.max(1, Math.min(50, maxAccountsRaw)) : 20;

    if (contaId) {
      const job = await reconcileFinanceWebhooksJob({
        contaId,
        windowHours,
        limit,
        dryRun,
        includeGaps,
        maxAccounts: 1,
      });

      const accountResult = job.results[0];
      return NextResponse.json({
        success: true,
        mode: 'webhooks',
        job,
        reconcile: accountResult?.reconcile ?? null,
        gaps: accountResult?.gaps ?? null,
      });
    }

    const job = await reconcileFinanceWebhooksJob({
      windowHours,
      limit,
      dryRun,
      includeGaps,
      maxAccounts,
    });

    return NextResponse.json({
      success: true,
      mode: 'webhooks',
      job,
    });
  } catch (error) {
    console.error('[Job Reconcile Finance Webhooks] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
