import { type EventFinancialEntryStatus, type EventFinancialEntryType } from '@alusa/shared';

import type { FinancialEntryDTO } from '../events-service';
import type { EventSoftBadgeTone } from '../shared/EventSoftBadge';

export const FINANCIAL_STATUS_OPTIONS: Record<EventFinancialEntryType, EventFinancialEntryStatus[]> = {
  COST: ['EXPECTED', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  REVENUE: ['EXPECTED', 'PENDING', 'RECEIVED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED'],
};

export const FINANCIAL_STATUS_TONES: Record<EventFinancialEntryStatus, EventSoftBadgeTone> = {
  EXPECTED: 'neutral',
  PENDING: 'warning',
  PAID: 'success',
  PARTIALLY_PAID: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
  REFUNDED: 'neutral',
  PARTIALLY_REFUNDED: 'warning',
};

export function toCurrencyInputText(value?: number | null) {
  if (value == null) return '';
  return value.toFixed(2).replace('.', ',');
}

export function isFinancialRealized(status: EventFinancialEntryStatus) {
  return status === 'PAID' || status === 'RECEIVED' || status === 'PARTIALLY_REFUNDED' || status === 'REFUNDED';
}

export function getFinancialOriginLabel(entry: FinancialEntryDTO) {
  if (entry.originType === 'MANUAL') return 'Manual';
  if (entry.originType === 'EVENT_REGISTRATION') return 'Inscrição';
  if (entry.originType === 'TICKET_SALE') return 'Venda de ingresso';
  if (entry.originType === 'COSTUME_ASSIGNMENT') return 'Vínculo de figurino';
  if (entry.originType === 'COSTUME') return entry.originId?.startsWith('loss:') ? 'Prejuízo de figurino' : 'Figurino';
  return 'Automática';
}

export function getFinancialOriginActionLabel(entry: FinancialEntryDTO) {
  if (entry.originType === 'EVENT_REGISTRATION') return 'Ajuste pela inscrição do evento';
  if (entry.originType === 'TICKET_SALE') return 'Ajuste pela venda de ingresso';
  if (entry.originType === 'COSTUME_ASSIGNMENT') return 'Ajuste pelo vínculo do figurino';
  if (entry.originType === 'COSTUME') return entry.originId?.startsWith('loss:')
    ? 'Ajuste pelo status do figurino'
    : 'Ajuste pelo figurino';
  return 'Ajuste pela origem';
}
