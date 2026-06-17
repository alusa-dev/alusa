import { prisma } from '@alusa/database';
import { buildStaffSaleTicketsUrl } from '@alusa/domain/events';

export type OperationalChargeKind = 'event-entry' | 'event-ticket-sale' | 'event-map-order';

export type ResolvedOperationalChargePayment = {
  operationalId: string;
  kind: OperationalChargeKind;
  entityId: string;
  contaId: string;
  eventId: string;
  asaasPaymentId: string | null;
  invoiceUrl: string | null;
  billingType: string | null;
  localStatus: 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELED' | 'REFUNDED' | 'PROCESSING';
  value: number;
  dueDate: Date | null;
  payerName: string;
  description: string;
  alunoId: string | null;
  paidAt: Date | null;
  refundedAmount: number;
  eventDetails?: {
    eventName: string;
    buyerName: string;
    seats: Array<{ id: string; sectionName: string; seatLabel: string; unitPrice: number }>;
    ticketsUrl: string | null;
  };
};

export function parseOperationalChargeId(
  id: string,
): { kind: OperationalChargeKind; entityId: string } | null {
  if (id.startsWith('event-entry:')) {
    return { kind: 'event-entry', entityId: id.slice('event-entry:'.length) };
  }
  if (id.startsWith('event-ticket-sale:')) {
    return { kind: 'event-ticket-sale', entityId: id.slice('event-ticket-sale:'.length) };
  }
  if (id.startsWith('event-map-order:')) {
    return { kind: 'event-map-order', entityId: id.slice('event-map-order:'.length) };
  }
  return null;
}

function mapEventFinancialEntryStatus(status: string): ResolvedOperationalChargePayment['localStatus'] {
  switch (status) {
    case 'PAID':
    case 'RECEIVED':
      return 'PAID';
    case 'PROCESSING':
      return 'PROCESSING';
    case 'CANCELLED':
      return 'CANCELED';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'EXPECTED':
    case 'PENDING':
    default:
      return 'PENDING';
  }
}

function mapEventTicketSaleStatus(status: string): ResolvedOperationalChargePayment['localStatus'] {
  switch (status) {
    case 'PAID':
    case 'COMPLIMENTARY':
      return 'PAID';
    case 'CANCELLED':
      return 'CANCELED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'PENDING':
    default:
      return 'PENDING';
  }
}

function mapEventMapOrderStatus(status: string): ResolvedOperationalChargePayment['localStatus'] {
  switch (status) {
    case 'CONFIRMED':
      return 'PAID';
    case 'PAYMENT_REFUND_IN_PROGRESS':
    case 'REFUND_IN_PROGRESS':
    case 'REFUND_REQUESTED':
      return 'PROCESSING';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELED';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'REFUNDED';
    case 'PAYMENT_PENDING':
    default:
      return 'PENDING';
  }
}

function applyOverdueIfNeeded(
  status: ResolvedOperationalChargePayment['localStatus'],
  dueDate: Date | null,
): ResolvedOperationalChargePayment['localStatus'] {
  if (status !== 'PENDING' || !dueDate) return status;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today ? 'OVERDUE' : status;
}

function mapEventPaymentMethod(method?: string | null): string | null {
  if (!method) return null;
  switch (method) {
    case 'PIX':
      return 'PIX';
    case 'BOLETO':
      return 'BOLETO';
    case 'CREDIT_CARD':
    case 'CARTAO_CREDITO':
      return 'CREDIT_CARD';
    case 'DEBIT_CARD':
    case 'CARTAO_DEBITO':
      return 'DEBIT_CARD';
    default:
      return method;
  }
}

