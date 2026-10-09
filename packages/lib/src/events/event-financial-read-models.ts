import { Prisma } from '@prisma/client';

function toNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function toMoney(value: Prisma.Decimal | number | string | null | undefined): number {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}
function toIso(value: Date | null | undefined): string | null { return value ? value.toISOString() : null; }

export const eventParticipantScalarSelect = {
  id: true,
  contaId: true,
  eventId: true,
  type: true,
  alunoId: true,
  turmaId: true,
  responsavelId: true,
  displayName: true,
  notes: true,
  registrationFeeCharged: true,
  registrationFeeOriginal: true,
  registrationFeeDiscount: true,
  registrationFeeDiscountType: true,
  billingMode: true,
  entryAmount: true,
  balanceAmount: true,
  entryPaymentMethod: true,
  billingGroupId: true,
  registrationPaymentRules: true,
  isFeePaid: true,
  isFeeExempt: true,
  feePaymentMethod: true,
  revenueEntryId: true,
  financialStatusSnapshot: true,
  feePaidAmount: true,
  feeRefundedAmount: true,
  standaloneChargeId: true,
  asaasPaymentId: true,
  asaasInstallmentId: true,
  cancelledAt: true,
  cancelledReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventParticipantSelect;


export function mapTicketSale(
  sale: Prisma.EventTicketSaleGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      lot: { select: { id: true; name: true; ticketType: true } };
      aluno: { select: { id: true; nome: true } };
      responsavel: { select: { id: true; nome: true } };
      createdBy: { select: { id: true; nome: true } };
    };
  }>,
) {
  const source = sale.eventMapOrderId ? ('PUBLIC_ORDER' as const) : ('MANUAL_SALE' as const);
  const chargeDetailUrl = sale.eventMapOrderId
    ? `/cobrancas/event-map-order:${sale.eventMapOrderId}`
    : `/cobrancas/event-ticket-sale:${sale.id}`;

  return {
    id: sale.id,
    contaId: sale.contaId,
    eventId: sale.eventId,
    event: { ...sale.event, startsAt: sale.event.startsAt.toISOString() },
    lotId: sale.lotId,
    lot: sale.lot,
    buyerName: sale.buyerName,
    aluno: sale.aluno,
    responsavel: sale.responsavel,
    quantity: sale.quantity,
    unitPriceSnapshot: toMoney(sale.unitPriceSnapshot),
    totalAmount: toMoney(sale.totalAmount),
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    soldAt: sale.soldAt.toISOString(),
    paidAt: toIso(sale.paidAt),
    cancelledAt: toIso(sale.cancelledAt),
    refundedAt: toIso(sale.refundedAt),
    createdBy: sale.createdBy,
    notes: sale.notes,
    revenueEntryId: sale.revenueEntryId,
    createdAt: sale.createdAt.toISOString(),
    updatedAt: sale.updatedAt.toISOString(),
    source,
    eventMapOrderId: sale.eventMapOrderId,
    paymentProvider: sale.paymentProvider,
    asaasPaymentId: sale.asaasPaymentId,
    paymentStatus: sale.paymentStatus,
    chargeDetailUrl,
  };
}


export function mapFinancialEntry(
  entry: Prisma.EventFinancialEntryGetPayload<{
    include: {
      event: { select: { id: true; name: true; startsAt: true } };
      createdBy: { select: { id: true; nome: true } };
    };
  }>,
) {
  return {
    id: entry.id,
    contaId: entry.contaId,
    eventId: entry.eventId,
    event: { ...entry.event, startsAt: entry.event.startsAt.toISOString() },
    type: entry.type,
    category: entry.category,
    description: entry.description,
    supplier: entry.supplier,
    originType: entry.originType,
    originId: entry.originId,
    costClass: entry.costClass,
    expectedAmount: toMoney(entry.expectedAmount),
    grossAmount: entry.grossAmount == null ? null : toMoney(entry.grossAmount),
    discountAmount: toMoney(entry.discountAmount),
    actualAmount: entry.actualAmount == null ? null : toMoney(entry.actualAmount),
    refundedAmount: entry.refundedAmount == null ? 0 : toMoney(entry.refundedAmount),
    netAmount: entry.netAmount == null ? null : toMoney(entry.netAmount),
    dueDate: toIso(entry.dueDate),
    realizedAt: toIso(entry.realizedAt),
    status: entry.status,
    paymentMethod: entry.paymentMethod,
    proofUrl: entry.proofUrl,
    notes: entry.notes,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
