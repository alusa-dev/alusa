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
export * from './financial';
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
  | 'PARCIAL'
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
  id?: string | null;
  type: EventFinancialEntryType;
  status: EventFinancialEntryStatus;
  expectedAmount: number | string | null;
  actualAmount: number | string | null;
  grossAmount?: number | string | null;
  discountAmount?: number | string | null;
  netAmount?: number | string | null;
  refundedAmount?: number | string | null;
  originType?: EventFinancialOriginType | null;
  originId?: string | null;
  costClass?: import('./financial').EventFinancialCostClass | null;
  category?: string | null;
};

export type EventMetricCostumeAssignment = {
  status: EventCostumeAssignmentStatus;
  billingMode?: EventCostumeAssignmentBillingMode | null;
  chargedValue?: number | string | null;
  isPaid?: boolean | null;
};

export type EventMetricCostume = {
  id?: string | null;
  schoolCost: number | string | null;
  quantity: number;
};

export type EventMetricParticipantObligation = {
  id: string;
  revenueEntryId?: string | null;
  grossAmount: number | string | null;
  discountAmount: number | string | null;
  expectedAmount: number | string | null;
  actualAmount?: number | string | null;
  refundedAmount?: number | string | null;
  isExempt?: boolean;
  cancelled?: boolean;
};

export type EventMetricConsistency = {
  isConsistent: boolean;
  issues: string[];
};

export type EventMetricsInput = {
  ticketSales?: EventMetricTicketSale[];
  ticketLots?: EventMetricTicketLot[];
  financialEntries?: EventMetricFinancialEntry[];
  costumeAssignments?: EventMetricCostumeAssignment[];
  costumes?: EventMetricCostume[];
  participantObligations?: EventMetricParticipantObligation[];
};

