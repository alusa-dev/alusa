import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { emitBillingNotificationCandidate } from '@/lib/notifications/emit-billing-notifications';
import { detectWebhookGaps, reconcileWithAsaas, syncPaymentStateFromAsaas } from '@alusa/finance';

export const dynamic = 'force-dynamic';

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/jobs/reconcile-finance-webhooks
 *
 * Reconcilia estado local com Asaas para pagamentos/assinaturas/parcelamentos.
 *
 * Query params:
 * - contaId (opcional): conta alvo
 * - asaasPaymentId (opcional): reconcilia um pagamento específico
 * - eventName (opcional): força evento sintético específico
 * - windowHours (opcional): janela de análise, default 24
 * - limit (opcional): limite por entidade, default 200
 * - dryRun (opcional): se true não persiste mudanças
 * - includeGaps (opcional): se true inclui detecção de gaps local
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
      requireContaIdForCron: true,
    });
    if (!tenantScope.ok) {
      return tenantScope.response;
    }

    const contaId = tenantScope.contaId;
    if (!contaId) {
      return jsonError(400, 'CONTA_OBRIGATORIA', 'contaId é obrigatório.');
    }

    const asaasPaymentId = url.searchParams.get('asaasPaymentId')?.trim();
    const eventName = url.searchParams.get('eventName')?.trim() || undefined;

    if (asaasPaymentId) {
      const result = await syncPaymentStateFromAsaas({
        contaId,
        asaasPaymentId,
        eventName,
      });

      if (!result.success) {
        return jsonError(422, 'PAGAMENTO_NAO_RECONCILIADO', result.error);
      }

      try {
        await emitBillingNotificationCandidate(
          {
            event: result.appliedEvent,
            asaasPaymentId,
          },
          'ASAAS_SYNC',
        );
      } catch (error) {
        console.warn('[Job Reconcile Finance Webhooks] Falha não crítica ao emitir notificação', {
          contaId,
          asaasPaymentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return NextResponse.json({
        success: true,
        mode: 'payment',
        reconcilePayment: result,
      });
    }

    const windowHoursRaw = Number(url.searchParams.get('windowHours') ?? '24');
    const limitRaw = Number(url.searchParams.get('limit') ?? '200');
    const dryRun = url.searchParams.get('dryRun') === 'true';
    const includeGaps = url.searchParams.get('includeGaps') === 'true';

    const windowHours = Number.isFinite(windowHoursRaw) ? Math.max(1, Math.min(24 * 30, windowHoursRaw)) : 24;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 200;

    const [reconcile, gaps] = await Promise.all([
      reconcileWithAsaas({
        contaId,
        windowHours,
        limit,
        dryRun,
      }),
      includeGaps ? detectWebhookGaps(contaId, { windowDays: Math.max(1, Math.ceil(windowHours / 24)) }) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      reconcile,
      gaps,
    });
  } catch (error) {
    console.error('[Job Reconcile Finance Webhooks] Erro:', error);
    return jsonError(500, 'ERRO_JOB', (error as Error).message);
  }
}
