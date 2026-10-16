import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { resolveTenantScope } from '@/lib/auth/tenant-scope';
import { runWebhookScheduler } from '@alusa/finance';
import { resolveTenantScopeForJob, startJobRun, logJobFailure, logJobResult } from '@/src/server/jobs/job-observability';
import {
  dispatchEventTicketWhatsAppNotification,
  findRecentlyCreatedPendingEventTicketWhatsAppNotifications,
} from '@/src/server/events/event-ticket-whatsapp-outbox.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SAFE_SCHEDULER_STEP_ERRORS = new Set([
  'STEP_FAILED',
  'DRIFT_ACCOUNT_FAILURES',
  'QUEUE_ITEMS_FAILED',
  'SIDE_EFFECTS_FAILED',
  'HEALTH_CHECK_ERRORS',
  'ASAAS_RECONCILIATION_ERRORS',
]);
const SAFE_STEP_COUNT_FIELDS = new Set([
  'scanned',
  'attempted',
  'processed',
  'failed',
  'skipped',
  'recovered',
  'accountsChecked',
  'accountFailures',
  'driftsFound',
  'driftsRepaired',
  'archived',
  'selected',
  'marked',
  'checkedAccounts',
  'interruptedFound',
  'recoveredSuccessfully',
  'recoveryFailed',
  'errors',
  'asaasCalls',
  'checkedPayments',
  'reconciledPayments',
  'paymentDrift',
  'checkedSubscriptions',
  'reconciledSubscriptions',
  'subscriptionDrift',
  'checkedInstallments',
  'installmentDrift',
  'storeSalesFulfilled',
  'eligible',
  'enqueued',
  'deletedFromHot',
]);

function sanitizeStepCountDetail(detail: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(detail).filter(
      ([key, value]) =>
        SAFE_STEP_COUNT_FIELDS.has(key) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0,
    ),
  );
}

function sanitizeSchedulerResult(result: Awaited<ReturnType<typeof runWebhookScheduler>>) {
  return {
    ...result,
    ...(result.lock
      ? {
          lock: {
            jobName: 'webhook-scheduler',
            ...(result.lock.lockedUntil ? { lockedUntil: result.lock.lockedUntil } : {}),
          },
        }
      : {}),
    steps: result.steps.map((step) => ({
      ...step,
      detail: sanitizeStepCountDetail(step.detail),
      ...(step.error
        ? { error: SAFE_SCHEDULER_STEP_ERRORS.has(step.error) ? step.error : 'STEP_FAILED' }
        : {}),
    })),
  };
}

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
  let startedAt: ReturnType<typeof startJobRun> | undefined;
  try {
    const url = new URL(req.url);
    const tenantScope = await resolveTenantScopeForJob('webhook-scheduler', () => resolveTenantScope(req, {
      allowCron: true,
      requestedContaId: url.searchParams.get('contaId'),
    }));
    if (!tenantScope.ok) {
      return tenantScope.response;
    }
    startedAt = startJobRun('webhook-scheduler');

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
      const committedSince = new Date(startedAt.startedAt);
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

    const stageEvidence: Record<string, { work: string[]; complete: string[] }> = {
      recover_stuck: { work: ['recovered'], complete: ['recovered'] },
      drain_queue: { work: ['attempted'], complete: ['attempted'] },
      reconcile_side_effect_outbox: { work: ['eligible'], complete: ['eligible'] },
      drain_side_effects: { work: ['attempted'], complete: ['attempted'] },
      mark_exhausted: { work: ['marked'], complete: ['marked'] },
      health_check: { work: ['interruptedFound'], complete: ['interruptedFound', 'checkedAccounts'] },
      drift_check: { work: ['driftsFound'], complete: ['driftsFound', 'accountsChecked'] },
      archive: { work: ['selected', 'archived'], complete: ['selected'] },
      reconcile_asaas: { work: ['checkedPayments', 'checkedSubscriptions', 'checkedInstallments', 'storeSalesFulfilled'], complete: ['checkedPayments', 'checkedSubscriptions', 'checkedInstallments', 'errors'] },
    };
    const evidence = result.steps.map((step) => ({ step, expected: stageEvidence[step.step] }));
    const stageNames = result.steps.map((step) => step.step);
    const hasUniqueStages = new Set(stageNames).size === stageNames.length;
    const requiredStages = [
      'recover_stuck',
      'drain_queue',
      'reconcile_side_effect_outbox',
      'drain_side_effects',
      'mark_exhausted',
      ...(url.searchParams.get('skipHealthCheck') === 'true' ? [] : ['health_check']),
      ...(url.searchParams.get('skipDriftCheck') === 'true' ? [] : ['drift_check']),
      ...(url.searchParams.get('skipArchive') === 'true' ? [] : ['archive']),
      ...(url.searchParams.get('enableReconciliation') === 'true' ? ['reconcile_asaas'] : []),
    ];
    const hasRequiredStages = requiredStages.every((name) => evidence.some(({ step }) => step.step === name));
    const hasUsefulWork = evidence.some(({ step, expected }) => expected?.work.some((field) => typeof step.detail[field] === 'number' && (step.detail[field] as number) > 0));
    const allReturnedStagesComplete = evidence.length > 0 && evidence.every(({ step, expected }) =>
      expected && expected.complete.every((field) => typeof step.detail[field] === 'number'),
    );
    const complete = hasUniqueStages
      && hasRequiredStages
      && allReturnedStagesComplete;
    const healthUnverified = result.steps.some((step) => step.step === 'health_check' && typeof step.detail.checkedAccounts === 'number' && step.detail.checkedAccounts > 0 && step.detail.interruptedFound === 0);
    const evidenceInvalid = !hasUniqueStages
      || !hasRequiredStages
      || evidence.some(({ expected }) => !expected)
      || !allReturnedStagesComplete;
    const workStatus = result.skippedDueToLock || result.hasErrors || healthUnverified || evidenceInvalid
      ? 'unknown'
      : hasUsefulWork ? 'worked' : complete ? 'empty' : 'unknown';
    logJobResult('webhook-scheduler', startedAt, result, {
      hasTenantScope: Boolean(tenantScope.contaId),
      failedSteps: result.steps.filter((step) => !step.ok).length,
      partialFailure: result.hasErrors,
      workStatus,
      skippedDueToLock: result.skippedDueToLock === true,
    });
    const responseResult = sanitizeSchedulerResult(result);
    if (result.hasErrors) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'SCHEDULER_PARTIAL_FAILURE',
            message: 'Uma ou mais etapas do scheduler de webhooks falharam.',
          },
          result: responseResult,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, result: responseResult });
  } catch (error) {
    if (startedAt) logJobFailure('webhook-scheduler', startedAt, error);
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
