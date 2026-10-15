import { prisma } from '../prisma';

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

export async function getEventReportDetail(contaId: string, eventId: string): Promise<EventReportDetail | null> {
  const event = await prisma.schoolEvent.findFirst({
    where: { id: eventId, contaId },
    select: { id: true, name: true, startsAt: true, locationName: true, estimatedCapacity: true, status: true },
  });
  if (!event) return null;

  const where = { contaId, eventId };
  const [participants, activeParticipants, participantDetails, sales, saleGroups, entries, payments, lots, checkIns] = await Promise.all([
    prisma.eventParticipant.count({ where }),
    prisma.eventParticipant.aggregate({
      where: { ...where, cancelledAt: null },
      _sum: { registrationFeeOriginal: true, registrationFeeDiscount: true, registrationFeeCharged: true, feePaidAmount: true, feeRefundedAmount: true },
      _count: { _all: true },
    }),
    prisma.eventParticipant.findMany({
      where: { ...where, cancelledAt: null },
      select: {
        type: true, registrationFeeCharged: true, feePaidAmount: true, isFeePaid: true,
        isFeeExempt: true, financialStatusSnapshot: true, revenueEntryId: true,
      },
    }),
    prisma.eventTicketSale.findMany({
      where,
      select: {
        id: true, lotId: true, status: true, quantity: true, totalAmount: true, refundedAmount: true,
        paymentMethod: true, paidAt: true, eventMapOrderId: true,
        saleSeats: { where: { contaId }, select: { sectionName: true } },
      },
    }),
    prisma.eventTicketSale.groupBy({ by: ['status'], where, _sum: { quantity: true, totalAmount: true, refundedAmount: true }, _count: { _all: true } }),
    prisma.eventFinancialEntry.groupBy({
      by: ['type', 'status', 'category', 'originType'], where,
      _sum: { expectedAmount: true, actualAmount: true, refundedAmount: true, netAmount: true },
    }),
    prisma.eventFinancialPayment.groupBy({ by: ['paymentMethod', 'status'], where: { ...where, financialEntry: { type: 'REVENUE', originType: { not: 'TICKET_SALE' } } }, _sum: { netAmount: true, amount: true, refundedAmount: true } }),
    prisma.eventTicketLot.findMany({
      where,
      select: { id: true, name: true, eventMapId: true, unitPrice: true, quantityTotal: true, quantitySold: true },
    }),
    prisma.eventTicket.count({ where: { ...where, usedAt: { not: null }, cancelledAt: null } }),
  ]);

  const studentParticipantsOnly = participantDetails.filter((participant) => participant.type === 'STUDENT');
  const studentEntryIds = participantDetails.map((participant) => participant.revenueEntryId).filter((id): id is string => Boolean(id));
  const studentEntries = studentEntryIds.length
    ? await prisma.eventFinancialEntry.findMany({
      where: { contaId, eventId, id: { in: studentEntryIds } },
      select: { id: true, dueDate: true, status: true, netAmount: true, actualAmount: true, refundedAmount: true },
    })
    : [];
  const studentEntryById = new Map(studentEntries.map((entry) => [entry.id, entry]));
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const participantPaymentStatus = (participant: (typeof participantDetails)[number]) => {
    const entry = studentEntryById.get(participant.revenueEntryId ?? '');
    const expected = number(participant.registrationFeeCharged);
    const exempt = participant.isFeeExempt || expected <= 0;
    const closed = !exempt && (['CANCELADO', 'ESTORNADO'].includes(participant.financialStatusSnapshot ?? '')
      || ['CANCELLED', 'CANCELED', 'REFUNDED'].includes(entry?.status ?? ''));
    const netPaid = entry
      ? Math.max(number(entry.netAmount ?? (number(entry.actualAmount) - number(entry.refundedAmount))), 0)
      : participant.isFeePaid
        ? expected
        : Math.max(number(participant.feePaidAmount), 0);
    const remaining = Math.max(expected - netPaid, 0);
    const paid = !closed && !exempt && remaining <= 0;
    const overdue = !closed && !paid && !exempt && remaining > 0 && (
      participant.financialStatusSnapshot === 'ATRASADO'
      || Boolean(entry?.dueDate && entry.dueDate < todayStart)
    );
    return { paid, exempt, closed, overdue, netPaid };
  };
  const participantPaymentStatuses = participantDetails.map((participant) => ({ participant, ...participantPaymentStatus(participant) }));
  const studentPaymentStatuses = participantPaymentStatuses.filter(({ participant }) => participant.type === 'STUDENT');

  const eventMaps = lots.length ? await prisma.eventMap.findMany({ where: { ...where, id: { in: lots.map((lot) => lot.eventMapId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true, startsAt: true } }) : [];
  const mapById = new Map(eventMaps.map((map) => [map.id, map]));
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const group = new Map(saleGroups.map((row) => [row.status, row]));
  const saleStatusSum = (status: string, key: 'quantity' | 'totalAmount' | 'refundedAmount') => number(group.get(status as never)?._sum?.[key]);
  const paidSales = sales.filter((sale) => sale.status === 'PAID');
  const publicOrderIds = [...new Set(paidSales.map((sale) => sale.eventMapOrderId).filter((id): id is string => Boolean(id)))];
  const publicOrderItems = publicOrderIds.length
    ? await prisma.eventMapOrderItem.findMany({
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
  const ticketReceivedNet = Math.max(ticketReceivedGross - refundedTicketAmount, 0);
  const paymentTotals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.status !== 'RECEIVED' && payment.status !== 'PAID') continue;
    const value = Math.max(number(payment._sum.netAmount), 0);
    paymentTotals.set(payment.paymentMethod, (paymentTotals.get(payment.paymentMethod) ?? 0) + value);
  }
  for (const sale of paidSales) {
    const key = sale.paymentMethod;
    paymentTotals.set(key, (paymentTotals.get(key) ?? 0) + Math.max(number(sale.totalAmount) - number(sale.refundedAmount), 0));
  }

  const timelineByDay = new Map<string, number>();
  for (const sale of paidSales) {
    if (!sale.paidAt) continue;
    const day = sale.paidAt.toISOString().slice(0, 10);
    timelineByDay.set(day, (timelineByDay.get(day) ?? 0) + Math.max(number(sale.totalAmount) - number(sale.refundedAmount), 0));
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

  const relevantEntries = entries.filter((entry) => !['TICKET_SALE', 'EVENT_REGISTRATION'].includes(entry.originType));
  const otherRevenueEntries = relevantEntries.filter((entry) => entry.type === 'REVENUE');
  const expectedRevenueEntries = otherRevenueEntries.filter((entry) => !['CANCELLED', 'REFUNDED'].includes(entry.status));
  const costEntries = relevantEntries.filter((entry) => entry.type === 'COST');
  const expectedStatuses = new Set(['EXPECTED', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'RECEIVED']);
  const receivedStatuses = new Set(['PAID', 'RECEIVED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED']);
  const netFor = (entry: (typeof entries)[number]) => receivedStatuses.has(entry.status)
    ? Math.max(number(entry._sum.netAmount ?? (number(entry._sum.actualAmount) - number(entry._sum.refundedAmount))), 0)
    : 0;
  const expectedRevenueFor = (entry: (typeof entries)[number]) => entry.status === 'PARTIALLY_REFUNDED'
    ? netFor(entry)
    : expectedStatuses.has(entry.status) ? number(entry._sum.expectedAmount) : 0;
  const expectedOtherRevenue = expectedRevenueEntries.reduce((sum, entry) => sum + expectedRevenueFor(entry), 0);
  const receivedOtherRevenue = expectedRevenueEntries.reduce((sum, entry) => sum + netFor(entry), 0);
  const refundedOtherRevenue = otherRevenueEntries.reduce((sum, entry) => sum + number(entry._sum.refundedAmount), 0);
  const ticketLots = lots.map((lot) => ({
    id: lot.id, name: lot.name, mapId: lot.eventMapId, mapName: mapById.get(lot.eventMapId ?? '')?.name ?? null,
    mapStartsAt: mapById.get(lot.eventMapId ?? '')?.startsAt?.toISOString() ?? null,
    sold: lot.quantitySold, total: lot.quantityTotal,
    available: Math.max(lot.quantityTotal - lot.quantitySold, 0), unitPrice: number(lot.unitPrice),
  }));
  const ticketPendingGross = saleStatusSum('PENDING', 'totalAmount');
  const participantExpected = participantPaymentStatuses.reduce((sum, item) =>
    sum + (!item.closed && !item.exempt ? number(item.participant.registrationFeeCharged) : 0), 0);
  const participantGross = number(activeParticipants._sum.registrationFeeOriginal);
  const participantDiscount = number(activeParticipants._sum.registrationFeeDiscount);
  // feePaidAmount is persisted net of refunds for event registration payments.
  const participantReceivedNet = participantPaymentStatuses.reduce((sum, item) =>
    sum + (!item.closed ? item.netPaid : 0), 0);
  const participantRefunds = number(activeParticipants._sum.feeRefundedAmount);
  const ticketCommitted = ticketReceivedNet + ticketPendingGross;
  const committedRevenue = participantExpected + ticketCommitted + expectedOtherRevenue;
  const receivedRevenue = Math.max(participantReceivedNet, 0) + ticketReceivedNet + receivedOtherRevenue;

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
      checkIns, committedRevenue, receivedRevenue, refundedRevenueExcludingTickets: refundedOtherRevenue + participantRefunds, resultRealized: receivedRevenue - costEntries.reduce((sum, entry) => sum + netFor(entry), 0), resultCommitted: committedRevenue - costEntries.filter((entry) => expectedStatuses.has(entry.status)).reduce((sum, entry) => sum + number(entry._sum.expectedAmount), 0), pendingCommittedRevenue: Math.max(committedRevenue - receivedRevenue, 0),
      costsExpected: costEntries.filter((entry) => expectedStatuses.has(entry.status)).reduce((sum, entry) => sum + number(entry._sum.expectedAmount), 0),
      costsRealized: costEntries.reduce((sum, entry) => sum + netFor(entry), 0),
      otherRevenueExpected: expectedOtherRevenue,
      otherRevenueReceived: receivedOtherRevenue,
      otherRevenueRefunded: otherRevenueEntries.reduce((sum, entry) => sum + number(entry._sum.refundedAmount), 0),
    },
    payments: [...paymentTotals].map(([method, netReceived]) => ({ method, netReceived })),
    timeline: [...timelineByDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, amount]) => ({ day, amount })),
    salesByOrigin,
    salesBySessionSector,
    lots: ticketLots,
    categories: relevantEntries.map((entry) => ({
      category: entry.category, type: entry.type, expected: entry.type === 'REVENUE'
        ? expectedRevenueFor(entry)
        : expectedStatuses.has(entry.status) ? number(entry._sum.expectedAmount) : 0,
      realized: netFor(entry),
    })),
  };
}
