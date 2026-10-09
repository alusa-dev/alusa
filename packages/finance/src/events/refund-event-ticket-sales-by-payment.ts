import { prisma } from '@alusa/database';
import {
  decimal,
  releaseSeatsForTicketSale,
  syncPublicLotQuantity,
  toMoney,
} from '@alusa/lib/events/map/event-map-order-operations';

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
    for (const sale of sales) {
      if (!params.isFinalRefund) {
        if (sale.status === 'REFUNDED') continue;
        await tx.eventTicketSale.update({
          where: { id: sale.id, contaId: params.contaId },
          data: { paymentStatus: params.paymentStatus },
        });
        await tx.eventFinancialEntry.updateMany({
          where: { contaId: params.contaId, originType: 'TICKET_SALE', originId: sale.id },
          data: { paymentStatus: params.paymentStatus },
        });
        continue;
      }

      if (sale.status === 'REFUNDED') {
        await tx.eventTicketSale.update({
          where: { id: sale.id, contaId: params.contaId },
          data: { paymentStatus: params.paymentStatus },
        });
        await tx.eventFinancialEntry.updateMany({
          where: { contaId: params.contaId, originType: 'TICKET_SALE', originId: sale.id },
          data: { paymentStatus: params.paymentStatus },
        });
        continue;
      }

      const refundedAmount = params.refundedAmount == null
        ? toMoney(sale.totalAmount)
        : Math.min(toMoney(sale.totalAmount), Math.max(toMoney(params.refundedAmount), 0));
      await tx.eventTicketSale.update({
        where: { id: sale.id, contaId: params.contaId },
        data: {
          status: 'REFUNDED',
          refundedAt: now,
          refundedAmount: decimal(refundedAmount),
          paymentStatus: params.paymentStatus,
        },
      });
      refundedSaleIds.push(sale.id);
      affectedLotIds.add(sale.lotId);
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: params.contaId, originType: 'TICKET_SALE', originId: sale.id },
        data: {
          status: 'REFUNDED',
          refundedAt: now,
          refundedAmount: decimal(refundedAmount),
          netAmount: decimal(Math.max(toMoney(sale.totalAmount) - refundedAmount, 0)),
          paymentStatus: params.paymentStatus,
        },
      });
    }

    for (const saleId of refundedSaleIds) {
      await releaseSeatsForTicketSale(tx, params.contaId, saleId);
    }
    for (const lotId of [...affectedLotIds].sort()) {
      await syncPublicLotQuantity(tx, params.contaId, lotId);
    }

    const allRefunded = sales.every((sale) => sale.status === 'REFUNDED' || params.isFinalRefund);
    return { count: sales.length, status: allRefunded ? 'REFUNDED' : params.paymentStatus };
  });
}
