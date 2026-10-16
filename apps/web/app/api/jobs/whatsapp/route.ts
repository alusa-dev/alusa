import { NextResponse } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { drainContractWhatsAppNotifications, drainWhatsAppOutbox, drainWhatsAppWebhooks } from '@/src/server/whatsapp/outbox.service';
import { apiJsonError } from '@/lib/api/standard-response';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import { drainEventTicketWhatsAppNotifications } from '@/src/server/events/event-ticket-whatsapp-outbox.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function toPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(max, Math.floor(parsed))) : fallback;
}

async function run(request: Request) {
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const auth = await resolveTenantScopeForJob('whatsapp', () => resolveTenantScope(request, { allowCron: true }));
    if (!auth.ok) return auth.response;
    startedAt = startJobRun('whatsapp');

    const url = new URL(request.url);
    // Process inbound STOP/SAIR replies before sending pending outbound jobs.
    const webhooks = auth.isCron ? await drainWhatsAppWebhooks({
      limit: toPositiveInt(url.searchParams.get('webhookLimit'), 100, 500),
    }) : { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };
    const contractNotifications = await drainContractWhatsAppNotifications({
      contaId: auth.contaId,
      limit: toPositiveInt(url.searchParams.get('contractLimit'), 50, 200),
    });
    const eventTicketNotifications = await drainEventTicketWhatsAppNotifications({
      ...(!auth.isCron && auth.contaId ? { contaId: auth.contaId } : {}),
      limit: toPositiveInt(url.searchParams.get('eventTicketLimit'), 50, 100),
    });
    const outbox = auth.isCron ? await drainWhatsAppOutbox({
      limit: toPositiveInt(url.searchParams.get('outboxLimit'), 50, 200),
    }) : { claimed: 0, sent: 0, queued: 0, retried: 0, deadLettered: 0, skipped: 0 };
    const hasFailures =
      contractNotifications.retried > 0 ||
      contractNotifications.deadLettered > 0 ||
      eventTicketNotifications.retried > 0 ||
      eventTicketNotifications.deadLettered > 0 ||
      outbox.retried > 0 ||
      outbox.deadLettered > 0 ||
      webhooks.retried > 0 ||
      webhooks.deadLettered > 0;
    const result = { contractNotifications, eventTicketNotifications, outbox, webhooks };
    const claimed = contractNotifications.claimed + eventTicketNotifications.claimed + outbox.claimed + webhooks.claimed;

    logJobResult('whatsapp', startedAt, {
      contractNotificationsClaimed: contractNotifications.claimed,
      contractNotificationsRetried: contractNotifications.retried,
      contractNotificationsDeadLettered: contractNotifications.deadLettered,
      eventTicketNotificationsClaimed: eventTicketNotifications.claimed,
      eventTicketNotificationsRetried: eventTicketNotifications.retried,
      eventTicketNotificationsDeadLettered: eventTicketNotifications.deadLettered,
      whatsappOutboxClaimed: outbox.claimed,
      whatsappOutboxSent: outbox.sent,
      whatsappOutboxRetried: outbox.retried,
      whatsappOutboxDeadLettered: outbox.deadLettered,
      whatsappWebhooksClaimed: webhooks.claimed,
      whatsappWebhooksProcessed: webhooks.processed,
      whatsappWebhooksRetried: webhooks.retried,
      whatsappWebhooksDeadLettered: webhooks.deadLettered,
    }, {
      hasTenantScope: Boolean(auth.contaId),
      partialFailure: hasFailures,
      workStatus: claimed > 0 ? 'worked' : eventTicketNotifications.paused || hasFailures ? 'unknown' : 'empty',
    });

    return NextResponse.json(
      { success: !hasFailures, outcome: hasFailures ? 'partial' : 'completed', ...result },
      { status: hasFailures ? 503 : 200 },
    );
  } catch (error) {
    if (startedAt) logJobFailure('whatsapp', startedAt, error);
    return apiJsonError(500, 'JOB_FAILED', 'Não foi possível processar a fila do WhatsApp.');
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return GET(request);
}
