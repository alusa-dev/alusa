import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
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
 * - mode (opcional): targeted (default) ou safety_sweep
 * - providerCheckIntervalMinutes (opcional): intervalo mínimo por registro
 * - maxAsaasCalls (opcional): orçamento por conta nesta execução
 * - accountConcurrency (opcional): contas simultâneas, default 2
 * - maxDurationMs (opcional): deadline por conta
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
    const requestedMode = url.searchParams.get('mode');
    if (requestedMode && requestedMode !== 'targeted' && requestedMode !== 'safety_sweep') {
      return jsonError(400, 'MODO_INVALIDO', 'mode deve ser targeted ou safety_sweep.');
    }
    const mode = requestedMode === 'safety_sweep' ? 'safety_sweep' : 'targeted';
    const maxAsaasCallsRaw = Number(url.searchParams.get('maxAsaasCalls') ?? '100');
    const accountConcurrencyRaw = Number(url.searchParams.get('accountConcurrency') ?? '2');
    const providerCheckIntervalRaw = Number(
      url.searchParams.get('providerCheckIntervalMinutes') ?? (mode === 'safety_sweep' ? '1440' : '360'),
    );
    const maxDurationRaw = Number(url.searchParams.get('maxDurationMs') ?? '100000');
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const includeGapsParam = url.searchParams.get('includeGaps');
    const includeGaps = includeGapsParam === null ? tenantScope.isCron : includeGapsParam === 'true';

    const windowHours = Number.isFinite(windowHoursRaw) ? Math.max(1, Math.min(24 * 30, windowHoursRaw)) : 24;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
    const maxAccounts = Number.isFinite(maxAccountsRaw) ? Math.max(1, Math.min(50, maxAccountsRaw)) : 20;
    const maxAsaasCalls = Number.isFinite(maxAsaasCallsRaw) ? Math.max(1, Math.min(1000, maxAsaasCallsRaw)) : 100;
    const accountConcurrency = Number.isFinite(accountConcurrencyRaw) ? Math.max(1, Math.min(5, accountConcurrencyRaw)) : 2;
    const providerCheckIntervalMinutes = Number.isFinite(providerCheckIntervalRaw)
      ? Math.max(5, Math.min(7 * 24 * 60, providerCheckIntervalRaw))
      : 360;
    const maxDurationMs = Number.isFinite(maxDurationRaw) ? Math.max(5000, Math.min(110000, maxDurationRaw)) : 100000;

    const commonJobOptions = {
      windowHours,
      limit,
      dryRun,
      includeGaps,
      mode: mode as 'targeted' | 'safety_sweep',
      providerCheckIntervalMinutes,
      maxAsaasCalls,
      accountConcurrency,
      maxDurationMs,
    };

    if (contaId) {
      const job = await reconcileFinanceWebhooksJob({
        contaId,
        ...commonJobOptions,
        maxAccounts: 1,
      });

      const accountResult = job.results[0];
      return NextResponse.json({
        success: job.outcome === 'completed',
        mode: 'webhooks',
        job,
        reconcile: accountResult?.reconcile ?? null,
        gaps: accountResult?.gaps ?? null,
      }, { status: job.outcome === 'failed' ? 502 : job.outcome === 'partial' ? 207 : 200 });
    }

    const job = await reconcileFinanceWebhooksJob({
      ...commonJobOptions,
      maxAccounts,
    });

    return NextResponse.json({
      success: job.outcome === 'completed',
      mode: 'webhooks',
      job,
    }, { status: job.outcome === 'failed' ? 502 : job.outcome === 'partial' ? 207 : 200 });
  } catch (error) {
    console.error('[Job Reconcile Finance Webhooks] Erro não classificado:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
    return jsonError(500, 'ERRO_JOB', 'Não foi possível concluir a reconciliação financeira.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
