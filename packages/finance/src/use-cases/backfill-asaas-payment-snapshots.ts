import { prisma } from '@alusa/database';

import { auditLogService } from '../foundation/audit-log.service';
import { isAsaasEnabled } from './asaas-ops';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';

export type BackfillAsaasPaymentSnapshotsInput = {
  contaId: string;
  limit?: number;
  dryRun?: boolean;
  actor?: { type: 'SYSTEM' | 'USER'; id: string };
};

export type BackfillAsaasPaymentSnapshotsResult = {
  scanned: number;
  synced: number;
  skipped: number;
  errors: Array<{ asaasPaymentId: string; error: string }>;
};

type StaleSnapshotRow = {
  asaasPaymentId: string;
  source: 'charge' | 'cobranca';
  entityId: string;
};

async function listStaleSnapshotPaymentIds(
  contaId: string,
  limit: number,
): Promise<StaleSnapshotRow[]> {
  const [charges, cobrancas] = await Promise.all([
    prisma.charge.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        OR: [{ asaasStatus: null }, { lastAsaasFetchAt: null }],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, asaasPaymentId: true },
    }),
    prisma.cobranca.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        OR: [{ asaasStatus: null }, { lastAsaasFetchAt: null }],
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, asaasPaymentId: true },
    }),
  ]);

  const byPaymentId = new Map<string, StaleSnapshotRow>();

  for (const charge of charges) {
    if (!charge.asaasPaymentId) continue;
    byPaymentId.set(charge.asaasPaymentId, {
      asaasPaymentId: charge.asaasPaymentId,
      source: 'charge',
      entityId: charge.id,
    });
  }

  for (const cobranca of cobrancas) {
    if (!cobranca.asaasPaymentId || byPaymentId.has(cobranca.asaasPaymentId)) continue;
    byPaymentId.set(cobranca.asaasPaymentId, {
      asaasPaymentId: cobranca.asaasPaymentId,
      source: 'cobranca',
      entityId: cobranca.id,
    });
  }

  return Array.from(byPaymentId.values()).slice(0, limit);
}

/**
 * Re-sincroniza snapshots Asaas (asaasStatus, liquidacaoStatus, valores) via pipeline idempotente.
 */
export async function backfillAsaasPaymentSnapshots(
  input: BackfillAsaasPaymentSnapshotsInput,
): Promise<BackfillAsaasPaymentSnapshotsResult> {
  const { contaId, dryRun = false, limit = 50 } = input;
  const result: BackfillAsaasPaymentSnapshotsResult = {
    scanned: 0,
    synced: 0,
    skipped: 0,
    errors: [],
  };

  if (!isAsaasEnabled()) {
    result.skipped = 1;
    result.errors.push({ asaasPaymentId: '*', error: 'ASAAS_DISABLED' });
    return result;
  }

  const rows = await listStaleSnapshotPaymentIds(contaId, limit);

  for (const row of rows) {
    result.scanned++;
    if (dryRun) {
      result.synced++;
      continue;
    }

    try {
      await syncPaymentStateFromAsaas({
        contaId,
        asaasPaymentId: row.asaasPaymentId,
      });
      result.synced++;
    } catch (error) {
      result.errors.push({
        asaasPaymentId: row.asaasPaymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.synced > 0) {
    await auditLogService.record({
      contaId,
      action: 'finance.snapshot.backfill.completed',
      metadata: {
        scanned: result.scanned,
        synced: result.synced,
        errors: result.errors.length,
        dryRun,
      },
    });
  }

  return result;
}
