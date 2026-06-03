export type SchoolEventStatus = 'DRAFT' | 'PLANNING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED' | 'ARCHIVED';
export type EventTicketMode = 'NONE' | 'SIMPLE' | 'NUMBERED_SEATS';
export type EventTicketLotStatus = 'DRAFT' | 'ACTIVE' | 'SOLD_OUT' | 'CLOSED' | 'CANCELLED' | 'ARCHIVED';
export type EventTicketSaleStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'COMPLIMENTARY';
export type EventCostumeAssignmentStatus =
  | 'PENDING'
  | 'ORDERED'
  | 'RECEIVED'
  | 'DELIVERED'
  | 'RETURNED'
  | 'DAMAGED'
  | 'LOST'
  | 'CANCELLED';
export type EventCostumeAssignmentBillingMode =
  | 'INCLUDED_IN_REGISTRATION_FEE'
  | 'SEPARATE_CHARGE'
  | 'FREE';
export type EventFinancialEntryType = 'COST' | 'REVENUE';
export type EventFinancialEntryStatus =
  | 'EXPECTED'
  | 'PENDING'
  | 'PAID'
  | 'RECEIVED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';
export type EventFinancialOriginType = 'MANUAL' | 'TICKET_SALE' | 'COSTUME' | 'COSTUME_ASSIGNMENT';

export type EventParticipantFinancialStatus =
  | 'ISENTO'
  | 'PENDENTE'
  | 'EM_DIA'
  | 'ATRASADO'
  | 'QUITADO'
  | 'CANCELADO'
  | 'ESTORNADO'
  | 'ESTORNADO_PARCIAL';

export type EventChargeLike = {
  status?: string | null;
  value?: number | string | null;
  amount?: number | string | null;
  paidValue?: number | string | null;
  refundedValue?: number | string | null;
  dueDate?: Date | string | null;
  paymentDate?: Date | string | null;
  paidAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  refundedAt?: Date | string | null;
};

export type EventParticipantPaymentResolution = {
  status: EventParticipantFinancialStatus;
  expectedAmount: number;
  paidAmount: number;
  refundedAmount: number;
  netPaidAmount: number;
  openAmount: number;
  overdueAmount: number;
  percentPaid: number;
  isFullyPaid: boolean;
  hasOverdue: boolean;
};

export type EventTransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

const EVENT_STATUS_TRANSITIONS: Record<SchoolEventStatus, SchoolEventStatus[]> = {
  DRAFT: ['PLANNING'],
  PLANNING: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['FINISHED', 'CANCELLED'],
  FINISHED: ['ARCHIVED', 'ACTIVE'],
  CANCELLED: ['ARCHIVED'],
  ARCHIVED: ['FINISHED'],
};

const LOT_STATUS_TRANSITIONS: Record<EventTicketLotStatus, EventTicketLotStatus[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['SOLD_OUT', 'CLOSED', 'CANCELLED'],
  SOLD_OUT: ['CLOSED'],
  CLOSED: ['ARCHIVED'],
  CANCELLED: [],
  ARCHIVED: [],
};

const SALE_STATUS_TRANSITIONS: Record<EventTicketSaleStatus, EventTicketSaleStatus[]> = {
  PENDING: ['PAID', 'CANCELLED'],
  PAID: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
  COMPLIMENTARY: ['CANCELLED'],
};

const COSTUME_ASSIGNMENT_TRANSITIONS: Record<
  EventCostumeAssignmentStatus,
  EventCostumeAssignmentStatus[]
