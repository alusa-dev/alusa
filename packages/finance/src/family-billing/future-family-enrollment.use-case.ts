import {
  enqueueFamilyBillingOutbox,
  parseFamilyBillingPayload,
  processFamilyBillingOutboxEvent,
  type FamilyBillingPayload,
} from './processor';

/** Schedules future recurring billing while allowing the enrollment fee now. */
export async function provisionFutureFamilyEnrollment(input: {
  payload: FamilyBillingPayload;
  matriculaFamiliarId: string;
  availableAt: Date;
}) {
  const base = parseFamilyBillingPayload(input.payload);
  const feeOutboxId = base.enrollmentFeeValue > 0
    ? (await enqueueFamilyBillingOutbox({
        contaId: base.contaId,
        aggregateType: 'MATRICULA_FAMILIAR',
        aggregateId: base.aggregateId,
        matriculaFamiliarId: input.matriculaFamiliarId,
        payload: parseFamilyBillingPayload({
          ...base,
          monthlyValue: 0,
          strategy: 'SEPARATE',
          billingPhase: 'ENROLLMENT_FEE',
          deferActivationUntil: input.availableAt.toISOString(),
        }),
        eventType: `FUTURE_FAMILY_ENROLLMENT_FEE:${base.operationId}`,
      })).id
    : null;

  const recurringOutbox = await enqueueFamilyBillingOutbox({
    contaId: base.contaId,
    aggregateType: 'MATRICULA_FAMILIAR',
    aggregateId: base.aggregateId,
    matriculaFamiliarId: input.matriculaFamiliarId,
    payload: parseFamilyBillingPayload({
      ...base,
      billingPhase: 'RECURRING',
      deferActivationUntil: null,
      scheduledEffectiveAt: input.availableAt.toISOString(),
    }),
    eventType: `FUTURE_FAMILY_RECURRING:${base.operationId}`,
    availableAt: input.availableAt,
  });

  if (!feeOutboxId) return { status: 'PENDING' as const, recurringOutboxId: recurringOutbox.id, feeConfirmed: false, error: null };
  const feeResult = await processFamilyBillingOutboxEvent(feeOutboxId);
  return feeResult.processed
    ? { status: 'PENDING' as const, recurringOutboxId: recurringOutbox.id, feeConfirmed: true, error: null }
    : { status: 'PARTIAL' as const, recurringOutboxId: recurringOutbox.id, feeConfirmed: false, error: `RESULTADO_INCERTO: taxa familiar não foi confirmada (${feeResult.reason}).` };
}
