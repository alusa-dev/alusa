import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { drainContractWhatsAppNotifications, drainWhatsAppOutbox, drainWhatsAppWebhooks } from '@/src/server/whatsapp/outbox.service';
import { apiJsonError } from '@/lib/api/standard-response';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

async function run(request: Request) {
  const startedAt = Date.now();
  try {
    const auth = await resolveTenantScope(request, { allowCron: true });
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const contractNotifications = await drainContractWhatsAppNotifications({
      contaId: auth.contaId,
      limit: toPositiveInt(url.searchParams.get('contractLimit'), 50, 200),
    });
    const outbox = await drainWhatsAppOutbox({
      limit: toPositiveInt(url.searchParams.get('outboxLimit'), 50, 200),
    });
    const webhooks = await drainWhatsAppWebhooks({
      limit: toPositiveInt(url.searchParams.get('webhookLimit'), 100, 500),
    });
    const hasFailures =
      contractNotifications.retried > 0 ||
      contractNotifications.deadLettered > 0 ||
      outbox.retried > 0 ||
      outbox.deadLettered > 0 ||
      webhooks.retried > 0 ||
      webhooks.deadLettered > 0;
    const result = { contractNotifications, outbox, webhooks };

    logJobResult('whatsapp', startedAt, result, {
      hasTenantScope: Boolean(auth.contaId),
      partialFailure: hasFailures,
    });

    return NextResponse.json(
      { success: !hasFailures, outcome: hasFailures ? 'partial' : 'completed', ...result },
      { status: hasFailures ? 503 : 200 },
    );
  } catch (error) {
    logJobFailure('whatsapp', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível processar a fila do WhatsApp.');
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return GET(request);
}