export type EventMetrics = {
  receitaPrevista: number;
  receitaBrutaPrevista: number;
  descontosPrevistos: number;
  receitaRealizada: number;
  custoPrevisto: number;
  custoRealizado: number;
  custoDiretoPrevisto: number;
  custoDiretoRealizado: number;
  custoIndiretoPrevisto: number;
  custoIndiretoRealizado: number;
  taxasFinanceirasPrevistas: number;
  taxasFinanceirasRealizadas: number;
  impostosPrevistos: number;
  impostosRealizados: number;
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
  consistency: EventMetricConsistency;
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
  return entry.type === 'REVENUE'
    && (entry.originType === 'TICKET_SALE' || entry.originType === 'COSTUME_ASSIGNMENT' || entry.originType === 'COSTUME');
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
  isExempt?: boolean | null;
  today?: Date;
}): EventParticipantPaymentResolution {
  const expectedAmount = roundMoney(money(input.expectedAmount));
  const today = input.today ?? new Date();
  const charges = input.charges ?? [];

  if (input.cancelled && charges.length === 0) {
    return {
      status: 'CANCELADO',
      expectedAmount,
      paidAmount: 0,
      refundedAmount: 0,
      netPaidAmount: 0,
      openAmount: expectedAmount,
      overdueAmount: 0,
      percentPaid: 0,
      isFullyPaid: false,
      hasOverdue: false,
    };
  }

  if (expectedAmount <= 0 && input.isExempt) {
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

  if (expectedAmount <= 0) {
    return {
      status: 'PARCIAL',
      expectedAmount: 0,
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
  let hasCancelled = false;
  let hasRefunded = Boolean(input.refunded);

  if (charges.length > 0) {
    paidAmount = 0;
    refundedAmount = 0;
    openAmount = 0;

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
  else if (netPaidAmount > 0) status = 'EM_DIA';
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
  const participantObligations = input.participantObligations ?? [];

  let receitaPrevista = 0;
  let receitaBrutaPrevista = 0;
  let descontosPrevistos = 0;
  let receitaRealizada = 0;
  let receitaRecebidaBruta = 0;
  let receitaEstornada = 0;
  let custoPrevisto = 0;
  let custoRealizado = 0;
  let custoDiretoPrevisto = 0;
  let custoDiretoRealizado = 0;
  let custoIndiretoPrevisto = 0;
  let custoIndiretoRealizado = 0;
  let taxasFinanceirasPrevistas = 0;
  let taxasFinanceirasRealizadas = 0;
  let impostosPrevistos = 0;
  let impostosRealizados = 0;
  let ingressosVendidos = 0;
  let ingressosPagos = 0;
  let cortesias = 0;
  const consistencyIssues: string[] = [];

  let costumeCost = 0;
  const costumeCostRealizedById = new Map<string, number>();
  for (const entry of financialEntries) {
    if (entry.type !== 'COST' || entry.originType !== 'COSTUME' || !entry.originId) continue;
    if (entry.status === 'PAID') {
      costumeCostRealizedById.set(entry.originId, money(entry.actualAmount));
    }
  }

  const financialEntryIds = new Set(financialEntries.map((entry) => entry.id).filter(Boolean));
  const linkedParticipantEntryIds = new Set(
    participantObligations
      .map((obligation) => obligation.revenueEntryId)
      .filter((id): id is string => Boolean(id)),
  );
  const unresolvedUnlinkedRevenueEntries = financialEntries.filter((entry) =>
    entry.type === 'REVENUE'
    && !isAutomaticEventFinance(entry)
    && (entry.id
      ? !linkedParticipantEntryIds.has(entry.id)
      : participantObligations.length > 0),
  );
  const legacyFallbackBlocked = unresolvedUnlinkedRevenueEntries.length > 0;

  // Older digital registrations may have a provider charge and no local
  // EventFinancialEntry. Include those obligations only while there is no
  // unlinked manual revenue in the event. Once an unlinked entry exists, its
  // owner cannot be inferred safely from amount alone; counting both sources
  // would overstate the forecast. The consistency report then becomes the
  // explicit reconciliation queue.
  if (legacyFallbackBlocked) {
    for (const entry of unresolvedUnlinkedRevenueEntries) {
      consistencyIssues.push(`REVENUE:${entry.id ?? 'unknown'}:unlinked_manual_entry`);
    }
  }

  for (const obligation of participantObligations) {
    if (obligation.cancelled || obligation.isExempt || (obligation.revenueEntryId && financialEntryIds.has(obligation.revenueEntryId))) continue;
    if (legacyFallbackBlocked) {
      consistencyIssues.push(`PARTICIPANT:${obligation.id}:missing_financial_entry`);
      continue;
    }
    const expected = money(obligation.expectedAmount);
    const gross = money(obligation.grossAmount ?? expected);
    const discount = money(obligation.discountAmount ?? Math.max(gross - expected, 0));
    const actual = money(obligation.actualAmount);
    const refunded = money(obligation.refundedAmount);
    receitaPrevista += expected;
    receitaBrutaPrevista += gross;
    descontosPrevistos += discount;
    if (actual > 0) {
      receitaRecebidaBruta += actual;
      receitaEstornada += refunded;
      receitaRealizada += Math.max(actual - refunded, 0);
    }
    if (Math.abs(gross - discount - expected) > 0.01) {
      consistencyIssues.push(`PARTICIPANT:${obligation.id}:gross_discount_mismatch`);
    }
  }
  let costumeCostRealized = 0;
  for (const costume of costumes) {
    const amount = money(costume.schoolCost) * costume.quantity;
    costumeCost += amount;
    // Legacy costumes without a linked cost entry remain recognized for
    // backwards compatibility. Linked entries use their persisted payment
    // status, so a pending purchase is not reported as paid.
    costumeCostRealized += costume.id && financialEntries.some((entry) => entry.originType === 'COSTUME' && entry.originId === costume.id)
      ? costumeCostRealizedById.get(costume.id) ?? 0
      : amount;
  }

  custoPrevisto += costumeCost;
  custoRealizado += costumeCostRealized;
  custoDiretoPrevisto += costumeCost;
  custoDiretoRealizado += costumeCostRealized;

  for (const sale of ticketSales) {
    const total = money(sale.totalAmount);

    if (sale.status === 'PENDING') {
      receitaPrevista += total;
      receitaBrutaPrevista += total;
      ingressosVendidos += sale.quantity;
    }

    if (sale.status === 'PAID') {
      receitaPrevista += total;
      receitaBrutaPrevista += total;
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
    if (
      entry.type === 'COST'
      && entry.originType === 'COSTUME'
      && entry.originId
      && costumes.some((costume) => costume.id === entry.originId)
    ) continue;

    const expected = money(entry.expectedAmount);
    const actual = money(entry.actualAmount);
    const refunded = money(entry.refundedAmount);

    if (entry.type === 'REVENUE') {
      const gross = money(entry.grossAmount ?? expected);
      const discount = money(entry.discountAmount ?? Math.max(gross - expected, 0));
      if (Math.abs(gross - discount - expected) > 0.01) {
        consistencyIssues.push(`REVENUE:${entry.originId ?? 'unknown'}:gross_discount_mismatch`);
      }
      if (actual > expected && entry.status !== 'REFUNDED') {
        consistencyIssues.push(`REVENUE:${entry.originId ?? 'unknown'}:actual_above_expected`);
      }
      if (refunded > actual) {
        consistencyIssues.push(`REVENUE:${entry.originId ?? 'unknown'}:refund_above_actual`);
      }
      receitaBrutaPrevista += gross;
      descontosPrevistos += discount;
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
      const costClass = entry.costClass ?? 'DIRECT';
      if (entry.status === 'EXPECTED' || entry.status === 'PENDING' || entry.status === 'PAID') {
        custoPrevisto += expected;
        if (costClass === 'DIRECT') custoDiretoPrevisto += expected;
        if (costClass === 'INDIRECT') custoIndiretoPrevisto += expected;
        if (costClass === 'FINANCIAL') taxasFinanceirasPrevistas += expected;
        if (costClass === 'TAX') impostosPrevistos += expected;
      }
      if (entry.status === 'PAID') {
        custoRealizado += actual;
        if (costClass === 'DIRECT') custoDiretoRealizado += actual;
        if (costClass === 'INDIRECT') custoIndiretoRealizado += actual;
        if (costClass === 'FINANCIAL') taxasFinanceirasRealizadas += actual;
        if (costClass === 'TAX') impostosRealizados += actual;
      }
      if (actual < 0) consistencyIssues.push(`COST:${entry.originId ?? 'unknown'}:negative_actual`);
    }
  }

  for (const assignment of costumeAssignments) {
    if (assignment.status === 'CANCELLED') continue;
    if (assignment.billingMode !== 'SEPARATE_CHARGE') continue;
    const value = money(assignment.chargedValue);
    if (value > 0) {
      receitaPrevista += value;
      receitaBrutaPrevista += value;
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
    receitaBrutaPrevista += unsoldQty * lotPrice;
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
    receitaBrutaPrevista: roundMoney(receitaBrutaPrevista),
    descontosPrevistos: roundMoney(descontosPrevistos),
    receitaRealizada: roundMoney(receitaRealizada),
    custoPrevisto: roundMoney(custoPrevisto),
    custoRealizado: roundMoney(custoRealizado),
    custoDiretoPrevisto: roundMoney(custoDiretoPrevisto),
    custoDiretoRealizado: roundMoney(custoDiretoRealizado),
    custoIndiretoPrevisto: roundMoney(custoIndiretoPrevisto),
    custoIndiretoRealizado: roundMoney(custoIndiretoRealizado),
    taxasFinanceirasPrevistas: roundMoney(taxasFinanceirasPrevistas),
    taxasFinanceirasRealizadas: roundMoney(taxasFinanceirasRealizadas),
    impostosPrevistos: roundMoney(impostosPrevistos),
    impostosRealizados: roundMoney(impostosRealizados),
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
    consistency: {
      isConsistent: consistencyIssues.length === 0,
      issues: consistencyIssues,
    },
    taxaOcupacao: totalCapacity > 0 ? roundMoney(ingressosVendidos / totalCapacity) : null,
    figurinosPendentes: costumeAssignments.filter((item) =>
      ['PENDING', 'ORDERED', 'RECEIVED'].includes(item.status),
    ).length,
    figurinosEntregues: costumeAssignments.filter((item) => item.status === 'DELIVERED').length,
    figurinosDevolvidos: costumeAssignments.filter((item) => item.status === 'RETURNED').length,
  };
}

export * from './map/map-rules';
export * from './map/ticket-sale-access';
