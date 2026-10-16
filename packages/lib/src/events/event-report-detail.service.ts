import { Prisma } from '@prisma/client';
import {
  getEventNetRealizedAmount,
  isUnlinkedEventParticipantFeeEntry,
  isEventCostExpectedStatus,
  isEventCostRealizedStatus,
  isEventRevenueExpectedStatus,
  isEventRevenueRealizedStatus,
} from '@alusa/domain/events';
import { EVENT_COSTUME_CATEGORY_LABELS, getAcademicDateKey, getCurrentAcademicDateKey } from '@alusa/shared';

import { prisma } from '../prisma';
import { buildParticipantPaymentSnapshots } from './events.service';

type ReportDb = Prisma.TransactionClient | typeof prisma;

export type EventReportDetail = {
  event: { id: string; name: string; startsAt: string; locationName: string | null; estimatedCapacity: number | null; status: 'DRAFT' | 'PLANNING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED' | 'ARCHIVED' };
  totals: {
    activeStudentParticipants: number; paidStudentParticipants: number; pendingStudentParticipants: number;
    overdueStudentParticipants: number; exemptStudentParticipants: number; closedStudentParticipants: number;
    participants: number; cancelledParticipants: number; registrationGross: number; registrationDiscount: number;
    registrationCommitted: number; registrationReceived: number; registrationRefunded: number;
    ticketPaidQuantity: number; ticketPendingQuantity: number; ticketComplimentaryQuantity: number;
    ticketReceivedGross: number; ticketRefunded: number; ticketReceivedNet: number; ticketPendingRevenue: number;
    ticketManualSales: number; ticketOnlineSales: number; availableTicketQuantity: number; availableTicketPotential: number;
    checkIns: number; committedRevenue: number; receivedRevenue: number; refundedRevenueExcludingTickets: number; resultRealized: number; resultCommitted: number; pendingCommittedRevenue: number;
    costsExpected: number; costsRealized: number; otherRevenueExpected: number; otherRevenueReceived: number; otherRevenueRefunded: number;
  };
  payments: Array<{ method: string; netReceived: number }>;
  timeline: Array<{ day: string; amount: number }>;
  salesByOrigin: Array<{ source: 'MANUAL' | 'PUBLIC_MAP'; quantity: number; share: number }>;
  salesBySessionSector: Array<{ id: string; mapName: string | null; mapStartsAt: string | null; sectorName: string; quantity: number; share: number }>;
  lots: Array<{ id: string; name: string; mapId: string | null; mapName: string | null; mapStartsAt: string | null; sold: number; total: number; available: number; unitPrice: number }>;
  categories: Array<{ category: string; type: string; expected: number; realized: number }>;
};

