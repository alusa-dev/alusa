export type EventParticipantRemovalDecision =
  | { canRemove: true; reasons: [] }
  | { canRemove: false; reasons: string[] };

type RemovalFinancialEntry = {
  status: string;
  actualAmount?: number | null;
  refundedAmount?: number | null;
  netAmount?: number | null;
};

type RemovalCharge = {
  status: string;
};

type RemovalTicketSale = {
  status: string;
};

type RemovalTicket = {
  status: string;
};

type RemovalPublicOrder = {
  status: string;
  ticketsCount?: number | null;
  itemsCount?: number | null;
  refundedAmount?: number | null;
};

type RemovalCostumeAssignment = {
  status: string;
  isPaid?: boolean | null;
};

export type EventParticipantRemovalFacts = {
  cancelledAt?: Date | string | null;
  isFeePaid?: boolean | null;
  feePaidAmount?: number | null;
  feeRefundedAmount?: number | null;
  financialEntries?: ReadonlyArray<RemovalFinancialEntry>;
  charges?: ReadonlyArray<RemovalCharge>;
  ticketSales?: ReadonlyArray<RemovalTicketSale>;
  tickets?: ReadonlyArray<RemovalTicket>;
  publicOrders?: ReadonlyArray<RemovalPublicOrder>;
  costumeAssignments?: ReadonlyArray<RemovalCostumeAssignment>;
};

const BLOCKED_FINANCIAL_ENTRY_STATUSES = new Set(['PAID', 'RECEIVED', 'PARTIALLY_REFUNDED', 'REFUNDED']);
const OPEN_CHARGE_STATUSES = new Set(['CREATED', 'PENDING_SYNC', 'OPEN', 'OVERDUE']);
const BLOCKED_CHARGE_STATUSES = new Set(['PAID', 'RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'REFUNDED']);
const BLOCKED_TICKET_SALE_STATUSES = new Set(['PENDING', 'PAID', 'COMPLIMENTARY', 'REFUNDED']);
const BLOCKED_PUBLIC_ORDER_STATUSES = new Set(['PAYMENT_PENDING', 'CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED']);
const BLOCKED_COSTUME_ASSIGNMENT_STATUSES = new Set(['PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST']);

function hasPositiveValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function pushReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function canRemoveEventParticipant(facts: EventParticipantRemovalFacts): EventParticipantRemovalDecision {
  const reasons: string[] = [];

  if (!facts.cancelledAt) {
    pushReason(reasons, 'Cancele a inscrição antes de remover o participante.');
  }

  if (facts.isFeePaid || hasPositiveValue(facts.feePaidAmount)) {
    pushReason(reasons, 'Este participante possui pagamento registrado.');
  }

  if (hasPositiveValue(facts.feeRefundedAmount)) {
    pushReason(reasons, 'Este participante possui estorno registrado.');
  }

  for (const entry of facts.financialEntries ?? []) {
    if (
      BLOCKED_FINANCIAL_ENTRY_STATUSES.has(entry.status) ||
      hasPositiveValue(entry.actualAmount) ||
      hasPositiveValue(entry.refundedAmount) ||
      hasPositiveValue(entry.netAmount)
    ) {
      pushReason(reasons, 'Este participante possui lançamento financeiro realizado.');
    }
  }

  for (const charge of facts.charges ?? []) {
    if (BLOCKED_CHARGE_STATUSES.has(charge.status)) {
      pushReason(reasons, 'Este participante possui cobrança com pagamento ou estorno registrado.');
    }

    if (OPEN_CHARGE_STATUSES.has(charge.status)) {
      pushReason(reasons, 'Este participante possui cobrança pendente ou vencida.');
    }
  }

  if ((facts.ticketSales ?? []).some((sale) => BLOCKED_TICKET_SALE_STATUSES.has(sale.status))) {
    pushReason(reasons, 'Este participante possui ingresso registrado.');
  }

  if ((facts.tickets ?? []).length > 0) {
    pushReason(reasons, 'Este participante possui ingresso emitido.');
  }

  for (const order of facts.publicOrders ?? []) {
    if (BLOCKED_PUBLIC_ORDER_STATUSES.has(order.status)) {
      pushReason(reasons, 'Este participante possui pedido público confirmado ou pendente.');
    }

    if (hasPositiveValue(order.refundedAmount) || hasPositiveValue(order.ticketsCount) || hasPositiveValue(order.itemsCount)) {
      pushReason(reasons, 'Este participante possui ingresso emitido.');
    }
  }

  for (const assignment of facts.costumeAssignments ?? []) {
    if (BLOCKED_COSTUME_ASSIGNMENT_STATUSES.has(assignment.status)) {
      pushReason(reasons, 'Este participante possui figurino vinculado.');
    }

    if (assignment.isPaid) {
      pushReason(reasons, 'Este participante possui pagamento de figurino registrado.');
    }
  }

  if (reasons.length > 0) {
    return { canRemove: false, reasons };
  }

  return { canRemove: true, reasons: [] };
}
