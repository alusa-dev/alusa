import { z } from 'zod';

import {
  eventParticipantScalarSelect,
  EventsError,
  recordEventAudit,
  unregisterEventParticipant,
  type EventsContext,
} from '@alusa/lib/events/events.service';
import { calculateEventParticipantDiscount } from '@alusa/lib/events/event-participant-discount';
import { ensureEventAsaasPaymentProviderRegistered } from './register-event-asaas-payment-provider';
import {
  eventParticipantPatchInputDTOSchema,
} from '@/features/events/dtos';
import { eventParticipantRepository } from './event-participant.repository';

type EventParticipantPatchInput = z.infer<typeof eventParticipantPatchInputDTOSchema>;

export type EventParticipantMutationResult =
  | { found: false }
  | { found: true; data: { ok: true } };

export async function updateEventParticipant(input: {
  ctx: EventsContext;
  eventId: string;
  participantId: string;
  body: EventParticipantPatchInput;
}): Promise<EventParticipantMutationResult> {
  const { ctx, eventId, participantId, body } = input;
  const participant = await eventParticipantRepository.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    select: eventParticipantScalarSelect,
  });
  if (!participant) return { found: false };

  await eventParticipantRepository.$transaction(async (tx) => {
    let revenueEntryId = participant.revenueEntryId;

    if (body.notes !== undefined) {
      await tx.eventParticipant.updateMany({
        where: { id: participantId, contaId: ctx.contaId },
        data: { notes: body.notes },
      });
    }

    if (body.isFeePaid !== undefined && body.isFeePaid !== participant.isFeePaid) {
      const entry = participant.revenueEntryId
        ? await tx.eventFinancialEntry.findFirst({
          where: { id: participant.revenueEntryId, contaId: ctx.contaId },
        })
        : null;
      if (entry?.asaasPaymentId) {
        throw new EventsError(
          'PAGAMENTO_ASAAS_NAO_EDITAVEL',
          'Não é possível alterar manualmente o status de um pagamento gerenciado pelo Asaas.',
          409,
        );
      }

      await tx.eventParticipant.updateMany({
        where: { id: participantId, contaId: ctx.contaId },
        data: { isFeePaid: body.isFeePaid },
      });

      if (participant.revenueEntryId) {
        await tx.eventFinancialEntry.updateMany({
          where: { id: participant.revenueEntryId, contaId: ctx.contaId },
          data: body.isFeePaid
            ? {
              status: 'RECEIVED',
              actualAmount: participant.registrationFeeCharged,
              realizedAt: new Date(),
            }
            : { status: 'PENDING', actualAmount: null, realizedAt: null },
        });
      } else if (participant.registrationFeeCharged.gt(0)) {
        const createdEntry = await tx.eventFinancialEntry.create({
          data: {
            contaId: ctx.contaId,
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
        await tx.eventParticipant.updateMany({
          where: { id: participantId, contaId: ctx.contaId },
          data: { revenueEntryId: createdEntry.id },
        });
        revenueEntryId = createdEntry.id;
      }
    }

    if (body.registrationFeeOriginal !== undefined || body.discountValue !== undefined || body.discountType !== undefined) {
      if (participant.billingMode !== 'FULL') {
        throw new EventsError('TAXA_NAO_EDITAVEL', 'A taxa só pode ser editada em inscrições quitadas integralmente.', 409);
      }

      const currentEntry = revenueEntryId
        ? await tx.eventFinancialEntry.findFirst({ where: { id: revenueEntryId, contaId: ctx.contaId } })
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
        where: { id: participantId, contaId: ctx.contaId },
        data: {
          registrationFeeOriginal: discount.originalAmount,
          registrationFeeDiscount: discount.discountAmount,
          registrationFeeDiscountType: discount.discountAmount > 0
            ? (body.discountType ?? participant.registrationFeeDiscountType)
            : null,
          registrationFeeCharged: discount.chargedAmount,
          entryAmount: isFeePaid ? discount.chargedAmount : 0,
          balanceAmount: 0,
        },
      });

      if (currentEntry) {
        await tx.eventFinancialEntry.updateMany({
          where: { id: currentEntry.id, contaId: ctx.contaId },
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
            contaId: ctx.contaId,
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
        await tx.eventParticipant.updateMany({
          where: { id: participantId, contaId: ctx.contaId },
          data: { revenueEntryId: createdEntry.id },
        });
      }

      const updatedParticipant = await tx.eventParticipant.findFirst({
        where: { id: participantId, contaId: ctx.contaId },
        select: eventParticipantScalarSelect,
      });
      if (!updatedParticipant) {
        throw new EventsError('PARTICIPANTE_NAO_ENCONTRADO', 'Inscrição não encontrada.', 404);
      }
      await recordEventAudit(tx, {
        contaId: ctx.contaId,
        actorUserId: ctx.userId,
        action: 'events.participant.registration_fee.update',
        entityType: 'EventParticipant',
        entityId: participantId,
        eventId,
        before: participant,
        after: updatedParticipant,
        metadata: { originalAmount: discount.originalAmount, discountAmount: discount.discountAmount },
      });
    }

    if (body.costumes && body.costumes.length > 0) {
      for (const costumeUpdate of body.costumes) {
        const assignment = await tx.eventCostumeAssignment.findFirst({
          where: { id: costumeUpdate.id, contaId: ctx.contaId },
        });
        if (!assignment) continue;
        await tx.eventCostumeAssignment.updateMany({
          where: { id: costumeUpdate.id, contaId: ctx.contaId },
          data: {
            ...(costumeUpdate.definedSize !== undefined ? { definedSize: costumeUpdate.definedSize } : {}),
            ...(costumeUpdate.status !== undefined ? { status: costumeUpdate.status } : {}),
            ...(costumeUpdate.notes !== undefined ? { notes: costumeUpdate.notes } : {}),
          },
        });
      }
    }
  });

  return { found: true, data: { ok: true } };
}

export type EventParticipantDeletionResult =
  | { found: false }
  | { found: true; ok: boolean; grouped: boolean };

export async function deleteEventParticipant(input: {
  ctx: EventsContext;
  eventId: string;
  participantId: string;
}): Promise<EventParticipantDeletionResult> {
  ensureEventAsaasPaymentProviderRegistered();
  const { ctx, eventId, participantId } = input;
  const participant = await eventParticipantRepository.eventParticipant.findFirst({
    where: { id: participantId, eventId, contaId: ctx.contaId },
    select: eventParticipantScalarSelect,
  });
  if (!participant) return { found: false };

  const result = await unregisterEventParticipant(ctx, eventId, participantId);
  if (result.canceledChargeIds.length > 0) {
    try {
      const { chargeReadModelService, refreshFinanceSummaryReadModel } = await import('@alusa/finance');
      await Promise.all(result.canceledChargeIds.map((chargeId) => chargeReadModelService.projectChargeReadModelByChargeId(chargeId, ctx.contaId)));
      const now = new Date();
      await refreshFinanceSummaryReadModel({
        contaId: ctx.contaId,
        window: {
          start: new Date(now.getFullYear(), now.getMonth(), 1),
          end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
        },
        now,
      });
    } catch (projectionError) {
      console.error('[events][participant-cancel] read model projection failed', {
        contaId: ctx.contaId,
        participantId,
        error: projectionError instanceof Error ? projectionError.message : 'projection_failed',
      });
    }
  }
  return { found: true, ok: result.ok, grouped: result.grouped === true };
}
