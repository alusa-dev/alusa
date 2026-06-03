'use client';

import { type EventCostumeAssignmentBillingMode } from '@alusa/shared';

import { formatCurrency, type CostumeAssignmentDTO } from '../events-service';
import { EventSoftBadge as SoftBadge } from '../shared/EventSoftBadge';

export const COSTUME_BILLING_MODES: EventCostumeAssignmentBillingMode[] = [
  'INCLUDED_IN_REGISTRATION_FEE',
  'SEPARATE_CHARGE',
  'FREE',
];

export const COSTUME_BILLING_LABELS: Record<EventCostumeAssignmentBillingMode, string> = {
  INCLUDED_IN_REGISTRATION_FEE: 'Incluso na taxa de inscrição',
  SEPARATE_CHARGE: 'Cobrar separadamente',
  FREE: 'Sem cobrança',
};

export const COSTUME_BILLING_OPTIONS = COSTUME_BILLING_MODES.map((mode) => ({
  value: mode,
  label: COSTUME_BILLING_LABELS[mode],
}));

export function getCostumeAssignmentFinancialBadge(assignment: CostumeAssignmentDTO) {
  if (assignment.billingMode === 'INCLUDED_IN_REGISTRATION_FEE') {
    return <SoftBadge tone="info">Incluso</SoftBadge>;
  }
  if (assignment.billingMode === 'FREE') {
    return <SoftBadge tone="neutral">Sem cobrança</SoftBadge>;
  }
  return assignment.isPaid ? <SoftBadge tone="success">Pago</SoftBadge> : <SoftBadge tone="warning">Pendente</SoftBadge>;
}

export function getCostumeAssignmentValueLabel(assignment: CostumeAssignmentDTO) {
  if (assignment.billingMode === 'FREE') return '-';
  if (assignment.billingMode === 'INCLUDED_IN_REGISTRATION_FEE') return 'Incluso';
  return formatCurrency(assignment.chargedValue ?? 0);
}
