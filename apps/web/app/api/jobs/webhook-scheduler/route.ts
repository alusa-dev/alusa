import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { runWebhookScheduler } from '@alusa/finance';
import { logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import {
  dispatchEventTicketWhatsAppNotification,
  findRecentlyCreatedPendingEventTicketWhatsAppNotifications,
} from '@/src/server/events/event-ticket-whatsapp-outbox.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET/POST /api/jobs/webhook-scheduler
 *
 * Execução unificada de manutenção de webhooks.
 * Projetado para cron externo (ex: Vercel Cron, a cada 2 minutos).
 *
 * Auth: x-cron-token ou sessão ADMIN.
 *
 * Query params opcionais:
 * - contaId: restringe para 1 conta
 * - drainLimit: máx de webhooks a processar (default 500)
 * - skipHealthCheck: "true" para pular health check remoto
 * - skipDriftCheck: "true" para pular drift detection
 * - skipArchive: "true" para pular archiving
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

    const drainLimit = Number(url.searchParams.get('drainLimit') ?? '500');

    const result = await runWebhookScheduler({
      contaId: tenantScope.contaId,
      drainLimit: Number.isFinite(drainLimit) ? drainLimit : 500,
      skipHealthCheck: url.searchParams.get('skipHealthCheck') === 'true',
      skipDriftCheck: url.searchParams.get('skipDriftCheck') === 'true',
      skipArchive: url.searchParams.get('skipArchive') === 'true',
      enableReconciliation: url.searchParams.get('enableReconciliation') === 'true',
    });

    if (!result.skippedDueToLock) {
      const committedSince = new Date(startedAt);
      const tenantId = tenantScope.contaId;
      after(async () => {
        try {
          const notifications = await findRecentlyCreatedPendingEventTicketWhatsAppNotifications({
            createdSince: committedSince,
            contaId: tenantId,
            limit: 3,
          });
          for (const notification of notifications) {
            try {
              await dispatchEventTicketWhatsAppNotification({ contaId: notification.contaId, notificationId: notification.id });
            } catch {
              // Persisted notification and the WhatsApp cron retain retry ownership.
            }
          }
        } catch {
          // Do not change the already returned scheduler result; cron is the durable fallback.
        }
      });
    }

    logJobResult('webhook-scheduler', startedAt, result, {
      hasTenantScope: Boolean(tenantScope.contaId),
      failedSteps: result.steps.filter((step) => !step.ok).length,
      skippedDueToLock: result.skippedDueToLock === true,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    logJobFailure('webhook-scheduler', startedAt, error);
    return NextResponse.json(
      { error: { code: 'SCHEDULER_ERROR', message: 'Falha ao executar o scheduler de webhooks.' } },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
