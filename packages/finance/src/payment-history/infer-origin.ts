import { parseEventChargeExternalReference } from './event-external-reference';
import type { PaymentHistoryCategoryInput, PaymentHistoryOrigin, StandaloneChargeType } from './origin';

export function isFamilyEnrollmentFeeDescription(description?: string | null): boolean {
  return description?.trim().toLowerCase().startsWith('taxa de matrícula familiar') ?? false;
}

export function inferStandaloneChargeType(input: {
  standaloneInstallmentPlanId?: string | null;
  standaloneSubscriptionId?: string | null;
  externalReference?: string | null;
}): StandaloneChargeType {
  const externalReference = input.externalReference ?? '';

  if (
    input.standaloneInstallmentPlanId ||
    externalReference.includes(':installment:') ||
    externalReference.startsWith('installmentPlan:') ||
    externalReference.startsWith('alusa:installment:')
  ) {
    return 'INSTALLMENT';
  }

  if (
    input.standaloneSubscriptionId ||
    externalReference.includes(':subscription:') ||
    externalReference.startsWith('alusa:standalone-subscription:') ||
    externalReference.startsWith('subscription:') ||
    externalReference.startsWith('alusa:subscription:')
  ) {
    return 'SUBSCRIPTION';
  }

  return 'ONE_TIME';
}

export function resolveStandaloneChargeTipo(input: {
  standaloneInstallmentPlanId?: string | null;
  standaloneSubscriptionId?: string | null;
  externalReference?: string | null;
  familyGroupId?: string | null;
  description?: string | null;
}): 'AVULSA' | 'PARCELADA' | 'RECORRENTE' | 'TAXA_MATRICULA' {
  if (input.familyGroupId && isFamilyEnrollmentFeeDescription(input.description)) {
    return 'TAXA_MATRICULA';
  }

  const chargeType = inferStandaloneChargeType(input);
  if (chargeType === 'INSTALLMENT') return 'PARCELADA';
  if (chargeType === 'SUBSCRIPTION') return 'RECORRENTE';
  return 'AVULSA';
}

export function resolveStandalonePaymentHistoryTipo(input: {
  chargeType: StandaloneChargeType | string;
  hasSale: boolean;
  familyGroupId?: string | null;
  description?: string | null;
  externalReference?: string | null;
}): string {
  if (input.familyGroupId && isFamilyEnrollmentFeeDescription(input.description)) {
    return 'TAXA_MATRICULA';
  }

  if (parseEventChargeExternalReference(input.externalReference)) {
    return 'EVENTOS';
  }

  if (input.hasSale) return 'LOJA';

  const chargeType = input.chargeType.toUpperCase();
  if (chargeType === 'INSTALLMENT') return 'PARCELADA';
  if (chargeType === 'SUBSCRIPTION') return 'RECORRENTE';
  return 'AVULSA';
}

export function paymentHistoryInputToOrigin(input: PaymentHistoryCategoryInput): PaymentHistoryOrigin {
  const sourceKind = input.sourceKind?.toLowerCase() ?? null;

  if (sourceKind === 'sale' || input.origin === 'LOJA' || input.tipo?.toUpperCase() === 'LOJA') {
    return { kind: 'STORE_SALE' };
  }

  if (sourceKind === 'event_ticket_sale') {
    return { kind: 'EVENT_TICKET_SALE' };
  }

  if (sourceKind === 'event_participant_fee') {
    return { kind: 'EVENT_PARTICIPANT_FEE' };
  }

  if (sourceKind === 'event_financial_entry') {
    return { kind: 'EVENT_FINANCIAL_ENTRY', originType: input.originType ?? null };
  }

  if (sourceKind === 'event_map_order') {
    return { kind: 'EVENT_MAP_ORDER' };
  }

  if (sourceKind === 'cobranca' || input.origin === 'ACADEMICO') {
    return { kind: 'ACADEMIC_COBRANCA', tipo: input.tipo ?? input.chargeType ?? 'AVULSA' };
  }

  const parsedEventRef = parseEventChargeExternalReference(input.externalReference);
  if (parsedEventRef?.kind === 'event-map-order') {
    return { kind: 'EVENT_MAP_ORDER' };
  }
  if (parsedEventRef?.kind === 'event-entry') {
    return { kind: 'EVENT_FINANCIAL_ENTRY', originType: input.originType ?? 'MANUAL' };
  }

  if (input.origin === 'EVENTOS' || input.tipo?.toUpperCase() === 'EVENTOS' || input.tipo?.toUpperCase() === 'EVENTO') {
    return { kind: 'EVENT_FINANCIAL_ENTRY', originType: input.originType ?? null };
  }

  if (input.hasSale || input.origin === 'LOJA') {
    return { kind: 'STORE_SALE' };
  }

  if (sourceKind === 'charge' || input.origin === 'STANDALONE') {
    const chargeType = inferStandaloneChargeType({
      standaloneInstallmentPlanId: null,
      standaloneSubscriptionId: null,
      externalReference: input.externalReference,
    });

    const normalizedChargeType = (() => {
      const raw = input.chargeType?.toUpperCase();
      if (raw === 'INSTALLMENT' || raw === 'SUBSCRIPTION' || raw === 'ONE_TIME') {
        return raw as StandaloneChargeType;
      }
      return chargeType;
    })();

    return {
      kind: 'STANDALONE_CHARGE',
      chargeType: normalizedChargeType,
      familyGroupId: input.familyGroupId,
      description: input.description,
      externalReference: input.externalReference,
      hasSale: input.hasSale,
    };
  }

  const tipo = input.tipo?.toUpperCase() ?? null;
  const chargeType = input.chargeType?.toUpperCase() ?? null;

  if (tipo === 'LOJA' || chargeType === 'LOJA') {
    return { kind: 'STORE_SALE' };
  }

  if (tipo === 'EVENTOS' || tipo === 'EVENTO' || chargeType?.startsWith('EVENT_')) {
    if (chargeType === 'EVENT_TICKET') return { kind: 'EVENT_TICKET_SALE' };
    if (chargeType === 'EVENT_REGISTRATION_FEE') return { kind: 'EVENT_PARTICIPANT_FEE' };
    return { kind: 'EVENT_FINANCIAL_ENTRY', originType: input.originType ?? null };
  }

  if (tipo || chargeType) {
    return { kind: 'ACADEMIC_COBRANCA', tipo: tipo ?? chargeType ?? 'AVULSA' };
  }

  return {
    kind: 'STANDALONE_CHARGE',
    chargeType: 'ONE_TIME',
    familyGroupId: input.familyGroupId,
    description: input.description,
    externalReference: input.externalReference,
    hasSale: input.hasSale,
  };
}
