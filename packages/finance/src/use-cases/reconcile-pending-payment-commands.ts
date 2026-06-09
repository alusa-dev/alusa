import { prisma } from '@alusa/database';
import type { AsaasIntegrationJobType, Prisma } from '@prisma/client';

import { markStalePaymentCommandsForReconciliation } from './payment-command-ledger';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';

type PaymentCommandPayload = {
  asaasPaymentId: string;
  expectedEvents?: string[];
};

export type ReconcilePendingPaymentCommandsInput = {
  contaId?: string;
  pollOlderThanSeconds?: number;
  staleOlderThanMinutes?: number;
  limit?: number;
};

export type ReconcilePendingPaymentCommandsOutput = {
  scanned: number;
  synced: number;
  syncFailed: number;
  stale: {
    processed: number;
    marked: number;
  };
};

const PAYMENT_COMMAND_JOB_TYPES = [
  'PAYMENT_UPDATE_COMMAND',
  'PAYMENT_CANCEL_COMMAND',
  'PAYMENT_REFUND_COMMAND',
  'PAYMENT_UNDO_CASH_COMMAND',
  'PAYMENT_MARK_CASH_COMMAND',
] as AsaasIntegrationJobType[];

function parsePayload(payload: Prisma.JsonValue): PaymentCommandPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.asaasPaymentId !== 'string' || !record.asaasPaymentId.trim()) return null;
  return {
    asaasPaymentId: record.asaasPaymentId,
    expectedEvents: Array.isArray(record.expectedEvents)
      ? record.expectedEvents.filter((event): event is string => typeof event === 'string')
      : undefined,
  };
}

/**
 * Consulta o estado oficial do Asaas para comandos aceitos localmente e ainda
 * sem confirmação final. O sync reaplica o pipeline de webhook, mantendo o
 * Asaas como fonte de verdade para a transição financeira.
 */
export async function reconcilePendingPaymentCommands(
  input: ReconcilePendingPaymentCommandsInput = {},
): Promise<ReconcilePendingPaymentCommandsOutput> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const pollOlderThanSeconds = Math.max(input.pollOlderThanSeconds ?? 30, 5);
  const staleOlderThanMinutes = Math.max(input.staleOlderThanMinutes ?? 10, 1);
  const pollThreshold = new Date(Date.now() - pollOlderThanSeconds * 1000);

  const jobs = await prisma.asaasIntegrationJob.findMany({
    where: {
      ...(input.contaId ? { contaId: input.contaId } : {}),
      status: { in: ['PENDING', 'PROCESSING'] },
      createdAt: { lt: pollThreshold },
      type: { in: PAYMENT_COMMAND_JOB_TYPES },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let synced = 0;
  let syncFailed = 0;

  for (const job of jobs) {
    const payload = parsePayload(job.payload);
    if (!payload) {
      syncFailed += 1;
      continue;
    }

    try {
      const result = await syncPaymentStateFromAsaas({
        contaId: job.contaId,
        asaasPaymentId: payload.asaasPaymentId,
      });

      if (result.success) {
        synced += 1;
      } else {
        syncFailed += 1;
      }
    } catch (error) {
      syncFailed += 1;
      console.warn('[reconcilePendingPaymentCommands] Falha ao sincronizar comando financeiro', {
        contaId: job.contaId,
        jobId: job.id,
        asaasPaymentId: payload.asaasPaymentId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const stale = await markStalePaymentCommandsForReconciliation({
    contaId: input.contaId,
    olderThanMinutes: staleOlderThanMinutes,
    limit,
  });

  return {
    scanned: jobs.length,
    synced,
    syncFailed,
    stale,
  };
}
