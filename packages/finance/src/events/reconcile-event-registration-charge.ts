import { prisma } from '@alusa/database';

const PAID_PAYMENT_STATUSES = new Set([
  'CONFIRMED',
  'RECEIVED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
  'PAID',
]);

/** Reconnects an ambiguously-created standalone charge to its event registration. */
export async function linkReconciledEventRegistrationCharge(input: {
  contaId: string;
  chargeId: string;
  asaasPaymentId: string;
  asaasInstallmentId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const participants = await tx.eventParticipant.findMany({
      where: { contaId: input.contaId, standaloneChargeId: input.chargeId },
      select: { id: true, revenueEntryId: true, asaasPaymentId: true, asaasInstallmentId: true },
    });
    const groups = await tx.eventBillingGroup.findMany({
      where: { contaId: input.contaId, standaloneChargeId: input.chargeId },
      select: { id: true, asaasPaymentId: true, asaasInstallmentId: true },
    });
    const entryIds = [...new Set(participants
      .map(({ revenueEntryId }) => revenueEntryId)
      .filter((id): id is string => Boolean(id)))];
    const entries = entryIds.length === 0
      ? []
      : await tx.eventFinancialEntry.findMany({
        where: { contaId: input.contaId, id: { in: entryIds } },
        select: { id: true, asaasPaymentId: true },
      });

    const hasConflictingPayment = [
      ...participants.map(({ asaasPaymentId }) => asaasPaymentId),
      ...groups.map(({ asaasPaymentId }) => asaasPaymentId),
      ...entries.map(({ asaasPaymentId }) => asaasPaymentId),
    ].some((paymentId) => paymentId != null && paymentId !== input.asaasPaymentId);
    const hasConflictingInstallment = input.asaasInstallmentId != null && [
      ...participants.map(({ asaasInstallmentId }) => asaasInstallmentId),
      ...groups.map(({ asaasInstallmentId }) => asaasInstallmentId),
    ].some((installmentId) => installmentId != null && installmentId !== (input.asaasInstallmentId ?? null));
    if (hasConflictingPayment || hasConflictingInstallment) {
      throw new Error('EVENT_REGISTRATION_PAYMENT_LINK_CONFLICT');
    }

    if (participants.length === 0 && groups.length === 0 && entries.length === 0) {
      return { linked: false, participantCount: 0 };
    }

    await tx.eventBillingGroup.updateMany({
      where: { contaId: input.contaId, standaloneChargeId: input.chargeId },
      data: {
        asaasPaymentId: input.asaasPaymentId,
        asaasInstallmentId: input.asaasInstallmentId ?? undefined,
      },
    });
    await tx.eventBillingGroup.updateMany({
      where: {
        contaId: input.contaId,
        standaloneChargeId: input.chargeId,
        status: 'REQUIRES_RECONCILIATION',
      },
      data: { status: 'OPEN' },
    });
    await tx.eventParticipant.updateMany({
      where: { contaId: input.contaId, standaloneChargeId: input.chargeId },
      data: {
        asaasPaymentId: input.asaasPaymentId,
        asaasInstallmentId: input.asaasInstallmentId ?? undefined,
      },
    });
    if (entryIds.length > 0) {
      await tx.eventFinancialEntry.updateMany({
        where: { contaId: input.contaId, id: { in: entryIds } },
        data: { paymentProvider: 'ASAAS', asaasPaymentId: input.asaasPaymentId },
      });
    }

    return { linked: true, participantCount: participants.length };
  });
}

/** Clears the verification snapshot after the provider's current state was reconciled. */
export async function settleReconciledEventRegistrationCharge(input: {
  contaId: string;
  chargeId: string;
  paymentStatus: string;
}) {
  const providerStatus = input.paymentStatus.trim().toUpperCase();
  const snapshot = PAID_PAYMENT_STATUSES.has(providerStatus)
    ? 'QUITADO'
    : ['REFUNDED', 'CHARGEBACK_DEBITED'].includes(providerStatus)
      ? 'ESTORNADO'
      : ['CANCELED', 'DELETED'].includes(providerStatus)
        ? 'CANCELADO'
        : providerStatus === 'OVERDUE'
          ? 'ATRASADO'
          : ['REFUND_IN_PROGRESS', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'CHARGEBACK_DEPOSITED'].includes(providerStatus)
            ? null
            : 'PENDENTE';
  if (!snapshot) return;
  await prisma.eventParticipant.updateMany({
    where: {
      contaId: input.contaId,
      standaloneChargeId: input.chargeId,
      financialStatusSnapshot: 'EM_VERIFICACAO',
    },
    data: { financialStatusSnapshot: snapshot },
  });
}
