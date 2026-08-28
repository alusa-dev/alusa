import { prisma } from '@alusa/database';
import { randomUUID } from 'node:crypto';

import { withWebhookJobLock } from '../foundation/webhook-job-lock.service';
import { classifyAsaasOperationalError } from '../foundation/asaas-operational-error';
import { detectWebhookGaps, reconcileWithAsaas } from '../webhooks/webhook-reconciliation.service';

export interface ReconcileFinanceWebhooksJobOptions {
  contaId?: string;
  windowHours?: number;
  limit?: number;
  dryRun?: boolean;
  includeGaps?: boolean;
  maxAccounts?: number;
  mode?: 'targeted' | 'safety_sweep';
  providerCheckIntervalMinutes?: number;
  maxAsaasCalls?: number;
  accountConcurrency?: number;
  maxDurationMs?: number;
}

export interface ReconcileFinanceWebhooksAccountResult {
  contaId: string;
  reconcile: Awaited<ReturnType<typeof reconcileWithAsaas>>;
  gaps: Awaited<ReturnType<typeof detectWebhookGaps>> | null;
  error?: string;
}

export interface ReconcileFinanceWebhooksJobResult {
  accountsProcessed: number;
  accountsFailed: number;
  results: ReconcileFinanceWebhooksAccountResult[];
  generatedAt: Date;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  correlationId: string;
  asaasCalls: number;
  budgetExhausted: boolean;
  outcome: 'completed' | 'partial' | 'failed' | 'skipped';
  errors: string[];
  skippedDueToLock?: boolean;
}

async function resolveTargetContaIds(contaId?: string, maxAccounts = 20): Promise<string[]> {
  if (contaId) return [contaId];

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      status: { in: ['APPROVED', 'UNDER_REVIEW', 'CREATED'] },
    },
    select: { id: true, financeProfile: { select: { contaId: true } } },
    orderBy: [{ lastFinanceReconciliationAt: 'asc' }, { updatedAt: 'asc' }],
    take: maxAccounts,
  });

  if (accounts.length > 0) {
    await prisma.asaasAccount.updateMany({
      where: { id: { in: accounts.map((account) => account.id) } },
      data: { lastFinanceReconciliationAt: new Date() },
    });
  }

  return accounts.map((account) => account.financeProfile.contaId);
}

async function mapWithConcurrency<T>(
  values: string[],
  concurrency: number,
  worker: (_value: string) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < values.length) {
      const currentIndex = cursor++;
      results[currentIndex] = await worker(values[currentIndex]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, runWorker));
  return results;
}