export async function resolveOperationalChargePayment(
  contaId: string,
  operationalId: string,
): Promise<ResolvedOperationalChargePayment | null> {
  const parsed = parseOperationalChargeId(operationalId);
  if (!parsed) return null;

  if (parsed.kind === 'event-entry') {
    const entry = await prisma.eventFinancialEntry.findFirst({
      where: { id: parsed.entityId, contaId },
      include: { event: { select: { id: true, name: true } } },
    });
    if (!entry) return null;

    const dueDate = entry.dueDate ?? entry.realizedAt ?? entry.createdAt;
    const localStatus = applyOverdueIfNeeded(mapEventFinancialEntryStatus(entry.status), entry.dueDate);

    return {
      operationalId,
      kind: parsed.kind,
      entityId: entry.id,
      contaId,
      eventId: entry.eventId,
      asaasPaymentId: entry.asaasPaymentId,
      invoiceUrl: entry.proofUrl,
      billingType: mapEventPaymentMethod(entry.paymentMethod),
      localStatus,
      value: Number(entry.expectedAmount),
      dueDate,
      payerName: entry.event.name,
      description: `${entry.event.name} · ${entry.description || entry.category}`,
      alunoId: null,
      paidAt: entry.realizedAt,
      refundedAmount: Number(entry.refundedAmount ?? 0),
    };
  }

  if (parsed.kind === 'event-ticket-sale') {
    const sale = await prisma.eventTicketSale.findFirst({
      where: { id: parsed.entityId, contaId },
      include: {
        event: { select: { id: true, name: true } },
        saleSeats: {
          select: { id: true, sectionName: true, seatLabel: true, unitPriceSnapshot: true },
          orderBy: [{ sectionName: 'asc' }, { seatLabel: 'asc' }],
        },
      },
    });
    if (!sale) return null;

    const dueDate = sale.soldAt;
    const localStatus = applyOverdueIfNeeded(mapEventTicketSaleStatus(sale.status), dueDate);

    return {
      operationalId,
      kind: parsed.kind,
      entityId: sale.id,
      contaId,
      eventId: sale.eventId,
      asaasPaymentId: sale.asaasPaymentId,
      invoiceUrl: null,
      billingType: mapEventPaymentMethod(sale.paymentMethod),
      localStatus,
      value: Number(sale.totalAmount),
      dueDate,
      payerName: sale.buyerName,
      description: `${sale.event.name} · ${sale.quantity} ingresso(s)`,
      alunoId: sale.alunoId,
      paidAt: sale.paidAt,
      refundedAmount: Number(sale.refundedAmount ?? 0),
      eventDetails: {
        eventName: sale.event.name,
        buyerName: sale.buyerName,
        seats: sale.saleSeats.map((seat) => ({
          id: seat.id,
          sectionName: seat.sectionName,
          seatLabel: seat.seatLabel,
          unitPrice: Number(seat.unitPriceSnapshot),
        })),
        ticketsUrl: buildStaffSaleTicketsUrl(sale.id, sale.status, sale.saleSeats.length),
      },
    };
  }

  const order = await prisma.eventMapOrder.findFirst({
    where: { id: parsed.entityId, contaId },
    include: {
      event: { select: { id: true, name: true } },
      items: {
        select: { id: true, sectionName: true, seatLabel: true, unitPriceSnapshot: true },
        orderBy: [{ sectionName: 'asc' }, { seatLabel: 'asc' }],
      },
    },
  });
  if (!order) return null;

  const dueDate = order.expiresAt ?? order.createdAt;
  const localStatus = ['REFUND_IN_PROGRESS', 'REFUND_REQUESTED'].includes(order.paymentStatus ?? '')
    ? 'PROCESSING'
    : applyOverdueIfNeeded(mapEventMapOrderStatus(order.status), order.expiresAt);

  return {
    operationalId,
    kind: 'event-map-order',
    entityId: order.id,
    contaId,
    eventId: order.eventId,
    asaasPaymentId: order.asaasPaymentId,
    invoiceUrl: order.invoiceUrl,
    billingType: mapEventPaymentMethod(order.paymentMethod ?? order.paymentProvider),
    localStatus,
    value: Number(order.totalAmount),
    dueDate,
    payerName: order.buyerName,
    description: `${order.event.name} · Pedido de ingresso`,
    alunoId: null,
    paidAt: order.paidAt,
    refundedAmount: Number(order.refundedAmount ?? 0),
    eventDetails: {
      eventName: order.event.name,
      buyerName: order.buyerName,
      seats: order.items.map((item) => ({
        id: item.id,
        sectionName: item.sectionName,
        seatLabel: item.seatLabel,
        unitPrice: Number(item.unitPriceSnapshot),
      })),
      ticketsUrl: order.status === 'CONFIRMED' ? `/api/events/public-orders/${order.id}/tickets` : null,
    },
  };
}

export function mapOperationalStatusToCobrancaDisplay(status: ResolvedOperationalChargePayment['localStatus']): string {
  switch (status) {
    case 'PAID':
      return 'PAGO';
    case 'CANCELED':
      return 'CANCELADO';
    case 'REFUNDED':
      return 'ESTORNADO';
    case 'OVERDUE':
      return 'ATRASADO';
    case 'PROCESSING':
      return 'PROCESSANDO';
    case 'PENDING':
    default:
      return 'PENDENTE';
  }
}
