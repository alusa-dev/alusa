import { prisma } from '@alusa/database';
import { AsaasHttpError } from '@alusa/asaas';
import { auditLogService } from '../foundation/audit-log.service';
import { getPayment, isAsaasEnabled } from './asaas-ops';
import { syncPaymentStateFromAsaas } from './sync-payment-state-from-asaas';
import { reconcilePaidReservedStoreSales } from './store-inventory';

export type ReconcileOperationalChargeLinksInput = {
  contaId: string;
  dryRun?: boolean;
  forceSnapshot?: boolean;
  actor?: { type: 'SYSTEM' | 'USER'; id: string };
};

export type ReconcileOperationalChargeLinksResult = {
  checked: number;
  synced: number;
  removed: number;
  skipped: number;
  inventoryRepaired: number;
  errors: Array<{ asaasPaymentId: string; error: string }>;
};

type PaymentOwner =
  | { kind: 'charge'; id: string }
  | { kind: 'cobranca'; id: string }
  | { kind: 'event-entry'; id: string }
  | { kind: 'event-ticket-sale'; id: string }
  | { kind: 'event-map-order'; id: string };

function isPaymentMissingInAsaas(error: unknown): boolean {
  return error instanceof AsaasHttpError && (error.status === 404 || error.status === 410);
}

async function findPaymentOwners(contaId: string, asaasPaymentId: string): Promise<PaymentOwner[]> {
  const [charges, cobrancas, entries, sales, orders] = await Promise.all([
    prisma.charge.findMany({
      where: { contaId, asaasPaymentId },
      select: { id: true },
    }),
    prisma.cobranca.findMany({
      where: { contaId, asaasPaymentId },
      select: { id: true },
    }),
    prisma.eventFinancialEntry.findMany({
      where: { contaId, asaasPaymentId },
      select: { id: true },
    }),
    prisma.eventTicketSale.findMany({
      where: { contaId, asaasPaymentId },
      select: { id: true },
    }),
    prisma.eventMapOrder.findMany({
      where: { contaId, asaasPaymentId },
      select: { id: true },
    }),
  ]);

  return [
    ...charges.map((row) => ({ kind: 'charge' as const, id: row.id })),
    ...cobrancas.map((row) => ({ kind: 'cobranca' as const, id: row.id })),
    ...entries.map((row) => ({ kind: 'event-entry' as const, id: row.id })),
    ...sales.map((row) => ({ kind: 'event-ticket-sale' as const, id: row.id })),
    ...orders.map((row) => ({ kind: 'event-map-order' as const, id: row.id })),
  ];
}

async function cancelLocalPaymentOwners(
  contaId: string,
  asaasPaymentId: string,
  owners: PaymentOwner[],
  dryRun: boolean,
): Promise<number> {
  if (owners.length === 0) return 0;
  if (dryRun) return owners.length;

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const owner of owners) {
      switch (owner.kind) {
        case 'charge':
          await tx.charge.updateMany({
            where: { id: owner.id, contaId },
            data: {
              status: 'CANCELED',
              statusUpdatedAt: now,
              asaasPaymentId: null,
            },
          });
          break;
        case 'cobranca':
          await tx.cobranca.updateMany({
            where: { id: owner.id, contaId },
            data: {
              status: 'CANCELADO',
              canceladoEm: now,
              canceladoMotivo: 'Pagamento não encontrado no Asaas',
              asaasPaymentId: null,
            },
          });
          break;
        case 'event-entry':
          await tx.eventFinancialEntry.updateMany({
            where: { id: owner.id, contaId },
            data: {
              status: 'CANCELLED',
              cancelledAt: now,
              asaasPaymentId: null,
              paymentStatus: 'DELETED',
            },
          });
          break;
        case 'event-ticket-sale':
          await tx.eventTicketSale.updateMany({
            where: { id: owner.id, contaId },
            data: {
              status: 'CANCELLED',
              cancelledAt: now,
              asaasPaymentId: null,
              paymentStatus: 'DELETED',
            },
          });
          break;
        case 'event-map-order':
          await tx.eventMapOrder.updateMany({
            where: { id: owner.id, contaId },
            data: {
              status: 'CANCELLED',
              cancelledAt: now,
              asaasPaymentId: null,
              paymentStatus: 'DELETED',
              invoiceUrl: null,
            },
          });
          break;
      }
    }
  });

  await auditLogService.record({
    contaId,
    action: 'finance.payment_link.removed_missing_asaas',
    metadata: {
      asaasPaymentId,
      owners,
    },
  });

  return owners.length;
}

