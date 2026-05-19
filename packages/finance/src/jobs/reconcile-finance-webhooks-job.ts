import { prisma } from '@alusa/database';

import { detectWebhookGaps, reconcileWithAsaas } from '../webhooks/webhook-reconciliation.service';

export interface ReconcileFinanceWebhooksJobOptions {
  contaId?: string;
  windowHours?: number;
  limit?: number;
  dryRun?: boolean;
  includeGaps?: boolean;
  maxAccounts?: number;
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
}

async function resolveTargetContaIds(contaId?: string, maxAccounts = 20): Promise<string[]> {
  if (contaId) return [contaId];

  const accounts = await prisma.asaasAccount.findMany({
    where: {
      asaasAccountId: { not: null },
      status: { in: ['APPROVED', 'UNDER_REVIEW', 'CREATED'] },
    },
    select: { financeProfile: { select: { contaId: true } } },
    orderBy: { updatedAt: 'desc' },
    take: maxAccounts,
  });

  return accounts.map((account) => account.financeProfile.contaId);
}

/**
 * Reconciliação periódica multi-tenant: compara estado local com Asaas e detecta gaps.
 * Projetado para cron (sem contaId) com limite de contas por execução.
 */
export async function reconcileFinanceWebhooksJob(
  options: ReconcileFinanceWebhooksJobOptions = {},
): Promise<ReconcileFinanceWebhooksJobResult> {
  const windowHours = Math.max(1, Math.min(24 * 30, options.windowHours ?? 24));
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  const maxAccounts = Math.max(1, Math.min(50, options.maxAccounts ?? 20));
  const includeGaps = options.includeGaps ?? true;
  const dryRun = options.dryRun ?? false;

  const contaIds = await resolveTargetContaIds(options.contaId, maxAccounts);
  const results: ReconcileFinanceWebhooksAccountResult[] = [];
  let accountsFailed = 0;

  for (const targetContaId of contaIds) {
    try {
      const [reconcile, gaps] = await Promise.all([
        reconcileWithAsaas({
          contaId: targetContaId,
          windowHours,
          limit,
          dryRun,
        }),
        includeGaps
          ? detectWebhookGaps(targetContaId, {
              windowDays: Math.max(1, Math.ceil(windowHours / 24)),
            })
          : Promise.resolve(null),
      ]);

      results.push({ contaId: targetContaId, reconcile, gaps });
    } catch (error) {
      accountsFailed += 1;
      results.push({
        contaId: targetContaId,
        reconcile: {
          contaId: targetContaId,
          dryRun,
          checkedPayments: 0,
          reconciledPayments: 0,
          paymentDrift: 0,
          checkedSubscriptions: 0,
          reconciledSubscriptions: 0,
          subscriptionDrift: 0,
          checkedInstallments: 0,
          installmentDrift: 0,
          errors: [error instanceof Error ? error.message : String(error)],
          generatedAt: new Date(),
        },
        gaps: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    accountsProcessed: results.length,
    accountsFailed,
    results,
    generatedAt: new Date(),
  };
}
