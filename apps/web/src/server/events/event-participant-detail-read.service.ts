import {
  calculateParticipantPayment,
  eventParticipantScalarSelect,
  type EventsContext,
} from '@alusa/lib/events/events.service';
import { listEventContractsByStudent } from '@alusa/lib/events/event-contracts.service';

import { eventParticipantRepository } from './event-participant.repository';

const publicOrderPaymentMethodLabels: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
};

type ParticipantDetailResult =
  | { found: false }
  | { found: true; data: unknown };

type EventsReadContext = EventsContext & { role?: string };

export async function getEventParticipantDetail(input: {
  ctx: EventsReadContext;
  eventId: string;
  participantId: string;
}): Promise<ParticipantDetailResult> {
  const { ctx, eventId, participantId } = input;
  const participant = await eventParticipantRepository.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    select: {
      ...eventParticipantScalarSelect,
      aluno: true,
      event: true,
      responsavel: true,
      turma: true,
    },
  });

  if (!participant) return { found: false };

  const eventContracts = participant.alunoId
    ? (await listEventContractsByStudent(ctx.contaId, participant.alunoId)).filter((contract) => contract.eventId === eventId)
    : [];
  const eventContractIds = new Set(eventContracts.map((contract) => contract.id));
  const consentimentos = participant.alunoId && eventContractIds.size > 0
    ? await eventParticipantRepository.consentRecord.findMany({
      where: {
        contaId: ctx.contaId,
        subjectType: 'ALUNO',
        subjectId: participant.alunoId,
        source: { startsWith: 'EVENT_CONTRACT:' },
      },
      select: { id: true, source: true, status: true, grantedAt: true, metadata: true },
      orderBy: { grantedAt: 'desc' },
    })
    : [];
  const consentimentosDaInscricao = consentimentos.flatMap((consentimento) => {
    const sourceParts = consentimento.source.split(':');
    if (sourceParts.length < 3 || !eventContractIds.has(sourceParts[1])) return [];
    const metadata = consentimento.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
    const values = metadata as Record<string, unknown>;
    const contratoId = typeof values.eventoContratoId === 'string' ? values.eventoContratoId : null;
    const titulo = typeof values.titulo === 'string' ? values.titulo : null;
    if (!contratoId || !titulo) return [];
    return [{
      id: consentimento.id,
      contratoId,
      titulo,
      finalidade: typeof values.finalidade === 'string' ? values.finalidade : null,
      decision: consentimento.status === 'GRANTED' ? 'AUTORIZADO' : 'RECUSADO',
      decididoEm: consentimento.grantedAt.toISOString(),
    }];
  });

  let costumes: any[] = [];
  let ticketSales: any[] = [];
  let financialEntries: any[] = [];
  let financialPayments: any[] = [];

  if (participant.alunoId || participant.responsavelId) {
    if (participant.alunoId) {
      costumes = await eventParticipantRepository.eventCostumeAssignment.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
        include: { costume: true },
      });
    }

    ticketSales = await eventParticipantRepository.eventTicketSale.findMany({
      where: {
        contaId: ctx.contaId,
        eventId,
        OR: [
          ...(participant.alunoId ? [{ alunoId: participant.alunoId }] : []),
          ...(participant.responsavelId ? [{ responsavelId: participant.responsavelId }] : []),
        ],
      },
      include: { lot: true },
    });

    const buyerEmails = [...new Set([
      participant.aluno?.email?.trim().toLowerCase(),
      participant.responsavel?.email?.trim().toLowerCase(),
    ].filter((email): email is string => Boolean(email)))];

    if (buyerEmails.length > 0) {
      const publicOrders = await eventParticipantRepository.eventMapOrder.findMany({
        where: {
          contaId: ctx.contaId,
          eventId,
          status: { in: ['PAYMENT_PENDING', 'CONFIRMED', 'PARTIALLY_REFUNDED'] },
          OR: buyerEmails.map((email) => ({ buyerEmail: { equals: email, mode: 'insensitive' } })),
        },
        include: {
          reservation: {
            include: {
              seats: { include: { publicSeat: { select: { lotId: true, lotName: true } } } },
            },
          },
          items: {
            include: {
              publicSeat: { select: { lotId: true, lotName: true } },
              ticket: { select: { id: true, status: true } },
            },
          },
        },
      });

      ticketSales.push(...publicOrders.map((order) => {
        const lotSources = order.status === 'PAYMENT_PENDING'
          ? (order.reservation?.seats ?? []).map((seat) => seat.publicSeat)
          : order.items.map((item) => item.publicSeat);
        const lots = lotSources
          .map((seat) => seat.lotId || seat.lotName ? {
            id: seat.lotId ?? `public-order:${order.id}`,
            name: seat.lotName ?? 'Mapa público',
          } : null)
          .filter((lot): lot is { id: string; name: string } => Boolean(lot));
        const uniqueLots = lots.filter((lot, index, arr) => arr.findIndex((entry) => entry.id === lot.id) === index);
        const primaryLot = uniqueLots[0] ?? null;
        const quantity = order.status === 'PAYMENT_PENDING'
          ? (order.reservation?.seats.length ?? 0)
          : Math.max(order.items.length, 0);
        const mappedStatus = order.status === 'PAYMENT_PENDING'
          ? 'RESERVED'
          : order.status === 'PARTIALLY_REFUNDED' ? 'REFUNDED' : 'PAID';
        const soldAt = order.paidAt ?? order.confirmedAt ?? order.createdAt;
        return {
          id: order.id,
          buyerName: order.buyerName,
          quantity,
          totalAmount: order.totalAmount,
          paymentMethod: order.paymentMethod ?? null,
          paymentMethodLabel: order.paymentMethod
            ? (publicOrderPaymentMethodLabels[order.paymentMethod] ?? order.paymentMethod)
            : 'Não informado',
          status: mappedStatus,
          soldAt,
          source: 'PUBLIC_ORDER',
          eventMapOrderId: order.id,
          asaasPaymentId: order.asaasPaymentId,
          paymentStatus: order.paymentStatus,
          invoiceUrl: order.invoiceUrl,
          chargeDetailUrl: `/cobrancas/event-map-order:${order.id}`,
          ticketsUrl: order.status === 'CONFIRMED'
            && order.ticketFulfillmentStatus === 'ISSUED'
            && order.items.length > 0
            && order.items.every((item) => Boolean(item.ticket))
              ? `/api/events/public-orders/${order.id}/tickets`
              : null,
          lot: {
            id: primaryLot?.id ?? `public-order:${order.id}`,
            name: uniqueLots.length <= 1 ? (primaryLot?.name ?? 'Mapa público') : `${primaryLot?.name ?? 'Mapa público'} +${uniqueLots.length - 1}`,
          },
        };
      }));
    }

    const entryIds = [
      participant.revenueEntryId,
      ...costumes.map((costume) => costume.revenueEntryId),
      ...ticketSales.map((sale) => sale.revenueEntryId),
    ].filter((id): id is string => Boolean(id));
    if (entryIds.length > 0) {
      financialEntries = await eventParticipantRepository.eventFinancialEntry.findMany({
        where: { contaId: ctx.contaId, id: { in: entryIds } },
        orderBy: { dueDate: 'asc' },
      });
    }
  } else if (participant.revenueEntryId) {
    const entry = await eventParticipantRepository.eventFinancialEntry.findFirst({
      where: { contaId: ctx.contaId, id: participant.revenueEntryId },
    });
    if (entry) financialEntries = [entry];
  }

  if (participant.revenueEntryId) {
    financialPayments = await eventParticipantRepository.eventFinancialPayment.findMany({
      where: {
        contaId: ctx.contaId,
        participantId: participant.id,
        financialEntryId: participant.revenueEntryId,
      },
      orderBy: { paidAt: 'asc' },
    });
  }

  let charges: any[] = [];
  let asaasInstallmentId: string | null = null;
  const planIdsByAsaasPaymentId = new Map<string, string[]>();
  const asaasPaymentIds = [
    ...financialEntries.map((entry) => entry.asaasPaymentId),
    participant.asaasPaymentId,
  ].filter((id): id is string => Boolean(id));
  const asaasInstallmentIds = [
    ...financialEntries.map((entry) => entry.asaasPaymentId),
    participant.asaasInstallmentId,
  ].filter((id): id is string => Boolean(id));

  if (asaasPaymentIds.length > 0 || asaasInstallmentIds.length > 0) {
    const plans = await eventParticipantRepository.standaloneInstallmentPlan.findMany({
      where: { contaId: ctx.contaId, asaasInstallmentId: { in: asaasInstallmentIds } },
      include: { charges: { orderBy: { dueDate: 'asc' } } },
    });
    if (plans.length > 0) asaasInstallmentId = plans[0].asaasInstallmentId;
    for (const plan of plans) {
      if (!plan.asaasInstallmentId) continue;
      planIdsByAsaasPaymentId.set(plan.asaasInstallmentId, [
        ...(planIdsByAsaasPaymentId.get(plan.asaasInstallmentId) ?? []),
        plan.id,
      ]);
    }

    const directCharges = await eventParticipantRepository.charge.findMany({
      where: { contaId: ctx.contaId, asaasPaymentId: { in: asaasPaymentIds } },
    });
    const collectedCharges = [...plans.flatMap((plan) => plan.charges), ...directCharges];
    const planIdsFromCharges = directCharges
      .map((charge) => charge.standaloneInstallmentPlanId)
      .filter((id): id is string => Boolean(id));
    if (planIdsFromCharges.length > 0) {
      const extraPlans = await eventParticipantRepository.standaloneInstallmentPlan.findMany({
        where: { contaId: ctx.contaId, id: { in: planIdsFromCharges } },
        include: { charges: { orderBy: { dueDate: 'asc' } } },
      });
      collectedCharges.push(...extraPlans.flatMap((plan) => plan.charges));
      if (!asaasInstallmentId && extraPlans.length > 0) asaasInstallmentId = extraPlans[0].asaasInstallmentId;
      for (const plan of extraPlans) {
        if (!plan.asaasInstallmentId) continue;
        planIdsByAsaasPaymentId.set(plan.asaasInstallmentId, [
          ...(planIdsByAsaasPaymentId.get(plan.asaasInstallmentId) ?? []),
          plan.id,
        ]);
      }
    }
    const seen = new Set<string>();
    charges = collectedCharges
      .filter((charge) => !seen.has(charge.id) && Boolean(seen.add(charge.id)))
      .sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : 0) - (b.dueDate ? new Date(b.dueDate).getTime() : 0));
  }

  const costumeCount = costumes.length;
  const pendingCostumes = costumes.filter((costume) => costume.status !== 'DELIVERED').length;
  const costumesValue = costumes.reduce(
    (sum, costume) => sum + (costume.billingMode === 'SEPARATE_CHARGE' && costume.chargedValue ? costume.chargedValue.toNumber() : 0),
    0,
  );
  const ticketsBought = ticketSales
    .filter((sale) => ['PAID', 'COMPLIMENTARY'].includes(sale.status))
    .reduce((sum, sale) => sum + sale.quantity, 0);
  const ticketsValue = ticketSales
    .filter((sale) => sale.status === 'PAID')
    .reduce((sum, sale) => sum + (typeof sale.totalAmount?.toNumber === 'function' ? sale.totalAmount.toNumber() : Number(sale.totalAmount ?? 0)), 0);
  const feeValue = participant.registrationFeeCharged.toNumber();
  const totalSpent = feeValue + costumesValue + ticketsValue;
  const feeEntry = participant.revenueEntryId
    ? financialEntries.find((entry) => entry.id === participant.revenueEntryId)
    : null;
  let participantCharges: any[] = [];
  if (feeEntry?.asaasPaymentId || participant.asaasPaymentId || participant.asaasInstallmentId) {
    const entryAsaasId = feeEntry?.asaasPaymentId ?? participant.asaasInstallmentId ?? participant.asaasPaymentId;
    const feePlanIds = planIdsByAsaasPaymentId.get(entryAsaasId) ?? [];
    participantCharges = charges.filter((charge) => charge.asaasPaymentId === entryAsaasId
      || (charge.standaloneInstallmentPlanId && feePlanIds.includes(charge.standaloneInstallmentPlanId)));
  }
  const paymentDetails = calculateParticipantPayment(
    feeValue,
    participant.isFeePaid,
    feeEntry,
    participantCharges,
    participant.isFeeExempt,
    financialPayments,
  );

  return {
    found: true,
    data: {
      participant: {
        ...participant,
        isFeeExempt: participant.isFeeExempt,
        registrationFeeCharged: feeValue,
        registrationFeeOriginal: participant.registrationFeeOriginal.toNumber(),
        registrationFeeDiscount: participant.registrationFeeDiscount.toNumber(),
        registrationFeeDiscountType: participant.registrationFeeDiscountType,
        percentPaid: paymentDetails.percentPaid,
        totalPaid: paymentDetails.totalPaid,
        financialStatus: paymentDetails.status,
        metrics: { costumeCount, pendingCostumes, costumesValue, ticketsBought, ticketsValue, totalSpent },
      },
      costumes: costumes.map((costume) => ({
        ...costume,
        chargedValue: costume.chargedValue ? costume.chargedValue.toNumber() : null,
      })),
      ticketSales: ticketSales.map((sale) => ({
        ...sale,
        unitPriceSnapshot: typeof sale.unitPriceSnapshot?.toNumber === 'function'
          ? sale.unitPriceSnapshot.toNumber()
          : (sale.quantity ? Number(sale.totalAmount ?? 0) / sale.quantity : Number(sale.totalAmount ?? 0)),
        totalAmount: typeof sale.totalAmount?.toNumber === 'function' ? sale.totalAmount.toNumber() : Number(sale.totalAmount ?? 0),
      })),
      financialEntries: financialEntries.map((entry) => {
        const isFeeEntry = entry.id === participant.revenueEntryId;
        const feeEntryStatus = {
          QUITADO: 'RECEIVED',
          EM_DIA: 'PENDING',
          ATRASADO: 'PENDING',
          PENDENTE: 'PENDING',
          PARCIAL: 'PENDING',
          CANCELADO: 'CANCELLED',
          ESTORNADO: 'REFUNDED',
          ESTORNADO_PARCIAL: 'PENDING',
          ISENTO: 'RECEIVED',
        }[paymentDetails.status] ?? entry.status;
        return {
          ...entry,
          status: isFeeEntry ? feeEntryStatus : entry.status,
          expectedAmount: entry.expectedAmount.toNumber(),
          grossAmount: entry.grossAmount == null ? null : entry.grossAmount.toNumber(),
          discountAmount: entry.discountAmount.toNumber(),
          actualAmount: isFeeEntry ? paymentDetails.netPaid : (entry.actualAmount ? entry.actualAmount.toNumber() : null),
        };
      }),
      financialPayments: financialPayments.map((payment) => ({
        ...payment,
        amount: payment.amount.toNumber(),
        refundedAmount: payment.refundedAmount.toNumber(),
        netAmount: payment.netAmount.toNumber(),
      })),
      charges: charges.map((charge) => ({ ...charge, value: charge.value ? charge.value.toNumber() : null })),
      asaasInstallmentId,
      eventContracts,
      consentimentos: consentimentosDaInscricao,
      canPermanentlyDelete: ctx.role === 'ADMIN',
    },
  };
}
