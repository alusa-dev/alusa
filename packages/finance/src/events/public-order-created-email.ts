import { FinanceWebhookSideEffectStatus, Prisma } from '@prisma/client';
import { toAuditJson } from '@alusa/lib/events/map/event-map-order-operations';

/** Enqueues the buyer email in the same transaction that creates the order. */
export async function enqueuePublicOrderCreatedEmail(
  tx: Prisma.TransactionClient,
  params: {
    contaId: string;
    orderId: string;
    buyerEmail: string;
    buyerName: string;
    eventName: string;
    eventStartsAt: Date;
    statusPath: string;
    invoiceUrl: string | null;
    paymentMethod: string;
    expiresAt: Date;
  },
) {
  await tx.financeWebhookSideEffectOutbox.createMany({
    data: {
      contaId: params.contaId,
      effectType: 'EVENT_PUBLIC_ORDER_CREATED_EMAIL',
      dedupeKey: `${params.contaId}:EVENT_PUBLIC_ORDER_CREATED_EMAIL:${params.orderId}`,
      payload: toAuditJson({
        orderId: params.orderId,
        buyerEmail: params.buyerEmail,
        buyerName: params.buyerName,
        eventName: params.eventName,
        eventStartsAt: params.eventStartsAt.toISOString(),
        statusPath: params.statusPath,
        invoiceUrl: params.invoiceUrl,
        paymentMethod: params.paymentMethod,
        expiresAt: params.expiresAt.toISOString(),
      }),
      status: FinanceWebhookSideEffectStatus.PENDING,
    },
    skipDuplicates: true,
  });
}
