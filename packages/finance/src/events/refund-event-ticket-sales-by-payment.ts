import { prisma } from '@alusa/database';
import {
  decimal,
  releaseSeatsForTicketSale,
  syncPublicLotQuantity,
  toMoney,
} from '@alusa/lib/events/map/event-map-order-operations';
import { isTicketPaymentBlocked } from '@alusa/domain/events';
import { logEventsFinance } from './events-finance-observability';

const REFUND_PROCESSING_PAYMENT_STATUSES = new Set([
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_IN_PROGRESS',
]);
const REFUND_SUCCESS_PAYMENT_STATUSES = new Set(['REFUNDED', 'PAYMENT_REFUNDED']);

function normalizedPaymentStatus(status: string | null | undefined) {
  return (status ?? '').trim().toUpperCase();
}

export async function refundEventTicketSalesByPayment(params: {
  contaId: string;
  paymentId: string;
  paymentStatus: string;
  isFinalRefund: boolean;
  refundedAmount?: number | null;
}) {
  return prisma.$transaction(async (tx) => {
    const lockedSales = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "EventTicketSale"
      WHERE "contaId" = ${params.contaId}
        AND "asaasPaymentId" = ${params.paymentId}
        AND "eventMapOrderId" IS NULL
      ORDER BY id
      FOR UPDATE
    `;
    const saleIds = lockedSales.map(({ id }) => id);
    const sales = saleIds.length === 0
      ? []
      : await tx.eventTicketSale.findMany({
        where: { contaId: params.contaId, id: { in: saleIds }, eventMapOrderId: null },
        orderBy: { id: 'asc' },
      });
    if (sales.length === 0) return null;

    const now = new Date();
    const refundedSaleIds: string[] = [];
    const affectedLotIds = new Set<string>();
    let allSalesFullyRefunded = true;
    const totalGross = toMoney(sales.reduce((sum, sale) => sum + toMoney(sale.totalAmount), 0));
    const persistedRefundTotal = toMoney(sales.reduce((sum, sale) => sum + Math.max(toMoney(sale.refundedAmount), 0), 0));
    const overRefundedSaleCount = sales.filter(
      (sale) => toMoney(sale.refundedAmount) > toMoney(sale.totalAmount),
    ).length;
    if (overRefundedSaleCount > 0) {
      logEventsFinance(
        'finance.events.ticket_sale.refund_amount_over_gross',
        { errors: overRefundedSaleCount },
        'warn',
      );
    }
    const providerRefundTotal = params.refundedAmount == null
      ? null
      : Math.min(totalGross, Math.max(toMoney(params.refundedAmount), 0));
    const cumulativeRefundTarget = params.isFinalRefund
      ? totalGross
      : providerRefundTotal == null
        ? null
        : Math.min(totalGross, Math.max(persistedRefundTotal, providerRefundTotal));
    let refundIncrementRemaining = cumulativeRefundTarget == null
      ? 0
      : Math.max(cumulativeRefundTarget - persistedRefundTotal, 0);

    for (const sale of sales) {
      const saleAmount = toMoney(sale.totalAmount);
      // Preserve each persisted row's distribution. Allocate only the new
      // cumulative provider increment, in stable sale-ID order, within the
      // remaining amount for that sale.
      const previousRefund = Math.max(toMoney(sale.refundedAmount), 0);
      const saleCapacity = Math.max(saleAmount - previousRefund, 0);
      const saleIncrement = cumulativeRefundTarget == null
        ? 0
        : Math.min(saleCapacity, refundIncrementRemaining);
      refundIncrementRemaining = Math.max(refundIncrementRemaining - saleIncrement, 0);
      const refundedAmount = toMoney(previousRefund + saleIncrement);
      const hasRefundAmount = cumulativeRefundTarget != null;
      const isFullyRefunded = params.isFinalRefund || sale.status === 'REFUNDED' ||
        (hasRefundAmount && saleAmount > 0 && refundedAmount >= saleAmount);
      if (!isFullyRefunded) allSalesFullyRefunded = false;
      const existingPaymentStatus = normalizedPaymentStatus(sale.paymentStatus);
      const incomingPaymentStatus = normalizedPaymentStatus(params.paymentStatus);
      const isExistingRefundInProgress = REFUND_PROCESSING_PAYMENT_STATUSES.has(existingPaymentStatus);
      const isIncomingRefundSuccess = REFUND_SUCCESS_PAYMENT_STATUSES.has(incomingPaymentStatus);
      const hasNonRefundPaymentHold = isTicketPaymentBlocked(sale.paymentStatus) && !isExistingRefundInProgress;
      const paymentStatus = hasNonRefundPaymentHold
        ? sale.paymentStatus
        : REFUND_SUCCESS_PAYMENT_STATUSES.has(existingPaymentStatus)
          ? sale.paymentStatus
          : sale.status === 'REFUNDED'
            ? isIncomingRefundSuccess ? params.paymentStatus : 'PAYMENT_REFUNDED'
            : params.paymentStatus;

      await tx.eventTicketSale.update({
        where: { id: sale.id, contaId: params.contaId },
        data: {
          ...(isFullyRefunded ? { status: 'REFUNDED' as const, refundedAt: now } : {}),
          ...(hasRefundAmount ? { refundedAmount: decimal(refundedAmount) } : {}),
          paymentStatus,
        },
      });
      if (isFullyRefunded && sale.status !== 'REFUNDED') {
        refundedSaleIds.push(sale.id);
        affectedLotIds.add(sale.lotId);
      }
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: params.contaId, originType: 'TICKET_SALE', originId: sale.id },
        data: {
          ...(isFullyRefunded
            ? { status: 'REFUNDED' as const, refundedAt: now }
            : hasRefundAmount && refundedAmount > 0
              ? { status: 'PARTIALLY_REFUNDED' as const, refundedAt: now }
              : {}),
          ...(hasRefundAmount
            ? {
              refundedAmount: decimal(refundedAmount),
              netAmount: decimal(Math.max(saleAmount - refundedAmount, 0)),
            }
            : {}),
          paymentStatus,
        },
      });
    }

    for (const saleId of refundedSaleIds) {
      await releaseSeatsForTicketSale(tx, params.contaId, saleId);
    }
    for (const lotId of [...affectedLotIds].sort()) {
      await syncPublicLotQuantity(tx, params.contaId, lotId);
    }

    return { count: sales.length, status: allSalesFullyRefunded ? 'REFUNDED' : params.paymentStatus };
  });
}
