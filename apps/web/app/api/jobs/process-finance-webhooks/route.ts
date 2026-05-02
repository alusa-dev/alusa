import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { emitBillingNotifications } from '@/lib/notifications/emit-billing-notifications';
import { processAsaasWebhookQueue } from '@alusa/finance';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/process-finance-webhooks
 *
 * Processa fila assíncrona de webhooks (status PENDENTE/ERRO).
 *
 * Query params:
 * - contaId (opcional): restringe processamento para 1 conta.
 * - limit (opcional): número máximo de webhooks por execução (default 100).
 * - onlyErrored (opcional): se "true", processa apenas status ERRO.
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
    const limitRaw = Number(url.searchParams.get('limit') ?? '100');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
    const onlyErrored = url.searchParams.get('onlyErrored') === 'true';

    const result = await processAsaasWebhookQueue({
      contaId,
      limit,
      statuses: onlyErrored ? ['ERRO'] : ['PENDENTE', 'ERRO'],
      source: tenantScope.isCron ? 'WEBHOOK' : 'REPROCESS',
    });

    try {
      await emitBillingNotifications(result.processedPayments, 'ASAAS_WEBHOOK');
    } catch (error) {
      console.warn('[Job Process Finance Webhooks] Falha não crítica ao emitir notificações', {
        contaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      success: true,
      processed: result,
    });
  } catch (error) {
    console.error('[Job Process Finance Webhooks] Erro:', error);
    return jsonError(500, 'ERRO_JOB', 'Falha ao processar fila de webhooks financeiros.');
  }
}
