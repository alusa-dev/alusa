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
export type EventFinancialEntryType = 'COST' | 'REVENUE';
export type EventFinancialEntryStatus = 'EXPECTED' | 'PENDING' | 'PAID' | 'RECEIVED' | 'CANCELLED' | 'REFUNDED';
export type EventFinancialOriginType = 'MANUAL' | 'TICKET_SALE' | 'COSTUME' | 'COSTUME_ASSIGNMENT';

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
  originType?: EventFinancialOriginType | null;
  category?: string | null;
};

export type EventMetricCostumeAssignment = {
  status: EventCostumeAssignmentStatus;
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

export function calculateEventMetrics(input: EventMetricsInput): EventMetrics {
  const ticketSales = input.ticketSales ?? [];
  const ticketLots = input.ticketLots ?? [];
  const financialEntries = input.financialEntries ?? [];
  const costumeAssignments = input.costumeAssignments ?? [];
  const costumes = input.costumes ?? [];

  let receitaPrevista = 0;
  let receitaRealizada = 0;
  let custoPrevisto = 0;
  let custoRealizado = 0;
  let custoDiretoPrevisto = 0;
  let custoDiretoRealizado = 0;
  let ingressosVendidos = 0;
  let ingressosPagos = 0;
  let cortesias = 0;

  let costumeCost = 0;
  for (const costume of costumes) {
    costumeCost += money(costume.schoolCost) * costume.quantity;
  }

  custoPrevisto += costumeCost;
  custoRealizado += costumeCost;
  custoDiretoPrevisto += costumeCost;
  custoDiretoRealizado += costumeCost;

  for (const sale of ticketSales) {
    const total = money(sale.totalAmount);

    if (sale.status === 'PENDING') {
      receitaPrevista += total;
      ingressosVendidos += sale.quantity;
    }

    if (sale.status === 'PAID') {
      receitaPrevista += total;
      receitaRealizada += total;
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
    const actual = money(entry.actualAmount ?? entry.expectedAmount);

    if (entry.type === 'REVENUE') {
      if (entry.status === 'EXPECTED' || entry.status === 'PENDING' || entry.status === 'RECEIVED') {
        receitaPrevista += expected;
      }
      if (entry.status === 'RECEIVED') receitaRealizada += actual;
    }

    if (entry.type === 'COST') {
      const isDirect = entry.originType === 'COSTUME' || entry.category === 'Figurino';

      if (entry.status === 'EXPECTED' || entry.status === 'PENDING' || entry.status === 'PAID') {
        custoPrevisto += expected;
        if (isDirect) {
          custoDiretoPrevisto += expected;
        }
      }
      if (entry.status === 'PAID') {
        custoRealizado += actual;
        if (isDirect) {
          custoDiretoRealizado += actual;
        }
      }
    }
  }

  for (const assignment of costumeAssignments) {
    if (assignment.status === 'CANCELLED') continue;
    const value = money(assignment.chargedValue);
    if (value > 0) {
      receitaPrevista += value;
      if (assignment.isPaid) {
        receitaRealizada += value;
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
  const lucroBrutoPrevisto = receitaPrevista - custoDiretoPrevisto;
  const lucroBrutoRealizado = receitaRealizada - custoDiretoRealizado;

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
    ticketMedio: ingressosPagos > 0 ? roundMoney(receitaRealizada / ingressosPagos) : null,
    taxaOcupacao: totalCapacity > 0 ? roundMoney(ingressosVendidos / totalCapacity) : null,
    figurinosPendentes: costumeAssignments.filter((item) =>
      ['PENDING', 'ORDERED', 'RECEIVED'].includes(item.status),
    ).length,
    figurinosEntregues: costumeAssignments.filter((item) => item.status === 'DELIVERED').length,
    figurinosDevolvidos: costumeAssignments.filter((item) => item.status === 'RETURNED').length,
  };
}

export * from './map/map-rules';