> = {
  PENDING: ['ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST', 'CANCELLED'],
  ORDERED: ['PENDING', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST', 'CANCELLED'],
  RECEIVED: ['PENDING', 'ORDERED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST', 'CANCELLED'],
  DELIVERED: ['PENDING', 'ORDERED', 'RECEIVED', 'RETURNED', 'DAMAGED', 'LOST', 'CANCELLED'],
  RETURNED: ['PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'DAMAGED', 'LOST', 'CANCELLED'],
  DAMAGED: ['PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'LOST', 'CANCELLED'],
  LOST: ['PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'CANCELLED'],
  CANCELLED: ['PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST'],
};

function transitionResult<T extends string>(
  transitions: Record<T, T[]>,
  current: T,
  next: T,
): EventTransitionResult {
  if (current === next) return { ok: true };
  if (transitions[current]?.includes(next)) return { ok: true };

  return {
    ok: false,
    reason: `Transição inválida de ${current} para ${next}.`,
  };
}

export function validateSchoolEventStatusTransition(
  current: SchoolEventStatus,
  next: SchoolEventStatus,
): EventTransitionResult {
  return transitionResult(EVENT_STATUS_TRANSITIONS, current, next);
}

export function validateTicketLotStatusTransition(
  current: EventTicketLotStatus,
  next: EventTicketLotStatus,
): EventTransitionResult {
  return transitionResult(LOT_STATUS_TRANSITIONS, current, next);
}

export function validateTicketSaleStatusTransition(
  current: EventTicketSaleStatus,
  next: EventTicketSaleStatus,
): EventTransitionResult {
  return transitionResult(SALE_STATUS_TRANSITIONS, current, next);
}

export function validateCostumeAssignmentStatusTransition(
  current: EventCostumeAssignmentStatus,
  next: EventCostumeAssignmentStatus,
): EventTransitionResult {
  return transitionResult(COSTUME_ASSIGNMENT_TRANSITIONS, current, next);
}

export type EventMetricTicketSale = {
  status: EventTicketSaleStatus;
  quantity: number;
  totalAmount: number | string | null;
};

export type EventMetricTicketLot = {
  quantityTotal: number;
  quantitySold: number;
  unitPrice?: number;
};

export type EventMetricFinancialEntry = {
  type: EventFinancialEntryType;
  status: EventFinancialEntryStatus;
  expectedAmount: number | string | null;
  actualAmount: number | string | null;
  refundedAmount?: number | string | null;
  originType?: EventFinancialOriginType | null;
  category?: string | null;
};

export type EventMetricCostumeAssignment = {
  status: EventCostumeAssignmentStatus;
  billingMode?: EventCostumeAssignmentBillingMode | null;
  chargedValue?: number | string | null;
  isPaid?: boolean | null;
};

export type EventMetricCostume = {
  schoolCost: number | string | null;
  quantity: number;
};

export type EventMetricsInput = {
  ticketSales?: EventMetricTicketSale[];
  ticketLots?: EventMetricTicketLot[];
  financialEntries?: EventMetricFinancialEntry[];
  costumeAssignments?: EventMetricCostumeAssignment[];
  costumes?: EventMetricCostume[];
};

export type EventMetrics = {
  receitaPrevista: number;
  receitaRealizada: number;
  custoPrevisto: number;
  custoRealizado: number;
  resultadoPrevisto: number;
  resultadoRealizado: number;
  lucroBrutoPrevisto: number;
  lucroBrutoRealizado: number;
  lucroLiquidoPrevisto: number;
  lucroLiquidoRealizado: number;
  margemRealizada: number | null;
  ingressosVendidos: number;
  ingressosDisponiveis: number;
  cortesias: number;
  ticketMedio: number | null;
  receitaRecebidaBruta: number;
  receitaEstornada: number;
  receitaRecebidaLiquida: number;
  taxaOcupacao: number | null;
  figurinosPendentes: number;
  figurinosEntregues: number;
  figurinosDevolvidos: number;
};

function money(value: number | string | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isAutomaticEventFinance(entry: EventMetricFinancialEntry): boolean {
  return entry.originType === 'TICKET_SALE' || entry.originType === 'COSTUME_ASSIGNMENT' || entry.originType === 'COSTUME';
}

const PAID_CHARGE_STATUSES = new Set([
  'PAID',
  'PAGO',
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

const OVERDUE_CHARGE_STATUSES = new Set(['OVERDUE', 'ATRASADO', 'VENCIDO']);
const CANCELLED_CHARGE_STATUSES = new Set(['CANCELLED', 'CANCELED', 'CANCELADO', 'DELETED']);
const REFUNDED_CHARGE_STATUSES = new Set([
  'REFUNDED',
  'ESTORNADO',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'CHARGEBACK_DEPOSITED',
]);
const OPEN_CHARGE_STATUSES = new Set([
  'OPEN',
  'PENDING',
  'PENDENTE',
  'CREATED',
  'PENDING_SYNC',
  'AWAITING_RISK_ANALYSIS',
  'DUNNING_REQUESTED',
]);

function normalizeStatus(status: string | null | undefined): string {
  return (status ?? '').trim().toUpperCase();
}

function chargeValue(charge: EventChargeLike): number {
  return money(charge.paidValue ?? charge.value ?? charge.amount);
}

function isPastDue(charge: EventChargeLike, today: Date): boolean {
  if (!charge.dueDate) return false;
  const due = new Date(charge.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return dueDay < todayDay;
}

export function resolveEventParticipantPayment(input: {
  expectedAmount: number | string | null | undefined;
  charges?: EventChargeLike[];
  paidFallback?: boolean | null;
  cancelled?: boolean | null;
  refunded?: boolean | null;
  today?: Date;
}): EventParticipantPaymentResolution {
  const expectedAmount = roundMoney(money(input.expectedAmount));
  const today = input.today ?? new Date();
  const charges = input.charges ?? [];

  if (expectedAmount <= 0) {
    return {
      status: 'ISENTO',
      expectedAmount: 0,
      paidAmount: 0,
      refundedAmount: 0,
      netPaidAmount: 0,
      openAmount: 0,
      overdueAmount: 0,
      percentPaid: 100,
      isFullyPaid: true,
      hasOverdue: false,
    };
  }

  if (input.cancelled && charges.length === 0) {
    return {
      status: 'CANCELADO',
      expectedAmount,
      paidAmount: 0,
      refundedAmount: 0,
      netPaidAmount: 0,
      openAmount: 0,
      overdueAmount: 0,
      percentPaid: 0,
      isFullyPaid: false,
      hasOverdue: false,
    };
  }

  let paidAmount = input.paidFallback ? expectedAmount : 0;
  let refundedAmount = input.refunded ? paidAmount : 0;
  let openAmount = input.paidFallback ? 0 : expectedAmount;
  let overdueAmount = 0;
  let hasOverdue = false;
  let hasOpen = !input.paidFallback;
  let hasCancelled = false;
  let hasRefunded = Boolean(input.refunded);

  if (charges.length > 0) {
    paidAmount = 0;
    refundedAmount = 0;
    openAmount = 0;
    hasOpen = false;

    for (const charge of charges) {
      const status = normalizeStatus(charge.status);
      const value = chargeValue(charge);
      const refunded = money(charge.refundedValue);

      if (PAID_CHARGE_STATUSES.has(status)) {
        paidAmount += value;
      } else if (REFUNDED_CHARGE_STATUSES.has(status)) {
        paidAmount += value;
        refundedAmount += refunded > 0 ? refunded : value;
        hasRefunded = true;
      } else if (CANCELLED_CHARGE_STATUSES.has(status)) {
        hasCancelled = true;
      } else {
        hasOpen = OPEN_CHARGE_STATUSES.has(status) || status === '';
        openAmount += value;
        if (OVERDUE_CHARGE_STATUSES.has(status) || isPastDue(charge, today)) {
          hasOverdue = true;
          overdueAmount += value;
        }
      }
    }
  }

  const netPaidAmount = roundMoney(Math.max(paidAmount - refundedAmount, 0));
  const isFullyPaid = netPaidAmount >= expectedAmount;
  const percentPaid = expectedAmount > 0 ? Math.min(100, roundMoney((netPaidAmount / expectedAmount) * 100)) : 100;

  let status: EventParticipantFinancialStatus = 'PENDENTE';
  if (hasOverdue) status = 'ATRASADO';
  else if (isFullyPaid) status = 'QUITADO';
  else if (hasRefunded && netPaidAmount <= 0) status = 'ESTORNADO';
  else if (hasRefunded) status = 'ESTORNADO_PARCIAL';
  else if (netPaidAmount > 0 || hasOpen) status = 'EM_DIA';
  else if (hasCancelled || input.cancelled) status = 'CANCELADO';

  return {
    status,
    expectedAmount,
    paidAmount: roundMoney(paidAmount),
    refundedAmount: roundMoney(refundedAmount),
    netPaidAmount,
    openAmount: roundMoney(Math.max(openAmount, expectedAmount - netPaidAmount)),
    overdueAmount: roundMoney(overdueAmount),
    percentPaid,
    isFullyPaid,
    hasOverdue,
  };
}

export function calculateEventMetrics(input: EventMetricsInput): EventMetrics {
  const ticketSales = input.ticketSales ?? [];
  const ticketLots = input.ticketLots ?? [];
  const financialEntries = input.financialEntries ?? [];
  const costumeAssignments = input.costumeAssignments ?? [];
  const costumes = input.costumes ?? [];

  let receitaPrevista = 0;
  let receitaRealizada = 0;
  let receitaRecebidaBruta = 0;
  let receitaEstornada = 0;
  let custoPrevisto = 0;
  let custoRealizado = 0;
  let ingressosVendidos = 0;
  let ingressosPagos = 0;
  let cortesias = 0;

  let costumeCost = 0;
  for (const costume of costumes) {
    costumeCost += money(costume.schoolCost) * costume.quantity;
  }

  custoPrevisto += costumeCost;
  custoRealizado += costumeCost;

  for (const sale of ticketSales) {
    const total = money(sale.totalAmount);

    if (sale.status === 'PENDING') {
      receitaPrevista += total;
      ingressosVendidos += sale.quantity;
    }

    if (sale.status === 'PAID') {
      receitaPrevista += total;
      receitaRealizada += total;
      receitaRecebidaBruta += total;
      ingressosVendidos += sale.quantity;
      ingressosPagos += sale.quantity;
    }

    if (sale.status === 'COMPLIMENTARY') {
      cortesias += sale.quantity;
      ingressosVendidos += sale.quantity;
    }
  }

  for (const entry of financialEntries) {
    if (isAutomaticEventFinance(entry)) continue;

    const expected = money(entry.expectedAmount);
    const actual = money(entry.actualAmount);
    const refunded = money(entry.refundedAmount);

    if (entry.type === 'REVENUE') {
      if (entry.status === 'EXPECTED' || entry.status === 'PENDING' || entry.status === 'RECEIVED') {
        receitaPrevista += expected;
      }
      if (entry.status === 'RECEIVED' || entry.status === 'PENDING' || entry.status === 'PARTIALLY_REFUNDED') {
        if (entry.actualAmount != null) {
          receitaRecebidaBruta += actual;
          receitaEstornada += refunded;
          receitaRealizada += Math.max(actual - refunded, 0);
        }
      }
    }

    if (entry.type === 'COST') {
      if (entry.status === 'EXPECTED' || entry.status === 'PENDING' || entry.status === 'PAID') {
        custoPrevisto += expected;
      }
      if (entry.status === 'PAID') {
        custoRealizado += actual;
      }
    }
  }

  for (const assignment of costumeAssignments) {
    if (assignment.status === 'CANCELLED') continue;
    if (assignment.billingMode !== 'SEPARATE_CHARGE') continue;
    const value = money(assignment.chargedValue);
    if (value > 0) {
      receitaPrevista += value;
      if (assignment.isPaid) {
        receitaRealizada += value;
        receitaRecebidaBruta += value;
      }
    }
  }

  for (const lot of ticketLots) {
    const unsoldQty = Math.max(lot.quantityTotal - lot.quantitySold, 0);
    const lotPrice = lot.unitPrice ?? 0;
    receitaPrevista += unsoldQty * lotPrice;
  }

  const totalCapacity = ticketLots.reduce((sum, lot) => sum + lot.quantityTotal, 0);
  const lotSold = ticketLots.reduce((sum, lot) => sum + lot.quantitySold, 0);
  const ingressosDisponiveis = Math.max(totalCapacity - lotSold, 0);
  const resultadoPrevisto = receitaPrevista - custoPrevisto;
  const resultadoRealizado = receitaRealizada - custoRealizado;
  const lucroBrutoPrevisto = receitaPrevista - custoPrevisto;
  const lucroBrutoRealizado = receitaRealizada - custoRealizado;

  return {
    receitaPrevista: roundMoney(receitaPrevista),
    receitaRealizada: roundMoney(receitaRealizada),
    custoPrevisto: roundMoney(custoPrevisto),
    custoRealizado: roundMoney(custoRealizado),
    resultadoPrevisto: roundMoney(resultadoPrevisto),
    resultadoRealizado: roundMoney(resultadoRealizado),
    lucroBrutoPrevisto: roundMoney(lucroBrutoPrevisto),
    lucroBrutoRealizado: roundMoney(lucroBrutoRealizado),
    lucroLiquidoPrevisto: roundMoney(resultadoPrevisto),
    lucroLiquidoRealizado: roundMoney(resultadoRealizado),
    margemRealizada:
      receitaRealizada > 0 ? roundMoney(resultadoRealizado / receitaRealizada) : null,
    ingressosVendidos,
    ingressosDisponiveis,
    cortesias,
    ticketMedio: ingressosPagos > 0 ? roundMoney(receitaRecebidaBruta / ingressosPagos) : null,
    receitaRecebidaBruta: roundMoney(receitaRecebidaBruta),
    receitaEstornada: roundMoney(receitaEstornada),
    receitaRecebidaLiquida: roundMoney(receitaRealizada),
    taxaOcupacao: totalCapacity > 0 ? roundMoney(ingressosVendidos / totalCapacity) : null,
    figurinosPendentes: costumeAssignments.filter((item) =>
      ['PENDING', 'ORDERED', 'RECEIVED'].includes(item.status),
    ).length,
    figurinosEntregues: costumeAssignments.filter((item) => item.status === 'DELIVERED').length,
    figurinosDevolvidos: costumeAssignments.filter((item) => item.status === 'RETURNED').length,
  };
}

export * from './map/map-rules';
