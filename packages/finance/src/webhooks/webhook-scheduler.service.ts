/**
 * Webhook Scheduler Service
 *
 * Orquestra todas as operações periódicas de manutenção de webhooks em uma única execução:
 * 1. Recuperação de webhooks stuck
 * 2. Processamento da fila (drain) com tenant-fair distribution
 * 3. Marcação de webhooks exauridos (DLQ)
 * 4. Health check remoto + auto-recovery
 * 5. Drift detection + auto-repair
 * 6. Archiving de webhooks processados antigos
 *
 * Projetado para ser chamado por um cron externo (Vercel Cron, AWS EventBridge, etc.)
 * via POST /api/jobs/webhook-scheduler
 */

import { prisma } from '@alusa/database';

import { processAsaasWebhookQueueWithInbox } from './process-webhook-queue-with-inbox';
import { drainFinanceWebhookSideEffectOutbox } from './finance-side-effect-outbox.service';
import { checkWebhookHealth } from './webhook-health.service';
import { getWebhookConfigDriftStatus, repairWebhookConfigDrift } from './webhook-config-drift.service';
import {
  recoverStuckWebhooks,
  getWebhookQueueMetrics,
  archiveProcessedWebhooks,
  evaluateRetentionAlert,
  markExhaustedWebhooks,
  reconcileWithAsaas,
} from './webhook-reconciliation.service';
import { evaluateWebhookSLOs, type WebhookSLOResult } from './webhook-observability.service';
import { withWebhookJobLock } from '../foundation/webhook-job-lock.service';

// ── Types ────────────────────────────────────────────────────────────────

export interface SchedulerStepResult {
  step: string;
  ok: boolean;
  durationMs: number;
  detail: Record<string, unknown>;
  error?: string;
}

export interface WebhookSchedulerResult {
  executedAt: Date;
  completedAt: Date;
  totalDurationMs: number;
  steps: SchedulerStepResult[];
  hasErrors: boolean;
  skippedDueToLock?: boolean;
  lock?: {
    jobName: string;
    workerId: string | null;
    lockedUntil?: Date | null;
  };
  retentionAlert: { level: string; lagSeconds: number; backlog: number } | null;
  slo: WebhookSLOResult | null;
}

export interface WebhookSchedulerOptions {
  /** Se definido, processa apenas uma conta específica */
  contaId?: string;
  /** Limite de webhooks a processar por execução (default: 200) */
  drainLimit?: number;
  /** Se true, pula health check remoto (útil em dev) */
  skipHealthCheck?: boolean;
  /** Se true, pula drift detection (útil em dev) */
  skipDriftCheck?: boolean;
  /** Se true, pula archiving */
  skipArchive?: boolean;
  /** Dias mínimos para archiving (default: 30) */
  archiveOlderThanDays?: number;
  /** Se true, executa reconciliação ativa com Asaas (más pesado, rodar periódico) */
  enableReconciliation?: boolean;
  /** Janela em horas para reconciliação (default: 24) */
  reconciliationWindowHours?: number;
  /** TTL do lock de job em milissegundos */
  lockTtlMs?: number;
}

