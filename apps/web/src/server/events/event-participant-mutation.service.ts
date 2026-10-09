import { z } from 'zod';
import { logPersonDataOperationalEvent } from '@/lib/observability/api-logger';

import {
  eventParticipantScalarSelect,
  type EventsContext,
} from '@alusa/lib/events/events.service';
import { ensureEventAsaasPaymentProviderRegistered } from './register-event-asaas-payment-provider';
import {
  cancelOpenEventParticipantCharges,
  unregisterEventParticipant,
  updateEventParticipantFeeInTransaction,
} from '@alusa/finance';
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
    if (body.notes !== undefined) {
      await tx.eventParticipant.updateMany({
        where: { id: participantId, contaId: ctx.contaId },
        data: { notes: body.notes },
      });
    }

    if (
      body.isFeePaid !== undefined ||
      body.registrationFeeOriginal !== undefined ||
      body.discountValue !== undefined ||
      body.discountType !== undefined
    ) {
      await updateEventParticipantFeeInTransaction({
        tx,
        contaId: ctx.contaId,
        userId: ctx.userId,
        eventId,
        participantId,
        body,
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

  const result = await unregisterEventParticipant(
    ctx,
    eventId,
    participantId,
    cancelOpenEventParticipantCharges,
  );
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
      logPersonDataOperationalEvent('api.events.participant.projection.failed', projectionError);
    }
  }
  return { found: true, ok: result.ok, grouped: result.grouped === true };
}
