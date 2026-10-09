import { prisma } from '@alusa/database';
import { err } from '@alusa/shared';
import { deriveDeterministicId } from '../core';
import { createStandaloneCharge } from '../use-cases/create-standalone-charge';

/** Creates an event registration charge outside DB transactions, then persists its links atomically. */
export async function createEventRegistrationCharge(input: {
  contaId: string;
  charge: Parameters<typeof createStandaloneCharge>[0];
  target:
    | { kind: 'group'; groupId: string; participantIds: string[]; revenueEntryIds: string[] }
    | { kind: 'participant'; participantId: string; revenueEntryId: string | null };
}) {
  if (!input.charge.uiRequestId) {
    throw new Error('Event registration charges require a stable idempotency key.');
  }
  const stableChargeId = deriveDeterministicId('ch', input.charge.uiRequestId);

  // Persist a stable local link before contacting the provider. If the remote
  // request times out after being accepted, retries and reconciliation still
  // have the same charge identity to converge on.
  await prisma.$transaction(async (tx) => {
    if (input.target.kind === 'group') {
      await tx.eventBillingGroup.updateMany({
        where: { id: input.target.groupId, contaId: input.contaId },
        data: { standaloneChargeId: stableChargeId },
      });
      await tx.eventParticipant.updateMany({
        where: { id: { in: input.target.participantIds }, contaId: input.contaId },
        data: { standaloneChargeId: stableChargeId },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { id: { in: input.target.revenueEntryIds }, contaId: input.contaId },
        data: { paymentProvider: 'ASAAS', paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
      });
      return;
    }

    await tx.eventParticipant.updateMany({
      where: { id: input.target.participantId, contaId: input.contaId },
      data: { standaloneChargeId: stableChargeId },
    });
    if (input.target.revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: input.target.revenueEntryId, contaId: input.contaId },
        data: { paymentProvider: 'ASAAS', paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
      });
    }
  });

  let result: Awaited<ReturnType<typeof createStandaloneCharge>>;
  try {
    result = await createStandaloneCharge(input.charge);
  } catch {
    await markRegistrationChargeUncertain(input, stableChargeId).catch(() => undefined);
    return err('ERRO_AO_CRIAR_PAGAMENTO');
  }
  if (!result.success) {
    if (result.error === 'ERRO_AO_CRIAR_PAGAMENTO') {
      await markRegistrationChargeUncertain(input, stableChargeId).catch(() => undefined);
      return result;
    }
    await clearRegistrationChargeReservation(input, stableChargeId);
    return result;
  }

  try {
    await prisma.$transaction(async (tx) => {
    if (input.target.kind === 'group') {
      const group = await tx.eventBillingGroup.update({
        where: { id: input.target.groupId, contaId: input.contaId },
        data: {
          status: 'OPEN',
          standaloneChargeId: result.data.chargeId,
          asaasPaymentId: result.data.asaasPaymentId ?? null,
          asaasInstallmentId: result.data.asaasInstallmentId ?? null,
        },
      });
      await tx.eventParticipant.updateMany({
        where: { contaId: input.contaId, id: { in: input.target.participantIds } },
        data: {
          standaloneChargeId: group.standaloneChargeId,
          asaasPaymentId: group.asaasPaymentId,
          asaasInstallmentId: group.asaasInstallmentId,
        },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: input.contaId, id: { in: input.target.revenueEntryIds } },
        data: { paymentProvider: 'ASAAS', paymentStatus: 'PENDING' },
      });
      return;
    }

    await tx.eventParticipant.updateMany({
      where: { id: input.target.participantId, contaId: input.contaId },
      data: {
        standaloneChargeId: result.data.chargeId,
        asaasPaymentId: result.data.asaasPaymentId ?? null,
        asaasInstallmentId: result.data.asaasInstallmentId ?? null,
      },
    });
    if (input.target.revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: input.target.revenueEntryId, contaId: input.contaId },
        data: {
          paymentProvider: 'ASAAS',
          paymentStatus: 'PENDING',
          asaasPaymentId: result.data.asaasPaymentId ?? result.data.asaasInstallmentId ?? null,
        },
      });
    }
    });
  } catch {
    // The remote charge may already exist. Keep the deterministic local link
    // and mark it for reconciliation instead of allowing the caller to delete
    // the registration and orphan the charge.
    await markRegistrationChargeUncertain(input, stableChargeId).catch(() => undefined);
    return err('ERRO_AO_CRIAR_PAGAMENTO');
  }
  return result;
}

async function markRegistrationChargeUncertain(
  input: Parameters<typeof createEventRegistrationCharge>[0],
  stableChargeId: string,
) {
  await prisma.$transaction(async (tx) => {
    if (input.target.kind === 'group') {
      await tx.eventBillingGroup.updateMany({
        where: { id: input.target.groupId, contaId: input.contaId },
        data: { status: 'REQUIRES_RECONCILIATION', standaloneChargeId: stableChargeId },
      });
      await tx.eventParticipant.updateMany({
        where: { id: { in: input.target.participantIds }, contaId: input.contaId },
        data: { standaloneChargeId: stableChargeId, financialStatusSnapshot: 'EM_VERIFICACAO' },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { id: { in: input.target.revenueEntryIds }, contaId: input.contaId },
        data: { paymentProvider: 'ASAAS', paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
      });
      return;
    }

    await tx.eventParticipant.updateMany({
      where: { id: input.target.participantId, contaId: input.contaId },
      data: { standaloneChargeId: stableChargeId, financialStatusSnapshot: 'EM_VERIFICACAO' },
    });
    if (input.target.revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: input.target.revenueEntryId, contaId: input.contaId },
        data: { paymentProvider: 'ASAAS', paymentStatus: 'PAYMENT_CREATION_UNKNOWN' },
      });
    }
  });
}

async function clearRegistrationChargeReservation(
  input: Parameters<typeof createEventRegistrationCharge>[0],
  stableChargeId: string,
) {
  await prisma.$transaction(async (tx) => {
    if (input.target.kind === 'group') {
      await tx.eventBillingGroup.updateMany({
        where: { id: input.target.groupId, contaId: input.contaId, standaloneChargeId: stableChargeId },
        data: { standaloneChargeId: null },
      });
      await tx.eventParticipant.updateMany({
        where: { id: { in: input.target.participantIds }, contaId: input.contaId, standaloneChargeId: stableChargeId },
        data: { standaloneChargeId: null },
      });
      await tx.eventFinancialEntry.updateMany({
        where: { id: { in: input.target.revenueEntryIds }, contaId: input.contaId, paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
        data: { paymentProvider: null, paymentStatus: null },
      });
      return;
    }

    await tx.eventParticipant.updateMany({
      where: { id: input.target.participantId, contaId: input.contaId, standaloneChargeId: stableChargeId },
      data: { standaloneChargeId: null },
    });
    if (input.target.revenueEntryId) {
      await tx.eventFinancialEntry.updateMany({
        where: { id: input.target.revenueEntryId, contaId: input.contaId, paymentStatus: 'PAYMENT_CREATION_IN_PROGRESS' },
        data: { paymentProvider: null, paymentStatus: null },
      });
    }
  });
}