async function persistReconciliationRun(
  contaId: string,
  result: Awaited<ReturnType<typeof reconcileWithAsaas>>,
): Promise<void> {
  try {
    await prisma.financeReconciliationRun.create({
      data: {
        contaId,
        correlationId: result.correlationId ?? 'unknown',
        mode: result.mode,
        outcome: result.errors.length > 0 ? 'partial' : 'completed',
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        durationMs: result.durationMs,
        asaasCalls: result.asaasCalls,
        maxAsaasCalls: result.maxAsaasCalls,
        budgetExhausted: result.budgetExhausted,
        checkedPayments: result.checkedPayments,
        paymentDrift: result.paymentDrift,
        checkedSubscriptions: result.checkedSubscriptions,
        subscriptionDrift: result.subscriptionDrift,
        checkedInstallments: result.checkedInstallments,
        installmentDrift: result.installmentDrift,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.warn('[reconcile-finance-webhooks] falha ao persistir run', {
      contaId,
      error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    });
  }
}

/**
 * Reconciliação periódica multi-tenant: compara estado local com Asaas e detecta gaps.
 * Projetado para cron (sem contaId) com limite de contas por execução.
 */
export async function reconcileFinanceWebhooksJob(
  options: ReconcileFinanceWebhooksJobOptions = {},
): Promise<ReconcileFinanceWebhooksJobResult> {
  const startedAt = new Date();
  const correlationId = randomUUID();
  const lockName = `reconcile-finance-webhooks:${options.contaId ?? 'global'}`;
  const locked = await withWebhookJobLock(
    lockName,
    () => reconcileFinanceWebhooksJobUnlocked(options, startedAt, correlationId),
    {
      ttlMs: 20 * 60 * 1000,
      metadata: {
        contaId: options.contaId ?? null,
        windowHours: options.windowHours ?? null,
        limit: options.limit ?? null,
        mode: options.mode ?? 'targeted',
        correlationId,
      },
    },
  );

  if (!locked.acquired) {
    return {
      accountsProcessed: 0,
      accountsFailed: 0,
      results: [],
      generatedAt: new Date(),
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      correlationId,
      asaasCalls: 0,
      budgetExhausted: false,
      outcome: 'skipped',
      errors: [],
      skippedDueToLock: true,
    };
  }

  return locked.result;
}

async function reconcileFinanceWebhooksJobUnlocked(
  options: ReconcileFinanceWebhooksJobOptions = {},
  startedAt: Date,
  correlationId: string,
): Promise<ReconcileFinanceWebhooksJobResult> {
  const windowHours = Math.max(1, Math.min(24 * 30, options.windowHours ?? 24));
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  const maxAccounts = Math.max(1, Math.min(50, options.maxAccounts ?? 20));
  const accountConcurrency = Math.max(1, Math.min(5, options.accountConcurrency ?? 2));
  const includeGaps = options.includeGaps ?? true;
  const dryRun = options.dryRun ?? false;

  const contaIds = await resolveTargetContaIds(options.contaId, maxAccounts);
  const results = await mapWithConcurrency(contaIds, accountConcurrency, async (targetContaId) => {
    try {
      const [reconcile, gaps] = await Promise.all([
        reconcileWithAsaas({
          contaId: targetContaId,
          windowHours,
          limit,
          dryRun,
          mode: options.mode,
          providerCheckIntervalMinutes: options.providerCheckIntervalMinutes,
          maxAsaasCalls: options.maxAsaasCalls,
          maxDurationMs: options.maxDurationMs,
          correlationId,
        }),
        includeGaps
          ? detectWebhookGaps(targetContaId, {
              windowDays: Math.max(1, Math.ceil(windowHours / 24)),
              persistIssues: !dryRun,
            })
          : Promise.resolve(null),
      ]);

      await persistReconciliationRun(targetContaId, reconcile);
      return { contaId: targetContaId, reconcile, gaps };
    } catch (error) {
      const classified = classifyAsaasOperationalError(error, 'subaccount');
      const safeError = `${classified.category}${classified.status ? `:${classified.status}` : ''}`;
      const fallback = {
        contaId: targetContaId,
        dryRun,
        mode: options.mode ?? 'targeted' as const,
        correlationId,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        asaasCalls: 0,
        maxAsaasCalls: options.maxAsaasCalls ?? 100,
        budgetExhausted: false,
        providerCheckIntervalMinutes: options.providerCheckIntervalMinutes ?? 360,
        checkedPayments: 0,
        reconciledPayments: 0,
        paymentDrift: 0,
        checkedSubscriptions: 0,
        reconciledSubscriptions: 0,
        subscriptionDrift: 0,
        checkedInstallments: 0,
        installmentDrift: 0,
        storeSalesFulfilled: 0,
        errors: [safeError],
        generatedAt: new Date(),
      };
      await persistReconciliationRun(targetContaId, fallback);
      return {
        contaId: targetContaId,
        reconcile: fallback,
        gaps: null,
        error: safeError,
      };
    }
  });

  const completedAt = new Date();
  const accountsFailed = results.filter((result) => Boolean(result.error)).length;
  const errors = results.flatMap((result) => result.error ? [`${result.contaId}:${result.error}`] : result.reconcile.errors);
  const asaasCalls = results.reduce((total, result) => total + result.reconcile.asaasCalls, 0);
  const budgetExhausted = results.some((result) => result.reconcile.budgetExhausted);
  const outcome = accountsFailed === results.length && accountsFailed > 0
    ? 'failed'
    : accountsFailed > 0 || errors.length > 0 || budgetExhausted
      ? 'partial'
      : 'completed';

  console.info('[reconcile-finance-webhooks] completed', {
    correlationId,
    outcome,
    accountsProcessed: results.length,
    accountsFailed,
    asaasCalls,
    budgetExhausted,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  });

  return {
    accountsProcessed: results.length,
    accountsFailed,
    results,
    generatedAt: completedAt,
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    correlationId,
    asaasCalls,
    budgetExhausted,
    outcome,
    errors,
  };
}
