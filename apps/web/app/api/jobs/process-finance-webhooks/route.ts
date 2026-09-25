import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import {
  drainFinanceWebhookSideEffectOutbox,
  FINANCE_SIDE_EFFECT_TYPES,
  processAsaasWebhookQueueWithInbox,
  runWebhookQueuePreflight,
} from '@alusa/finance';
import { apiJsonError } from '@/lib/api/standard-response';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { ensureEventAsaasPaymentProviderRegistered } from '@/src/server/events/register-event-asaas-payment-provider';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function jsonError(status: number, code: string, message: string) {
  return apiJsonError(status, code, message);
}

/**
 * POST /api/jobs/process-finance-webhooks
 *
 * Processa fila assíncrona de webhooks (status PENDENTE/ERRO).
 * Executa preflight (stuck recovery + DLQ) antes do drain.
 *
 * Query params:
 * - contaId (opcional): restringe processamento para 1 conta.
 * - limit (opcional): número máximo de webhooks por execução (default 100).
 * - onlyErrored (opcional): se "true", processa apenas status ERRO.
 * - skipPreflight (opcional): se "true", pula stuck recovery e marcação DLQ.
 */
async function run(req: Request) {
  const startedAt = Date.now();
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
    ensureEventAsaasPaymentProviderRegistered();
    const limitRaw = Number(url.searchParams.get('limit') ?? '100');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;
    const requestedEffectType = url.searchParams.get('effectType');
    if (requestedEffectType && !FINANCE_SIDE_EFFECT_TYPES.includes(requestedEffectType as (typeof FINANCE_SIDE_EFFECT_TYPES)[number])) {
      return jsonError(400, 'TIPO_DE_EFEITO_INVALIDO', 'O tipo de efeito solicitado não é suportado.');
    }
    const effectTypes = requestedEffectType
      ? [requestedEffectType as (typeof FINANCE_SIDE_EFFECT_TYPES)[number]]
      : undefined;
    const onlyErrored = url.searchParams.get('onlyErrored') === 'true';
    const skipPreflight = url.searchParams.get('skipPreflight') === 'true';

    const preflight = skipPreflight
      ? null
      : await runWebhookQueuePreflight({
          contaId,
        });

    const processed = await processAsaasWebhookQueueWithInbox({
      contaId,
      limit,
      statuses: onlyErrored ? ['ERRO'] : ['PENDENTE', 'ERRO'],
      source: tenantScope.isCron ? 'WEBHOOK' : 'REPROCESS',
      drainSideEffects: false,
    });

    const sideEffects = await drainFinanceWebhookSideEffectOutbox({
      contaId,
      limit: Math.max(50, limit),
      effectTypes,
    });

    const response = {
      success: true,
      preflight,
      processed,
      sideEffects,
    };
    logJobResult('process-finance-webhooks', startedAt, {
      processed: processed.processed,
      failed: processed.failed,
      sideEffectsProcessed: sideEffects.processed,
      sideEffectsFailed: sideEffects.failed,
    }, { hasTenantScope: Boolean(contaId) });
    return NextResponse.json(response);
  } catch (error) {
    logJobFailure('process-finance-webhooks', startedAt, error);
    return jsonError(500, 'ERRO_JOB', 'Não foi possível processar os webhooks financeiros.');
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