const number = (value: unknown) => {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function getEventReportDetail(
  contaId: string,
  eventId: string,
  db: ReportDb = prisma,
  now: Date = new Date(),
): Promise<EventReportDetail | null> {
  const event = await db.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    select: {
      id: true, name: true, startsAt: true, locationName: true, estimatedCapacity: true, status: true,
      conta: { select: { timezone: true } },
    },
  });
  if (!event) return null;

  const where = { contaId, eventId };
  const [participants, activeParticipants, participantDetails, sales, entries, payments, lots, checkIns, costumes, costumeAssignments, costumeEntries] = await Promise.all([
    db.eventParticipant.count({ where }),
    db.eventParticipant.aggregate({
      where: { ...where, cancelledAt: null },
      _sum: { registrationFeeOriginal: true, registrationFeeDiscount: true, registrationFeeCharged: true, feePaidAmount: true, feeRefundedAmount: true },
      _count: { _all: true },
    }),
    db.eventParticipant.findMany({
      where: { ...where, cancelledAt: null },
      select: {
        id: true, type: true, registrationFeeCharged: true, feePaidAmount: true, isFeePaid: true,
        isFeeExempt: true, financialStatusSnapshot: true, revenueEntryId: true,
        asaasPaymentId: true, asaasInstallmentId: true, billingGroupId: true, balanceAmount: true,
        registrationFeeOriginal: true, registrationFeeDiscount: true, feeRefundedAmount: true, cancelledAt: true,
      },
    }),
    db.eventTicketSale.findMany({
      where,
      select: {
        id: true, lotId: true, status: true, quantity: true, totalAmount: true, refundedAmount: true,
        paymentMethod: true, paidAt: true, paymentProvider: true, eventMapOrderId: true,
        saleSeats: { where: { contaId }, select: { sectionName: true } },
      },
    }),
    db.eventFinancialEntry.groupBy({
      by: ['type', 'status', 'category', 'originType', 'originId'], where,
      _sum: { expectedAmount: true, actualAmount: true, refundedAmount: true, netAmount: true },
    }),
    db.eventFinancialPayment.groupBy({ by: ['paymentMethod', 'status'], where: { ...where, financialEntry: { type: 'REVENUE', originType: { not: 'TICKET_SALE' } } }, _sum: { netAmount: true, amount: true, refundedAmount: true } }),
    db.eventTicketLot.findMany({
      where,
      select: { id: true, name: true, eventMapId: true, status: true, unitPrice: true, quantityTotal: true, quantitySold: true },
    }),
    db.eventTicket.count({ where: { ...where, usedAt: { not: null }, cancelledAt: null } }),
    db.eventCostume.findMany({ where, select: { id: true, category: true, schoolCost: true, quantity: true } }),
    db.eventCostumeAssignment.findMany({ where, select: { revenueEntryId: true, status: true, billingMode: true, chargedValue: true, isPaid: true } }),
    db.eventFinancialEntry.findMany({
      where: { ...where, originType: 'COSTUME' },
      select: { id: true, type: true, status: true, originType: true, originId: true, category: true, expectedAmount: true, actualAmount: true, refundedAmount: true },
    }),
  ]);

  const studentParticipantsOnly = participantDetails.filter((participant) => participant.type === 'STUDENT');
  const studentEntryIds = participantDetails.map((participant) => participant.revenueEntryId).filter((id): id is string => Boolean(id));
  const studentEntries = studentEntryIds.length
    ? await db.eventFinancialEntry.findMany({
      where: { contaId, eventId, id: { in: studentEntryIds } },
      select: {
        id: true, dueDate: true, status: true, netAmount: true, actualAmount: true,
        refundedAmount: true, asaasPaymentId: true, realizedAt: true, type: true,
        originType: true, category: true, originId: true, expectedAmount: true,
      },
    })
    : [];

  // Legacy registration entries are still stored as MANUAL revenue. Only active
  // participant links are adjusted because their obligations are represented in
  // these report totals; originId is not guaranteed to contain the entry id.
  const linkedLegacyEntries = studentEntries.filter((entry) => entry.type === 'REVENUE' && entry.originType === 'MANUAL');
  const linkedLegacyByGroup = new Map<string, typeof linkedLegacyEntries>();
  for (const entry of linkedLegacyEntries) {
    const key = JSON.stringify([entry.type, entry.status, entry.category, entry.originType, entry.originId]);
    const group = linkedLegacyByGroup.get(key) ?? [];
    group.push(entry);
    linkedLegacyByGroup.set(key, group);
  }
  const subtractLinkedAmount = (grouped: Prisma.Decimal | null, linked: typeof linkedLegacyEntries[number][], field: 'expectedAmount' | 'actualAmount' | 'refundedAmount' | 'netAmount') => {
    if (grouped == null) return null;
    const linkedTotal = linked.reduce((sum, entry) => sum.add(new Prisma.Decimal(entry[field] ?? 0)), new Prisma.Decimal(0));
    return new Prisma.Decimal(grouped).sub(linkedTotal);
  };
  const adjustedEntries = entries.map((entry) => {
    const key = JSON.stringify([entry.type, entry.status, entry.category, entry.originType, entry.originId]);
    const linked = linkedLegacyByGroup.get(key);
    if (!linked?.length) return entry;
    return {
      ...entry,
      _sum: {
        expectedAmount: subtractLinkedAmount(entry._sum.expectedAmount, linked, 'expectedAmount'),
        actualAmount: subtractLinkedAmount(entry._sum.actualAmount, linked, 'actualAmount'),
        refundedAmount: subtractLinkedAmount(entry._sum.refundedAmount, linked, 'refundedAmount'),
        netAmount: subtractLinkedAmount(entry._sum.netAmount, linked, 'netAmount'),
      },
    };
  }).filter((entry) => {
    const key = JSON.stringify([entry.type, entry.status, entry.category, entry.originType, entry.originId]);
    if (!linkedLegacyByGroup.has(key)) return true;
    return [entry._sum.expectedAmount, entry._sum.actualAmount, entry._sum.refundedAmount, entry._sum.netAmount]
      .some((amount) => amount != null && !amount.isZero());
  });
  const assignmentEntryIds = [...new Set(costumeAssignments.map((assignment) => assignment.revenueEntryId).filter((id): id is string => Boolean(id)))];
  const assignmentEntries = assignmentEntryIds.length
    ? await db.eventFinancialEntry.findMany({
      where: { contaId, eventId, id: { in: assignmentEntryIds } },
      select: { id: true, actualAmount: true, refundedAmount: true },
    })
    : [];
  const studentEntryById = new Map(studentEntries.map((entry) => [entry.id, entry]));
  const participantSnapshots = await buildParticipantPaymentSnapshots(
    { contaId },
    [{
      participants: studentParticipantsOnly,
      financialEntries: studentEntries,
    }],
    db,
  );
  const todayDateKey = getCurrentAcademicDateKey(now, event.conta.timezone);
  const participantPaymentStatus = (participant: (typeof participantDetails)[number]) => {
    const entry = studentEntryById.get(participant.revenueEntryId ?? '');
    const expected = number(participant.registrationFeeCharged);
    const exempt = participant.isFeeExempt || expected <= 0;
    const dueDateKey = entry?.dueDate ? getAcademicDateKey(entry.dueDate) : null;
    const snapshot = participantSnapshots.get(participant.revenueEntryId ?? participant.id);
    const closed = !exempt && (['CANCELADO', 'ESTORNADO'].includes(participant.financialStatusSnapshot ?? '')
      || ['CANCELLED', 'CANCELED', 'REFUNDED'].includes(entry?.status ?? '')
      || snapshot?.entryStatus === 'CANCELLED'
      || snapshot?.entryStatus === 'REFUNDED');
    const netPaid = snapshot?.netPaid ?? (entry
      ? entry.netAmount == null
        ? getEventNetRealizedAmount(number(entry.actualAmount), number(entry.refundedAmount))
        : Math.max(number(entry.netAmount), 0)
      : participant.isFeePaid
        ? expected
        : Math.max(number(participant.feePaidAmount), 0));
    const remaining = Math.max(expected - netPaid, 0);
    const paid = !closed && !exempt && remaining <= 0;
    const overdue = !closed && !paid && !exempt && remaining > 0 && (
      participant.financialStatusSnapshot === 'ATRASADO'
      || Boolean(dueDateKey && dueDateKey < todayDateKey)
    );
    return { paid, exempt, closed, overdue, netPaid };
  };
  const participantPaymentStatuses = participantDetails.map((participant) => ({ participant, ...participantPaymentStatus(participant) }));
  const studentPaymentStatuses = participantPaymentStatuses.filter(({ participant }) => participant.type === 'STUDENT');

  const eventMaps = lots.length ? await db.eventMap.findMany({ where: { ...where, id: { in: lots.map((lot) => lot.eventMapId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true, startsAt: true } }) : [];
  const mapById = new Map(eventMaps.map((map) => [map.id, map]));
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const saleTotalsByStatus = new Map<string, {
    quantity: number;
    totalAmount: Prisma.Decimal;
    refundedAmount: Prisma.Decimal;
  }>();
  for (const sale of sales) {
    const totals = saleTotalsByStatus.get(sale.status) ?? {
      quantity: 0,
      totalAmount: new Prisma.Decimal(0),
      refundedAmount: new Prisma.Decimal(0),
    };
    totals.quantity += sale.quantity;
    totals.totalAmount = totals.totalAmount.add(sale.totalAmount);
    totals.refundedAmount = totals.refundedAmount.add(sale.refundedAmount);
    saleTotalsByStatus.set(sale.status, totals);
  }
  const saleStatusSum = (status: string, key: 'quantity' | 'totalAmount' | 'refundedAmount') => {
    const totals = saleTotalsByStatus.get(status);
    if (!totals) return 0;
    return key === 'quantity' ? totals.quantity : number(totals[key]);
  };
  const paidSales = sales.filter((sale) => sale.status === 'PAID');
  const publicOrderIds = [...new Set(paidSales.map((sale) => sale.eventMapOrderId).filter((id): id is string => Boolean(id)))];
  const publicOrderItems = publicOrderIds.length
    ? await db.eventMapOrderItem.findMany({
      where: { contaId, orderId: { in: publicOrderIds } },
      select: { orderId: true, lotId: true, sectionName: true },
    })
    : [];
  const publicSectionsByOrderAndLot = new Map<string, string[]>();
  for (const item of publicOrderItems) {
    const key = `${item.orderId}:${item.lotId ?? ''}`;
    const sections = publicSectionsByOrderAndLot.get(key) ?? [];
    sections.push(item.sectionName);
    publicSectionsByOrderAndLot.set(key, sections);
  }
  const grossCollectedSales = sales.filter((sale) => sale.status === 'PAID' || sale.status === 'REFUNDED');
  const refundedTicketAmount = sales.reduce((sum, sale) => sum + Math.max(number(sale.refundedAmount), sale.status === 'REFUNDED' ? number(sale.totalAmount) : 0), 0);
  const ticketReceivedGross = grossCollectedSales.reduce((sum, sale) => sum + number(sale.totalAmount), 0);
  const ticketReceivedNet = getEventNetRealizedAmount(ticketReceivedGross, refundedTicketAmount);
  const paymentTotals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.status !== 'RECEIVED' && payment.status !== 'PAID') continue;
    const value = Math.max(number(payment._sum.netAmount), 0);
    paymentTotals.set(payment.paymentMethod, (paymentTotals.get(payment.paymentMethod) ?? 0) + value);
  }
  for (const sale of paidSales) {
    const key = sale.paymentMethod;
    paymentTotals.set(key, (paymentTotals.get(key) ?? 0) + getEventNetRealizedAmount(number(sale.totalAmount), number(sale.refundedAmount)));
  }

  const timelineByDay = new Map<string, number>();
  for (const sale of paidSales) {
    if (!sale.paidAt) continue;
    const isAsaasDateOnly = sale.paymentProvider === 'ASAAS'
      && sale.paidAt.getUTCHours() === 0
      && sale.paidAt.getUTCMinutes() === 0
      && sale.paidAt.getUTCSeconds() === 0
      && sale.paidAt.getUTCMilliseconds() === 0;
    const day = isAsaasDateOnly
      ? getAcademicDateKey(sale.paidAt) ?? getCurrentAcademicDateKey(sale.paidAt, event.conta.timezone)
      : getCurrentAcademicDateKey(sale.paidAt, event.conta.timezone);
    timelineByDay.set(day, (timelineByDay.get(day) ?? 0) + getEventNetRealizedAmount(number(sale.totalAmount), number(sale.refundedAmount)));
  }

  const totalPaidTicketQuantity = paidSales.reduce((sum, sale) => sum + sale.quantity, 0);
  const originQuantities = new Map<'MANUAL' | 'PUBLIC_MAP', number>([['MANUAL', 0], ['PUBLIC_MAP', 0]]);
  const sectorQuantities = new Map<string, { mapName: string | null; mapStartsAt: string | null; sectorName: string; quantity: number }>();
  const addSectorQuantity = (sale: (typeof paidSales)[number], sectorName: string, quantity: number) => {
    const lot = lotById.get(sale.lotId ?? '');
    const mapId = lot?.eventMapId ?? null;
    const map = mapById.get(mapId ?? '');
    const normalizedSector = sectorName.trim() || 'Setor não identificado';
    const key = `${mapId ?? 'sem-sessao'}:${normalizedSector.toLocaleLowerCase('pt-BR')}`;
    const current = sectorQuantities.get(key) ?? {
      mapName: map?.name ?? null,
      mapStartsAt: map?.startsAt?.toISOString() ?? null,
      sectorName: normalizedSector,
      quantity: 0,
    };
    current.quantity += quantity;
    sectorQuantities.set(key, current);
  };
  for (const sale of paidSales) {
    const source = sale.eventMapOrderId ? 'PUBLIC_MAP' : 'MANUAL';
    originQuantities.set(source, (originQuantities.get(source) ?? 0) + sale.quantity);

    const manualSections = sale.saleSeats?.map((seat) => seat.sectionName) ?? [];
    const publicSections = sale.eventMapOrderId
      ? publicSectionsByOrderAndLot.get(`${sale.eventMapOrderId}:${sale.lotId}`) ?? []
      : [];
    const sections = manualSections.length ? manualSections : publicSections;
    const attributedSections = sections.slice(0, sale.quantity);
    for (const sectionName of attributedSections) addSectorQuantity(sale, sectionName, 1);
    const remainingQuantity = Math.max(sale.quantity - attributedSections.length, 0);
    if (remainingQuantity > 0) {
      addSectorQuantity(sale, `Sem setor · ${lotById.get(sale.lotId ?? '')?.name ?? 'lote sem nome'}`, remainingQuantity);
    }
  }
  const salesByOrigin = (['MANUAL', 'PUBLIC_MAP'] as const).map((source) => {
    const quantity = originQuantities.get(source) ?? 0;
    return { source, quantity, share: totalPaidTicketQuantity > 0 ? quantity / totalPaidTicketQuantity : 0 };
  });
  const salesBySessionSector = [...sectorQuantities.entries()]
    .map(([id, value]) => ({ id, ...value, share: totalPaidTicketQuantity > 0 ? value.quantity / totalPaidTicketQuantity : 0 }))
    .sort((a, b) => b.quantity - a.quantity || a.sectorName.localeCompare(b.sectorName, 'pt-BR'));

  const hasParticipantObligations = activeParticipants._count._all > 0;
  const relevantEntryGroups = adjustedEntries.filter((entry) =>
    !['TICKET_SALE', 'EVENT_REGISTRATION'].includes(entry.originType)
    && !(hasParticipantObligations && isUnlinkedEventParticipantFeeEntry({
      type: entry.type,
      originType: entry.originType,
      originId: entry.originId,
      category: entry.category,
    })),
  );
  // Keep the report's prior status/category grouping after filtering by originId.
  const relevantEntryGroupsByCategory = new Map<string, (typeof relevantEntryGroups)[number]>();
  for (const entry of relevantEntryGroups) {
    const key = JSON.stringify([entry.type, entry.status, entry.category, entry.originType]);
    const current = relevantEntryGroupsByCategory.get(key);
    if (!current) {
      relevantEntryGroupsByCategory.set(key, entry);
      continue;
    }
    for (const field of ['expectedAmount', 'actualAmount', 'refundedAmount', 'netAmount'] as const) {
      if (current._sum[field] == null && entry._sum[field] == null) continue;
      current._sum[field] = new Prisma.Decimal(number(current._sum[field]) + number(entry._sum[field]));
    }
  }
  const relevantEntries = [...relevantEntryGroupsByCategory.values()];
  const otherRevenueEntries = relevantEntries.filter((entry) => entry.type === 'REVENUE' && entry.originType !== 'COSTUME_ASSIGNMENT');
  const expectedRevenueEntries = otherRevenueEntries.filter((entry) => !['CANCELLED', 'REFUNDED'].includes(entry.status));
  const costEntries = relevantEntries.filter((entry) => entry.type === 'COST' && entry.originType !== 'COSTUME');
  const realizedRevenueFor = (entry: (typeof entries)[number]) => isEventRevenueRealizedStatus(entry.status)
    && entry._sum.actualAmount != null
    ? getEventNetRealizedAmount(number(entry._sum.actualAmount), number(entry._sum.refundedAmount))
    : 0;
  const realizedCostFor = (entry: (typeof entries)[number]) => isEventCostRealizedStatus(entry.status)
    ? getEventNetRealizedAmount(number(entry._sum.actualAmount), number(entry._sum.refundedAmount))
    : 0;
  const expectedRevenueFor = (entry: (typeof entries)[number]) => isEventRevenueExpectedStatus(entry.status)
    ? number(entry._sum.expectedAmount)
    : 0;
  const costumeIds = new Set(costumes.map((costume) => costume.id));
  const costumeEntriesByOrigin = new Map<string, typeof costumeEntries>();
  for (const entry of costumeEntries) {
    if (!entry.originId || !costumeIds.has(entry.originId)) continue;
    const linked = costumeEntriesByOrigin.get(entry.originId) ?? [];
    linked.push(entry);
    costumeEntriesByOrigin.set(entry.originId, linked);
  }
  const costumeCategoryTotals = new Map<string, { expected: number; realized: number }>();
  let costumeCostExpected = 0;
  let costumeCostRealized = 0;
  for (const costume of costumes) {
    const expected = number(costume.schoolCost) * costume.quantity;
    const linkedEntries = costumeEntriesByOrigin.get(costume.id) ?? [];
    const realized = linkedEntries.length
      ? linkedEntries.reduce((sum, entry) => sum + (entry.type === 'COST' && isEventCostRealizedStatus(entry.status)
        ? getEventNetRealizedAmount(number(entry.actualAmount), number(entry.refundedAmount))
        : 0), 0)
      : expected;
    costumeCostExpected += expected;
    costumeCostRealized += realized;
    const category = EVENT_COSTUME_CATEGORY_LABELS[costume.category];
    const totals = costumeCategoryTotals.get(category) ?? { expected: 0, realized: 0 };
    totals.expected += expected;
    totals.realized += realized;
    costumeCategoryTotals.set(category, totals);
  }
  const assignmentEntryById = new Map(assignmentEntries.map((entry) => [entry.id, entry]));
  const legacyAssignmentRevenue = costumeAssignments.reduce((amounts, assignment) => {
    if (assignment.status === 'CANCELLED' || assignment.billingMode !== 'SEPARATE_CHARGE') return amounts;
    const value = number(assignment.chargedValue);
    if (value <= 0) return amounts;
    amounts.expected += value;
    const entry = assignment.revenueEntryId ? assignmentEntryById.get(assignment.revenueEntryId) : undefined;
    if (entry) {
      const actual = number(entry.actualAmount);
      const refunded = number(entry.refundedAmount);
      if (actual > 0) {
        amounts.received += getEventNetRealizedAmount(actual, refunded);
        amounts.refunded += refunded;
      }
    } else if (assignment.isPaid) {
      amounts.received += value;
    }
    return amounts;
  }, { expected: 0, received: 0, refunded: 0 });
  const detachedCostumeEntries = costumeEntries.filter((entry) => entry.type === 'COST' && entry.originId && !costumeIds.has(entry.originId));
  const detachedCostumeEntriesByCategory = new Map<string, { expected: number; realized: number }>();
  for (const entry of detachedCostumeEntries) {
    const totals = detachedCostumeEntriesByCategory.get(entry.category) ?? { expected: 0, realized: 0 };
    if (isEventCostExpectedStatus(entry.status)) totals.expected += number(entry.expectedAmount);
    if (isEventCostRealizedStatus(entry.status)) totals.realized += getEventNetRealizedAmount(number(entry.actualAmount), number(entry.refundedAmount));
    detachedCostumeEntriesByCategory.set(entry.category, totals);
  }
  const legacyAssignmentCategory = {
    expected: legacyAssignmentRevenue.expected,
    realized: legacyAssignmentRevenue.received,
  };
  const expectedOtherRevenue = expectedRevenueEntries.reduce((sum, entry) => sum + expectedRevenueFor(entry), 0)
    + legacyAssignmentRevenue.expected;
  const receivedOtherRevenue = expectedRevenueEntries.reduce((sum, entry) => sum + realizedRevenueFor(entry), 0)
    + legacyAssignmentRevenue.received;
  const refundedOtherRevenue = otherRevenueEntries.reduce((sum, entry) => sum + number(entry._sum.refundedAmount), 0) + legacyAssignmentRevenue.refunded;
  const ticketLots = lots.map((lot) => ({
    id: lot.id, name: lot.name, mapId: lot.eventMapId, mapName: mapById.get(lot.eventMapId ?? '')?.name ?? null,
    mapStartsAt: mapById.get(lot.eventMapId ?? '')?.startsAt?.toISOString() ?? null,
    sold: lot.quantitySold, total: lot.quantityTotal,
    available: lot.status === 'ACTIVE' ? Math.max(lot.quantityTotal - lot.quantitySold, 0) : 0,
    unitPrice: number(lot.unitPrice),
  }));
  const ticketPendingGross = saleStatusSum('PENDING', 'totalAmount');
  const ticketPaidGross = paidSales.reduce((sum, sale) => sum + number(sale.totalAmount), 0);
  const participantExpected = participantPaymentStatuses.reduce((sum, item) =>
    sum + (!item.closed && !item.exempt ? number(item.participant.registrationFeeCharged) : 0), 0);
  const participantGross = number(activeParticipants._sum.registrationFeeOriginal);
  const participantDiscount = number(activeParticipants._sum.registrationFeeDiscount);
  // feePaidAmount is persisted net of refunds for event registration payments.
  const participantReceivedNet = participantPaymentStatuses.reduce((sum, item) =>
    sum + (!item.closed ? item.netPaid : 0), 0);
  const participantRefunds = number(activeParticipants._sum.feeRefundedAmount);
  // Commitment tracks the gross price of still-paid tickets and pending orders.
  // Refunds reduce cash received, not the original paid-ticket commitment.
  const ticketCommitted = ticketPaidGross + ticketPendingGross;
  const committedRevenue = participantExpected + ticketCommitted + expectedOtherRevenue;
  const receivedRevenue = Math.max(participantReceivedNet, 0) + ticketReceivedNet + receivedOtherRevenue;
  // This is the remaining committed balance, not an overdue metric. A partial
  // refund reduces net receipts while the obligation remains expected; only
  // cancelled or fully refunded entries are excluded from expectedRevenueEntries.
  const pendingCommittedRevenue = Math.max(committedRevenue - receivedRevenue, 0);
  const detachedCostExpected = detachedCostumeEntries.reduce((sum, entry) => sum + (isEventCostExpectedStatus(entry.status) ? number(entry.expectedAmount) : 0), 0);
  const detachedCostRealized = detachedCostumeEntries.reduce((sum, entry) => sum + (isEventCostRealizedStatus(entry.status)
    ? getEventNetRealizedAmount(number(entry.actualAmount), number(entry.refundedAmount))
    : 0), 0);
  const otherCostExpected = costEntries.filter((entry) => isEventCostExpectedStatus(entry.status)).reduce((sum, entry) => sum + number(entry._sum.expectedAmount), 0);
  const otherCostRealized = costEntries.reduce((sum, entry) => sum + realizedCostFor(entry), 0);
  const costsExpected = otherCostExpected + costumeCostExpected + detachedCostExpected;
  const costsRealized = otherCostRealized + costumeCostRealized + detachedCostRealized;

  return {
    event: { id: event.id, name: event.name, startsAt: event.startsAt.toISOString(), locationName: event.locationName, estimatedCapacity: event.estimatedCapacity, status: event.status },
    totals: {
      activeStudentParticipants: studentParticipantsOnly.length,
      paidStudentParticipants: studentPaymentStatuses.filter((item) => item.paid).length,
      pendingStudentParticipants: studentPaymentStatuses.filter((item) => !item.paid && !item.exempt && !item.overdue
        && !item.closed).length,
      overdueStudentParticipants: studentPaymentStatuses.filter((item) => item.overdue).length,
      exemptStudentParticipants: studentPaymentStatuses.filter((item) => item.exempt).length,
      closedStudentParticipants: studentPaymentStatuses.filter((item) => item.closed).length,
      participants, cancelledParticipants: Math.max(participants - activeParticipants._count._all, 0),
      registrationGross: participantGross, registrationDiscount: participantDiscount, registrationCommitted: participantExpected,
      registrationReceived: Math.max(participantReceivedNet, 0), registrationRefunded: participantRefunds,
      ticketPaidQuantity: saleStatusSum('PAID', 'quantity'), ticketPendingQuantity: saleStatusSum('PENDING', 'quantity'),
      ticketComplimentaryQuantity: saleStatusSum('COMPLIMENTARY', 'quantity'), ticketReceivedGross,
      ticketRefunded: refundedTicketAmount, ticketReceivedNet, ticketPendingRevenue: ticketPendingGross,
      ticketManualSales: sales.filter((sale) => sale.status !== 'CANCELLED' && !sale.eventMapOrderId).length,
      ticketOnlineSales: sales.filter((sale) => sale.status !== 'CANCELLED' && Boolean(sale.eventMapOrderId)).length,
      availableTicketQuantity: ticketLots.reduce((sum, lot) => sum + lot.available, 0),
      availableTicketPotential: ticketLots.reduce((sum, lot) => sum + lot.available * lot.unitPrice, 0),
      checkIns, committedRevenue, receivedRevenue, refundedRevenueExcludingTickets: refundedOtherRevenue + participantRefunds, resultRealized: receivedRevenue - costsRealized, resultCommitted: committedRevenue - costsExpected, pendingCommittedRevenue,
      costsExpected,
      costsRealized,
      otherRevenueExpected: expectedOtherRevenue,
      otherRevenueReceived: receivedOtherRevenue,
      otherRevenueRefunded: refundedOtherRevenue,
    },
    payments: [...paymentTotals].map(([method, netReceived]) => ({ method, netReceived })),
    timeline: [...timelineByDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
    salesByOrigin,
    salesBySessionSector,
    lots: ticketLots,
    categories: [
      ...relevantEntries.filter((entry) => !(entry.type === 'COST' && entry.originType === 'COSTUME')
        && !(entry.type === 'REVENUE' && entry.originType === 'COSTUME_ASSIGNMENT')).map((entry) => ({
      category: entry.category, type: entry.type, expected: entry.type === 'REVENUE'
        ? expectedRevenueFor(entry)
        : isEventCostExpectedStatus(entry.status) ? number(entry._sum.expectedAmount) : 0,
      realized: entry.type === 'REVENUE' ? realizedRevenueFor(entry) : realizedCostFor(entry),
      })),
      ...[...costumeCategoryTotals].map(([category, totals]) => ({ category, type: 'COST', ...totals })),
      ...[...detachedCostumeEntriesByCategory].map(([category, totals]) => ({ category, type: 'COST', ...totals })),
      ...(legacyAssignmentCategory.expected > 0 ? [{ category: 'Cobranças de figurinos', type: 'REVENUE', ...legacyAssignmentCategory }] : []),
    ],
  };
}
