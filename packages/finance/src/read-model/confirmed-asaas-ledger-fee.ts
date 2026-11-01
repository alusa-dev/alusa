import { createHash } from 'node:crypto';
import { prisma } from '@alusa/database';

const DEFAULT_SNAPSHOT_TTL_SECONDS = 300;

/** Reads a recent, complete tenant ledger snapshot; it never contacts Asaas or writes. */
export async function readConfirmedAsaasLedgerFee(
  contaId: string,
  paymentId: string | null | undefined,
  paymentCreatedAt?: Date | null,
): Promise<number | null> {
  if (!paymentId || !paymentCreatedAt) return null;
  const now = new Date();
  const oldestAllowedStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  if (paymentCreatedAt < oldestAllowedStart) return null;

  const startDate = paymentCreatedAt.toISOString().slice(0, 10);
  const endDate = now.toISOString().slice(0, 10);
  const windowKey = createHash('sha256').update(JSON.stringify({ startDate, endDate, direction: 'desc' })).digest('hex');
  const ttlSeconds = Number(process.env.FINANCE_EXTRATO_SNAPSHOT_TTL_SECONDS ?? DEFAULT_SNAPSHOT_TTL_SECONDS);
  const ttlMs = (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_SNAPSHOT_TTL_SECONDS) * 1000;
  const window = await prisma.financialTransactionSyncWindow.findFirst({
    where: { contaId, windowKey, syncedAt: { gte: new Date(now.getTime() - ttlMs) } },
    select: { truncated: true, fetchedCount: true, officialTotalCount: true },
  });
  if (!window || window.truncated || window.fetchedCount !== window.officialTotalCount) return null;

  const entries = await prisma.financialTransactionSnapshot.findMany({
    where: { contaId, paymentId, type: { in: ['PAYMENT_FEE', 'PAYMENT_FEE_REVERSAL'] } },
    select: { type: true, value: true },
  });
  if (entries.length === 0) return 0;

  const signedTotal = entries.reduce((total, entry) => {
    const value = Math.abs(Number(entry.value));
    return total + (entry.type === 'PAYMENT_FEE_REVERSAL' ? value : -value);
  }, 0);
  return Number(Math.max(0, -signedTotal).toFixed(2));
}
