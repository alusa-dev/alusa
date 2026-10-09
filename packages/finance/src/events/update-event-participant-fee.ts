import { Prisma } from '@prisma/client';
import { EventsError } from '@alusa/domain/events';
import { calculateEventParticipantDiscount } from '@alusa/lib/events/event-participant-discount';
import { eventParticipantScalarSelect } from '@alusa/lib/events/event-financial-read-models';
import { recordEventAudit } from '@alusa/lib/events/event-audit.service';

type FeeUpdate = {
  isFeePaid?: boolean;
  registrationFeeOriginal?: number;
  discountValue?: number;
  discountType?: 'FIXED' | 'PERCENTAGE';
};

/** Applies fee/payment and discount changes within the caller's existing transaction. */
export async function updateEventParticipantFeeInTransaction(input: {
  tx: Prisma.TransactionClient;
  contaId: string;
  userId: string;
  eventId: string;
  participantId: string;
  body: FeeUpdate;
}): Promise<void> {
  const { tx, contaId, userId, eventId, participantId, body } = input;
  await tx.$queryRaw`SELECT id FROM "EventParticipant" WHERE id = ${participantId} AND "contaId" = ${contaId} FOR UPDATE`;
  const participant = await tx.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId },
    select: eventParticipantScalarSelect,
  });
  if (!participant) throw new EventsError('PARTICIPANTE_NAO_ENCONTRADO', 'Inscrição não encontrada.', 404);
  let revenueEntryId = participant.revenueEntryId;

  if (body.isFeePaid !== undefined && body.isFeePaid !== participant.isFeePaid) {
    const entry = revenueEntryId
      ? await tx.eventFinancialEntry.findFirst({ where: { id: revenueEntryId, contaId } })
      : null;
    if (entry?.asaasPaymentId) {
      throw new EventsError('PAGAMENTO_ASAAS_NAO_EDITAVEL', 'Não é possível alterar manualmente o status de um pagamento gerenciado pelo Asaas.', 409);
    }

    await tx.eventParticipant.updateMany({
      where: { id: participantId, contaId },
      data: { isFeePaid: body.isFeePaid },
    });

    if (revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: revenueEntryId, contaId },
        data: body.isFeePaid
          ? { status: 'RECEIVED', actualAmount: participant.registrationFeeCharged, realizedAt: new Date() }
          : { status: 'PENDING', actualAmount: null, realizedAt: null },
      });
    } else if (participant.registrationFeeCharged.gt(0)) {
      const createdEntry = await tx.eventFinancialEntry.create({
        data: {
          contaId,
          eventId: participant.eventId,
          type: 'REVENUE',
          category: 'Taxa de inscrição',
          description: 'Taxa de inscrição',
          expectedAmount: participant.registrationFeeCharged,
          actualAmount: body.isFeePaid ? participant.registrationFeeCharged : null,
          dueDate: new Date(),
          realizedAt: body.isFeePaid ? new Date() : null,
          status: body.isFeePaid ? 'RECEIVED' : 'PENDING',
          paymentMethod: 'OTHER',
        },
      });
      await tx.eventParticipant.updateMany({ where: { id: participantId, contaId }, data: { revenueEntryId: createdEntry.id } });
      revenueEntryId = createdEntry.id;
    }
  }

  if (body.registrationFeeOriginal === undefined && body.discountValue === undefined && body.discountType === undefined) return;
  if (participant.billingMode !== 'FULL') {
    throw new EventsError('TAXA_NAO_EDITAVEL', 'A taxa só pode ser editada em inscrições quitadas integralmente.', 409);
  }

  const currentEntry = revenueEntryId
    ? await tx.eventFinancialEntry.findFirst({ where: { id: revenueEntryId, contaId } })
    : null;
  if (currentEntry?.asaasPaymentId || participant.asaasPaymentId || participant.asaasInstallmentId) {
    throw new EventsError('TAXA_GERENCIADA_ASAAS', 'Não é possível editar uma taxa vinculada a uma cobrança digital.', 409);
  }

  const discount = calculateEventParticipantDiscount({
    originalAmount: body.registrationFeeOriginal ?? (participant.registrationFeeOriginal.toNumber() || participant.registrationFeeCharged.toNumber()),
    discountType: body.discountType ?? (participant.registrationFeeDiscountType as 'FIXED' | 'PERCENTAGE' | null),
    discountValue: body.discountValue ?? participant.registrationFeeDiscount.toNumber(),
  });
  const isFeePaid = body.isFeePaid ?? participant.isFeePaid;
  await tx.eventParticipant.updateMany({
    where: { id: participantId, contaId },
    data: {
      registrationFeeOriginal: discount.originalAmount,
      registrationFeeDiscount: discount.discountAmount,
      registrationFeeDiscountType: discount.discountAmount > 0 ? (body.discountType ?? participant.registrationFeeDiscountType) : null,
      registrationFeeCharged: discount.chargedAmount,
      entryAmount: isFeePaid ? discount.chargedAmount : 0,
      balanceAmount: 0,
    },
  });

  if (currentEntry) {
    await tx.eventFinancialEntry.updateMany({
      where: { id: currentEntry.id, contaId },
      data: {
        expectedAmount: discount.chargedAmount,
        grossAmount: discount.originalAmount,
        discountAmount: discount.discountAmount,
        actualAmount: isFeePaid ? discount.chargedAmount : null,
        status: isFeePaid ? 'RECEIVED' : 'PENDING',
        realizedAt: isFeePaid ? new Date() : null,
      },
    });
  } else if (discount.chargedAmount > 0) {
    const createdEntry = await tx.eventFinancialEntry.create({
      data: {
        contaId,
        eventId: participant.eventId,
        type: 'REVENUE',
        category: 'Taxa de inscrição',
        description: 'Taxa de inscrição',
        expectedAmount: discount.chargedAmount,
        grossAmount: discount.originalAmount,
        discountAmount: discount.discountAmount,
        actualAmount: isFeePaid ? discount.chargedAmount : null,
        dueDate: new Date(),
        realizedAt: isFeePaid ? new Date() : null,
        status: isFeePaid ? 'RECEIVED' : 'PENDING',
        paymentMethod: 'OTHER',
      },
    });
    await tx.eventParticipant.updateMany({ where: { id: participantId, contaId }, data: { revenueEntryId: createdEntry.id } });
  }

  const updatedParticipant = await tx.eventParticipant.findFirst({ where: { id: participantId, contaId }, select: eventParticipantScalarSelect });
  if (!updatedParticipant) throw new EventsError('PARTICIPANTE_NAO_ENCONTRADO', 'Inscrição não encontrada.', 404);
  await recordEventAudit(tx, {
    contaId,
    actorUserId: userId,
    action: 'events.participant.registration_fee.update',
    entityType: 'EventParticipant',
    entityId: participantId,
    eventId,
    before: participant,
    after: updatedParticipant,
    metadata: { originalAmount: discount.originalAmount, discountAmount: discount.discountAmount },
  });
}
