type EventFinancialEntryForMaterialization = {
  status: string;
  asaasPaymentId: string | null;
  paymentProvider?: string | null;
  actualAmount?: unknown;
  description?: string | null;
};

type EventParticipantForMaterialization = {
  revenueEntryId: string | null;
  billingGroupId: string | null;
  standaloneChargeId: string | null;
  asaasPaymentId: string | null;
  asaasInstallmentId: string | null;
};

/**
 * A grouped digital charge is represented by the materialized Asaas plan.
 * The participant-level entry is only an allocation and must not become a
 * second operational charge when the plan already exists.
 */
export function isMaterializedGroupedEventEntry(
  entry: EventFinancialEntryForMaterialization,
  participant: EventParticipantForMaterialization | undefined,
  materializedPlanReferences: ReadonlySet<string>,
): boolean {
  if (!participant?.revenueEntryId || participant.revenueEntryId === '') return false;
  if (entry.asaasPaymentId) return false;
  if (!['EXPECTED', 'PENDING'].includes(entry.status)) return false;
  if (entry.paymentProvider !== 'ASAAS') return false;
  if (entry.actualAmount != null) return false;
  if (!entry.description?.toLowerCase().includes('cobrança agrupada do evento')) return false;
  if (!participant.billingGroupId) return false;

  return [
    participant.standaloneChargeId,
    participant.asaasPaymentId,
    participant.asaasInstallmentId,
  ].some((reference) => reference != null && materializedPlanReferences.has(reference));
}

export function materializedPlanReferencesFromPlans(
  plans: Array<{ id: string; asaasInstallmentId: string | null }>,
): Set<string> {
  return new Set(
    plans.flatMap((plan) => [plan.id, plan.asaasInstallmentId].filter((value): value is string => Boolean(value))),
  );
}
