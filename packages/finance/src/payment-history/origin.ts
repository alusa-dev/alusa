export type StandaloneChargeType = 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';

export type PaymentHistoryOrigin =
  | { kind: 'ACADEMIC_COBRANCA'; tipo: string }
  | {
      kind: 'STANDALONE_CHARGE';
      chargeType: StandaloneChargeType;
      familyGroupId?: string | null;
      description?: string | null;
      externalReference?: string | null;
      hasSale?: boolean;
    }
  | { kind: 'STORE_SALE' }
  | { kind: 'EVENT_TICKET_SALE' }
  | { kind: 'EVENT_PARTICIPANT_FEE' }
  | { kind: 'EVENT_FINANCIAL_ENTRY'; originType?: string | null }
  | { kind: 'EVENT_MAP_ORDER' };

export type PaymentHistoryCategoryInput = {
  tipo?: string | null;
  chargeType?: string | null;
  origin?: string | null;
  sourceKind?: string | null;
  description?: string | null;
  familyGroupId?: string | null;
  externalReference?: string | null;
  originType?: string | null;
  eventId?: string | null;
  hasSale?: boolean;
};

export type PaymentHistorySourceKind =
  | 'cobranca'
  | 'charge'
  | 'sale'
  | 'event_ticket_sale'
  | 'event_participant_fee'
  | 'event_financial_entry'
  | 'event_map_order';
