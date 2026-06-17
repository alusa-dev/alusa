import { parseEventChargeExternalReference } from './event-external-reference';
import type { PaymentHistorySourceKind } from './origin';

export type LedgerDedupeItem = {
  sourceKind: PaymentHistorySourceKind | string;
  sourceId: string;
  asaasPaymentId?: string | null;
  externalReference?: string | null;
};

const SOURCE_KIND_PRIORITY: Record<string, number> = {
  cobranca: 100,
  event_financial_entry: 90,
  event_map_order: 90,
  event_ticket_sale: 90,
  event_participant_fee: 90,
  sale: 80,
  charge: 50,
};

export function ledgerSourceKindPriority(sourceKind: string): number {
  return SOURCE_KIND_PRIORITY[sourceKind] ?? 0;
}

export function shouldSkipStandaloneChargeInLedger(params: {
  charge: Pick<LedgerDedupeItem, 'externalReference' | 'asaasPaymentId'>;
  coveredEventEntryIds: ReadonlySet<string>;
  coveredEventMapOrderIds: ReadonlySet<string>;
  coveredAsaasPaymentIds: ReadonlySet<string>;
}): boolean {
  const parsed = parseEventChargeExternalReference(params.charge.externalReference);
  if (parsed?.kind === 'event-entry' && params.coveredEventEntryIds.has(parsed.entityId)) {
    return true;
  }
  if (parsed?.kind === 'event-map-order' && params.coveredEventMapOrderIds.has(parsed.entityId)) {
    return true;
  }

  if (params.charge.asaasPaymentId && params.coveredAsaasPaymentIds.has(params.charge.asaasPaymentId)) {
    return true;
  }

  return false;
}

export function mergeLedgerItemsByPriority<T extends LedgerDedupeItem>(items: T[]): T[] {
  const byKey = new Map<string, T>();
  const byAsaasPaymentId = new Map<string, T>();

  for (const item of items) {
    const key = `${item.sourceKind}:${item.sourceId}`;
    const existing = byKey.get(key);
    if (!existing || ledgerSourceKindPriority(item.sourceKind) >= ledgerSourceKindPriority(existing.sourceKind)) {
      byKey.set(key, item);
    }

    if (item.asaasPaymentId) {
      const existingAsaas = byAsaasPaymentId.get(item.asaasPaymentId);
      if (
        !existingAsaas ||
        ledgerSourceKindPriority(item.sourceKind) >= ledgerSourceKindPriority(existingAsaas.sourceKind)
      ) {
        byAsaasPaymentId.set(item.asaasPaymentId, item);
      }
    }
  }

  const result: T[] = [];
  const seenAsaas = new Set<string>();

  for (const item of byKey.values()) {
    if (item.asaasPaymentId) {
      const winner = byAsaasPaymentId.get(item.asaasPaymentId);
      if (winner && winner !== item) continue;
      if (seenAsaas.has(item.asaasPaymentId)) continue;
      seenAsaas.add(item.asaasPaymentId);
    }
    result.push(item);
  }

  return result;
}