export interface WebhookMaintenanceResult {
  executedAt: Date;
  completedAt: Date;
  accountsChecked: number;
  driftsFound: number;
  driftsRepaired: number;
  health: Awaited<ReturnType<typeof checkWebhookHealth>>;
  errors: Array<{ contaId: string; error: string }>;
  skippedDueToLock?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function timed<T>(
  stepName: string,
  fn: () => Promise<T>,
): Promise<{ result: T; step: SchedulerStepResult }> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      result,
      step: {
        step: stepName,
        ok: true,
        durationMs: Date.now() - start,
        detail: result && typeof result === 'object' ? (result as Record<string, unknown>) : {},
      },
    };
  } catch (err) {
    return {
      result: null as T,
      step: {
        step: stepName,
        ok: false,
        durationMs: Date.now() - start,
        detail: {},
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ── Main Scheduler ───────────────────────────────────────────────────────

export async function runWebhookScheduler(
  options: WebhookSchedulerOptions = {},
): Promise<WebhookSchedulerResult> {
  const lockName = `webhook-scheduler:${options.contaId ?? 'global'}`;
  const locked = await withWebhookJobLock(
    lockName,
    () => runWebhookSchedulerUnlocked(options),
    {
      ttlMs: options.lockTtlMs ?? 10 * 60 * 1000,
      metadata: {
        contaId: options.contaId ?? null,
        drainLimit: options.drainLimit ?? null,
      },
    },
  );

  if (!locked.acquired) {
    const now = new Date();
    return {
      executedAt: now,
      completedAt: now,
      totalDurationMs: 0,
      steps: [],
      hasErrors: false,
      skippedDueToLock: true,
      lock: {
        jobName: locked.jobName,
        workerId: locked.workerId,
        lockedUntil: locked.lockedUntil,
      },
      retentionAlert: null,
      slo: null,
    };
  }

  return {
    ...locked.result,
    lock: {
      jobName: locked.jobName,
      workerId: locked.workerId,
    },
  };
}

async function runWebhookSchedulerUnlocked(
  options: WebhookSchedulerOptions = {},
): Promise<WebhookSchedulerResult> {
  const executedAt = new Date();
  const steps: SchedulerStepResult[] = [];
  const drainLimit = Math.min(1000, Math.max(1, options.drainLimit ?? 200));

  // ── Step 1: Recuperar webhooks stuck ───────────────────────────────────
  const { step: stuckStep } = await timed('recover_stuck', () =>
    recoverStuckWebhooks({
      contaId: options.contaId,
      timeoutMinutes: 5,
      limit: 100,
    }),
  );
  steps.push(stuckStep);

  // ── Step 2: Processar fila (drain) ─────────────────────────────────────
  const { step: drainStep } = await timed('drain_queue', () =>
    processAsaasWebhookQueueWithInbox({
      contaId: options.contaId,
      limit: drainLimit,
      statuses: ['PENDENTE', 'ERRO'],
      source: 'WEBHOOK',
      tenantFair: !options.contaId,
    }),
  );
  steps.push(drainStep);

  // ── Step 2.1: Processar outbox de side effects ────────────────────────
  const { step: sideEffectsStep } = await timed('drain_side_effects', () =>
    drainFinanceWebhookSideEffectOutbox({
      contaId: options.contaId,
      limit: Math.max(50, Math.min(drainLimit, 500)),
    }),
  );
  steps.push(sideEffectsStep);

  // ── Step 3: Marcar webhooks exauridos (DLQ) ────────────────────────────
  const { step: dlqStep } = await timed('mark_exhausted', () =>
    markExhaustedWebhooks({
      contaId: options.contaId,
      limit: 200,
    }),
  );
  steps.push(dlqStep);

  // ── Step 4: Health check remoto ────────────────────────────────────────
  if (!options.skipHealthCheck) {
    const { step: healthStep } = await timed('health_check', () =>
      checkWebhookHealth({
        contaId: options.contaId,
        autoRecover: true,
      }),
    );
    steps.push(healthStep);
  }

  // ── Step 5: Drift detection + auto-repair ──────────────────────────────
  if (!options.skipDriftCheck) {
    const { step: driftStep } = await timed('drift_check', async () => {
      const accounts = await prisma.asaasAccount.findMany({
        where: {
          asaasAccountId: { not: null },
          ...(options.contaId
            ? { financeProfile: { contaId: options.contaId } }
            : { status: { in: ['APPROVED', 'UNDER_REVIEW', 'CREATED'] } }),
        },
        select: { financeProfile: { select: { contaId: true } } },
        take: 50,
      });

      const results: Array<{ contaId: string; hasDrift: boolean; repaired: boolean }> = [];

      for (const account of accounts) {
        const contaId = account.financeProfile.contaId;
        try {
          const status = await getWebhookConfigDriftStatus(contaId);
          if (!status) continue;

          const hasDrift =
            status.drift.remoteMissing ||
            status.drift.urlMismatch ||
            status.drift.disabled ||
            status.drift.interrupted ||
            status.drift.missingAuthToken ||
            status.drift.sendTypeMismatch ||
            status.drift.eventsMismatch ||
            status.drift.localHashMismatch ||
            status.drift.penalized;

          if (hasDrift) {
            const repair = await repairWebhookConfigDrift({
              contaId,
              actor: { type: 'SYSTEM' },
            });
            results.push({ contaId, hasDrift: true, repaired: repair.repaired });
          } else {
            results.push({ contaId, hasDrift: false, repaired: false });
          }
        } catch {
          results.push({ contaId, hasDrift: false, repaired: false });
        }
      }

      return {
        accountsChecked: accounts.length,
        driftsFound: results.filter((r) => r.hasDrift).length,
        driftsRepaired: results.filter((r) => r.repaired).length,
      };
    });
    steps.push(driftStep);
  }

  // ── Step 6: Archiving ──────────────────────────────────────────────────
  if (!options.skipArchive) {
    const { step: archiveStep } = await timed('archive', () =>
      archiveProcessedWebhooks({
        contaId: options.contaId,
        olderThanDays: options.archiveOlderThanDays ?? 30,
        limit: 1000,
      }),
    );
    steps.push(archiveStep);
  }

  // ── Step 7: Reconciliação ativa com Asaas (opcional) ───────────────────
  if (options.enableReconciliation && options.contaId) {
    const { step: reconcileStep } = await timed('reconcile_asaas', () =>
      reconcileWithAsaas({
        contaId: options.contaId!,
        windowHours: options.reconciliationWindowHours ?? 24,
        limit: 100,
        dryRun: false,
      }),
    );
    steps.push(reconcileStep);
  }

  // ── Métricas pós-execução ──────────────────────────────────────────────
  let retentionAlert: WebhookSchedulerResult['retentionAlert'] = null;
  let slo: WebhookSLOResult | null = null;
  try {
    const metrics = await getWebhookQueueMetrics({ contaId: options.contaId });
    const alert = evaluateRetentionAlert(metrics);
    if (alert) {
      retentionAlert = {
        level: alert.level,
        lagSeconds: alert.lagSeconds,
        backlog: alert.backlog,
      };
    }

    // Count exhausted
    const exhaustedCount = await prisma.webhookAsaas.count({
      where: {
        status: 'EXAURIDO',
        ...(options.contaId ? { contaId: options.contaId } : {}),
      },
    });

    slo = evaluateWebhookSLOs({
      lagSeconds: metrics.lagSeconds,
      backlog: metrics.backlog,
      errored: metrics.errored,
      processed: metrics.processed,
      exhausted: exhaustedCount,
    });
  } catch {
    // fail-safe
  }

  const completedAt = new Date();

  console.info('[webhook-scheduler] Execução concluída', {
    totalDurationMs: completedAt.getTime() - executedAt.getTime(),
    steps: steps.map((s) => ({ step: s.step, ok: s.ok, durationMs: s.durationMs })),
    hasErrors: steps.some((s) => !s.ok),
    retentionAlert,
    sloOk: slo?.ok ?? null,
    sloViolations: slo?.violations?.length ?? 0,
  });

  return {
    executedAt,
    completedAt,
    totalDurationMs: completedAt.getTime() - executedAt.getTime(),
    steps,
    hasErrors: steps.some((s) => !s.ok),
    retentionAlert,
    slo,
  };
}

export async function runWebhookHealthAndDriftMaintenance(options: {
  contaId?: string;
  autoRepair?: boolean;
} = {}): Promise<WebhookMaintenanceResult> {
  const lockName = `webhook-maintenance:${options.contaId ?? 'global'}`;
  const locked = await withWebhookJobLock(
    lockName,
    () => runWebhookHealthAndDriftMaintenanceUnlocked(options),
    {
      ttlMs: 10 * 60 * 1000,
      metadata: {
        contaId: options.contaId ?? null,
        autoRepair: options.autoRepair ?? true,
      },
    },
  );

  if (!locked.acquired) {
    const now = new Date();
    return {
      executedAt: now,
      completedAt: now,
      accountsChecked: 0,
      driftsFound: 0,
      driftsRepaired: 0,
      health: {
        checkedAccounts: 0,
        interruptedFound: 0,
        recoveredSuccessfully: 0,
        recoveryFailed: 0,
        errors: [{ contaId: options.contaId ?? 'ALL', error: 'JOB_LOCKED' }],
        executedAt: now,
      } as Awaited<ReturnType<typeof checkWebhookHealth>>,
      errors: [{ contaId: options.contaId ?? 'ALL', error: 'JOB_LOCKED' }],
      skippedDueToLock: true,
    };
  }

  return locked.result;
}

async function runWebhookHealthAndDriftMaintenanceUnlocked(options: {
  contaId?: string;
  autoRepair?: boolean;
} = {}): Promise<WebhookMaintenanceResult> {
  const executedAt = new Date();
  const autoRepair = options.autoRepair ?? true;
  const errors: Array<{ contaId: string; error: string }> = [];

  const health = await checkWebhookHealth({
    contaId: options.contaId,
    autoRecover: autoRepair,
  });

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      ...(options.contaId
        ? { financeProfile: { contaId: options.contaId } }
        : { status: { in: ['APPROVED', 'UNDER_REVIEW', 'CREATED'] } }),
    },
    select: { financeProfile: { select: { contaId: true } } },
    take: 500,
  });

  let driftsFound = 0;
  let driftsRepaired = 0;

  for (const account of accounts) {
    const contaId = account.financeProfile.contaId;
    try {
      const status = await getWebhookConfigDriftStatus(contaId);
      if (!status) continue;

      const hasDrift =
        status.drift.remoteMissing ||
        status.drift.urlMismatch ||
        status.drift.disabled ||
        status.drift.interrupted ||
        status.drift.missingAuthToken ||
        status.drift.sendTypeMismatch ||
        status.drift.eventsMismatch ||
        status.drift.localHashMismatch ||
        status.drift.penalized;

      if (!hasDrift) continue;

      driftsFound++;
      if (autoRepair) {
        const repair = await repairWebhookConfigDrift({
          contaId,
          actor: { type: 'SYSTEM' },
        });
        if (repair.repaired) driftsRepaired++;
        if (repair.failureCategory) {
          errors.push({ contaId, error: repair.failureCategory });
        }
      }
    } catch (error) {
      errors.push({
        contaId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    executedAt,
    completedAt: new Date(),
    accountsChecked: accounts.length,
    driftsFound,
    driftsRepaired,
    health,
    errors: [...errors, ...health.errors.map((item) => ({ contaId: item.contaId, error: item.error }))],
  };
}
