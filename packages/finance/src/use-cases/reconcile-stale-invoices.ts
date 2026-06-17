import type { InvoiceStatus } from '@prisma/client';

import { getFiscalPrisma } from '../fiscal/fiscal-prisma';
import { syncInvoiceFromProvider } from './sync-invoice-from-provider';

const DEFAULT_STALE_MINUTES = 60;
const DEFAULT_LIMIT = 50;
const RECONCILABLE_STATUSES: InvoiceStatus[] = ['SCHEDULED', 'SYNCHRONIZED', 'ERROR'];

export type ReconcileStaleInvoicesInput = {
  contaId?: string;
  limit?: number;
  staleOlderThanMinutes?: number;
};

export type ReconcileStaleInvoicesOutput = {
  scanned: number;
  synced: number;
  failed: number;
  invoices: Array<{
    id: string;
    contaId: string;
    success: boolean;
    status?: InvoiceStatus;
    error?: unknown;
  }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

export async function reconcileStaleInvoices(
  input: ReconcileStaleInvoicesInput = {},
): Promise<ReconcileStaleInvoicesOutput> {
  const prisma = getFiscalPrisma();
  const limit = clampInt(input.limit, DEFAULT_LIMIT, 1, 200);
  const staleOlderThanMinutes = clampInt(
    input.staleOlderThanMinutes,
    DEFAULT_STALE_MINUTES,
    5,
    24 * 60,
  );
  const staleBefore = new Date(Date.now() - staleOlderThanMinutes * 60 * 1000);

  const invoices = await prisma.invoice.findMany({
    where: {
      contaId: input.contaId,
      asaasInvoiceId: { not: null },
      status: { in: RECONCILABLE_STATUSES },
      statusUpdatedAt: { lte: staleBefore },
    },
    select: {
      id: true,
      contaId: true,
      status: true,
    },
    orderBy: [{ statusUpdatedAt: 'asc' }],
    take: limit,
  });

  const results = await Promise.allSettled(
    invoices.map(async (invoice) => ({
      invoice,
      result: await syncInvoiceFromProvider({
        contaId: invoice.contaId,
        invoiceId: invoice.id,
        correlationId: `reconcile-stale-invoices:${invoice.id}`,
      }),
    })),
  );

  const reconciled = results.map((item, index) => {
    const invoice = invoices[index]!;
    if (item.status === 'rejected') {
      return {
        id: invoice.id,
        contaId: invoice.contaId,
        success: false,
        error: item.reason instanceof Error ? item.reason.message : item.reason,
      };
    }

    if (!item.value.result.success) {
      return {
        id: invoice.id,
        contaId: invoice.contaId,
        success: false,
        error: item.value.result.error,
      };
    }

    return {
      id: invoice.id,
      contaId: invoice.contaId,
      success: true,
      status: item.value.result.data.status,
    };
  });

  return {
    scanned: invoices.length,
    synced: reconciled.filter((item) => item.success).length,
    failed: reconciled.filter((item) => !item.success).length,
    invoices: reconciled,
  };
}