async function listDistinctAsaasPaymentIds(
  contaId: string,
  options?: { forceSnapshot?: boolean },
): Promise<string[]> {
  const forceSnapshot = options?.forceSnapshot ?? false;
  const chargeStatuses = forceSnapshot
    ? (['CREATED', 'OPEN', 'OVERDUE', 'PENDING_SYNC', 'PAID', 'REFUNDED', 'CANCELED'] as const)
    : (['CREATED', 'OPEN', 'OVERDUE', 'PENDING_SYNC'] as const);
  const cobrancaStatuses = forceSnapshot
    ? (['PENDENTE', 'A_VENCER', 'ATRASADO', 'PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL', 'CANCELADO'] as const)
    : (['PENDENTE', 'A_VENCER', 'ATRASADO'] as const);

  const [charges, cobrancas, entries, sales, orders, staleCharges, staleCobrancas] = await Promise.all([
    prisma.charge.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: { in: [...chargeStatuses] },
      },
      select: { asaasPaymentId: true },
    }),
    prisma.cobranca.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: { in: [...cobrancaStatuses] },
      },
      select: { asaasPaymentId: true },
    }),
    prisma.eventFinancialEntry.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: { in: ['EXPECTED', 'PENDING'] },
      },
      select: { asaasPaymentId: true },
    }),
    prisma.eventTicketSale.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: 'PENDING',
      },
      select: { asaasPaymentId: true },
    }),
    prisma.eventMapOrder.findMany({
      where: {
        contaId,
        asaasPaymentId: { not: null },
        status: 'PAYMENT_PENDING',
      },
      select: { asaasPaymentId: true },
    }),
    ...(forceSnapshot
      ? [
          prisma.charge.findMany({
            where: {
              contaId,
              asaasPaymentId: { not: null },
              OR: [{ asaasStatus: null }, { lastAsaasFetchAt: null }],
            },
            select: { asaasPaymentId: true },
          }),
          prisma.cobranca.findMany({
            where: {
              contaId,
              asaasPaymentId: { not: null },
              OR: [{ asaasStatus: null }, { lastAsaasFetchAt: null }],
            },
            select: { asaasPaymentId: true },
          }),
        ]
      : [Promise.resolve([]), Promise.resolve([])]),
  ]);

  return Array.from(
    new Set(
      [...charges, ...cobrancas, ...entries, ...sales, ...orders, ...staleCharges, ...staleCobrancas]
        .map((row) => row.asaasPaymentId)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ),
  );
}

async function reconcileCancelledCostumeAssignmentEntries(contaId: string, dryRun: boolean): Promise<number> {
  const staleEntries = await prisma.eventFinancialEntry.findMany({
    where: {
      contaId,
      originType: 'COSTUME_ASSIGNMENT',
      status: { in: ['PENDING', 'EXPECTED'] },
      originId: { not: null },
    },
    select: { id: true, originId: true },
  });
  if (staleEntries.length === 0) return 0;

  const assignmentIds = staleEntries
    .map((entry) => entry.originId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (assignmentIds.length === 0) return 0;

  const cancelledAssignments = await prisma.eventCostumeAssignment.findMany({
    where: {
      contaId,
      id: { in: assignmentIds },
      status: 'CANCELLED',
    },
    select: { id: true, revenueEntryId: true },
  });

  const entryIds = cancelledAssignments
    .map((assignment) => assignment.revenueEntryId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (entryIds.length === 0) return 0;
  if (dryRun) return entryIds.length;

  const now = new Date();
  const updated = await prisma.eventFinancialEntry.updateMany({
    where: {
      contaId,
      id: { in: entryIds },
      status: { in: ['PENDING', 'EXPECTED'] },
    },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      actualAmount: null,
      realizedAt: null,
    },
  });

  return updated.count;
}

/**
 * Verifica cobranças operacionais com asaasPaymentId:
 * - se o pagamento não existir no Asaas, cancela localmente;
 * - se existir, sincroniza estado via pipeline idempotente de webhook.
 */
export async function reconcileOperationalChargeLinks(
  input: ReconcileOperationalChargeLinksInput,
): Promise<ReconcileOperationalChargeLinksResult> {
  const { contaId, dryRun = false, forceSnapshot = false } = input;
  const result: ReconcileOperationalChargeLinksResult = {
    checked: 0,
    synced: 0,
    removed: 0,
    skipped: 0,
    inventoryRepaired: 0,
    errors: [],
  };

  if (!isAsaasEnabled()) {
    result.synced += await reconcileCancelledCostumeAssignmentEntries(contaId, dryRun);
    const inventory = await reconcilePaidReservedStoreSales({ contaId, dryRun });
    result.inventoryRepaired = inventory.fulfilled;
    result.errors.push(...inventory.errors.map((error) => ({ asaasPaymentId: `sale:${error.saleId}`, error: error.error })));
    result.skipped = 1;
    result.errors.push({ asaasPaymentId: '*', error: 'ASAAS_DISABLED' });
    return result;
  }

  result.synced += await reconcileCancelledCostumeAssignmentEntries(contaId, dryRun);

  const paymentIds = await listDistinctAsaasPaymentIds(contaId, { forceSnapshot });

  for (const asaasPaymentId of paymentIds) {
    result.checked++;
    const owners = await findPaymentOwners(contaId, asaasPaymentId);

    try {
      if (dryRun) {
        await getPayment(asaasPaymentId, { contaId });
        result.synced++;
        continue;
      }

      await getPayment(asaasPaymentId, { contaId });
      const syncResult = await syncPaymentStateFromAsaas({ contaId, asaasPaymentId });
      if (syncResult.success) {
        result.synced++;
      } else {
        result.errors.push({ asaasPaymentId, error: syncResult.error });
      }
    } catch (error) {
      if (isPaymentMissingInAsaas(error)) {
        result.removed += await cancelLocalPaymentOwners(contaId, asaasPaymentId, owners, dryRun);
        continue;
      }

      result.errors.push({
        asaasPaymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const inventory = await reconcilePaidReservedStoreSales({ contaId, dryRun });
  result.inventoryRepaired = inventory.fulfilled;
  result.errors.push(...inventory.errors.map((error) => ({ asaasPaymentId: `sale:${error.saleId}`, error: error.error })));

  return result;
}
