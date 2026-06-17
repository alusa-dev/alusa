import { describe, expect, it } from 'vitest';

import {
  inferStandaloneChargeType,
  isFamilyEnrollmentFeeDescription,
  parseEventChargeExternalReference,
  paymentHistoryInputToOrigin,
  resolvePaymentHistoryCategory,
  resolveStandaloneChargeTipo,
  resolveStandalonePaymentHistoryTipo,
  normalizePaymentHistoryCategory,
  resolvePaymentHistoryDetailHref,
  shouldSkipStandaloneChargeInLedger,
  mergeLedgerItemsByPriority,
} from '../index';

describe('payment-history', () => {
  describe('parseEventChargeExternalReference', () => {
    it('identifica referencias de evento', () => {
      expect(parseEventChargeExternalReference('event-map-order:order-1')).toEqual({
        kind: 'event-map-order',
        entityId: 'order-1',
      });
      expect(parseEventChargeExternalReference('event-entry:entry-1')).toEqual({
        kind: 'event-entry',
        entityId: 'entry-1',
      });
      expect(parseEventChargeExternalReference('alusa:standalone:1')).toBeNull();
    });
  });

  describe('resolvePaymentHistoryCategory', () => {
    it('mapeia origens academicas', () => {
      expect(resolvePaymentHistoryCategory({ kind: 'ACADEMIC_COBRANCA', tipo: 'MENSALIDADE' })).toBe('MENSALIDADE');
      expect(resolvePaymentHistoryCategory({ kind: 'ACADEMIC_COBRANCA', tipo: 'PARCELADA' })).toBe('PARCELAMENTO');
      expect(resolvePaymentHistoryCategory({ kind: 'ACADEMIC_COBRANCA', tipo: 'RECORRENTE' })).toBe('ASSINATURA');
      expect(resolvePaymentHistoryCategory({ kind: 'ACADEMIC_COBRANCA', tipo: 'EXTRA' })).toBe('OUTROS');
    });

    it('mapeia origens de evento', () => {
      expect(resolvePaymentHistoryCategory({ kind: 'EVENT_MAP_ORDER' })).toBe('EVENTOS');
      expect(resolvePaymentHistoryCategory({ kind: 'EVENT_FINANCIAL_ENTRY', originType: 'COSTUME_ASSIGNMENT' })).toBe(
        'EVENTOS',
      );
      expect(resolvePaymentHistoryCategory({ kind: 'EVENT_TICKET_SALE' })).toBe('EVENTOS');
    });

    it('mapeia standalone por chargeType e referencia externa', () => {
      expect(
        resolvePaymentHistoryCategory({
          kind: 'STANDALONE_CHARGE',
          chargeType: 'SUBSCRIPTION',
        }),
      ).toBe('ASSINATURA');
      expect(
        resolvePaymentHistoryCategory({
          kind: 'STANDALONE_CHARGE',
          chargeType: 'ONE_TIME',
          externalReference: 'event-map-order:order-1',
        }),
      ).toBe('EVENTOS');
      expect(
        resolvePaymentHistoryCategory({
          kind: 'STANDALONE_CHARGE',
          chargeType: 'ONE_TIME',
          familyGroupId: 'family-1',
          description: 'Taxa de matrícula familiar · Vera',
        }),
      ).toBe('TAXA_MATRICULA');
    });
  });

  describe('normalizePaymentHistoryCategory', () => {
    it('normaliza entradas legadas do ledger', () => {
      expect(normalizePaymentHistoryCategory({ tipo: 'MENSALIDADE' })).toBe('MENSALIDADE');
      expect(normalizePaymentHistoryCategory({ sourceKind: 'sale', tipo: 'LOJA' })).toBe('LOJA');
      expect(normalizePaymentHistoryCategory({ sourceKind: 'event_ticket_sale', origin: 'EVENTOS' })).toBe('EVENTOS');
      expect(normalizePaymentHistoryCategory({ sourceKind: 'event_map_order', origin: 'EVENTOS' })).toBe('EVENTOS');
      expect(normalizePaymentHistoryCategory({ sourceKind: 'event_financial_entry', originType: 'COSTUME_ASSIGNMENT' })).toBe(
        'EVENTOS',
      );
      expect(normalizePaymentHistoryCategory({ tipo: 'AVULSA' })).toBe('OUTROS');
      expect(
        normalizePaymentHistoryCategory({
          sourceKind: 'charge',
          chargeType: 'ONE_TIME',
          externalReference: 'event-entry:entry-1',
        }),
      ).toBe('EVENTOS');
    });
  });

  describe('resolveStandaloneChargeTipo', () => {
    it('classifica cobrancas standalone', () => {
      expect(
        resolveStandaloneChargeTipo({
          familyGroupId: 'family-1',
          description: 'Taxa de matrícula familiar · Vera',
        }),
      ).toBe('TAXA_MATRICULA');
      expect(
        resolveStandaloneChargeTipo({
          externalReference: 'alusa:installment:plan-1:payment:pay-1',
        }),
      ).toBe('PARCELADA');
      expect(
        resolveStandalonePaymentHistoryTipo({
          chargeType: 'ONE_TIME',
          hasSale: false,
          externalReference: 'event-map-order:order-1',
        }),
      ).toBe('EVENTOS');
    });
  });

  describe('isFamilyEnrollmentFeeDescription', () => {
    it('detecta taxa familiar pela descricao', () => {
      expect(isFamilyEnrollmentFeeDescription('Taxa de matrícula familiar · Vera')).toBe(true);
      expect(isFamilyEnrollmentFeeDescription('Mensalidade familiar')).toBe(false);
    });
  });

  describe('resolvePaymentHistoryDetailHref', () => {
    it('prioriza detalhe especifico de evento quando eventId existe', () => {
      expect(
        resolvePaymentHistoryDetailHref({
          sourceKind: 'event_ticket_sale',
          sourceId: 'sale-1',
          category: 'EVENTOS',
          eventId: 'event-1',
        }),
      ).toBe('/events/event-1');
    });
  });

  describe('ledger dedupe helpers', () => {
    it('ignora charge standalone duplicada de entidade de evento', () => {
      expect(
        shouldSkipStandaloneChargeInLedger({
          charge: { externalReference: 'event-map-order:order-1', asaasPaymentId: 'pay-1' },
          coveredEventEntryIds: new Set(),
          coveredEventMapOrderIds: new Set(['order-1']),
          coveredAsaasPaymentIds: new Set(),
        }),
      ).toBe(true);
    });

    it('prioriza entidade de dominio sobre charge no merge', () => {
      const merged = mergeLedgerItemsByPriority([
        { sourceKind: 'charge', sourceId: 'charge-1', asaasPaymentId: 'pay-1' },
        { sourceKind: 'event_map_order', sourceId: 'order-1', asaasPaymentId: 'pay-1' },
      ]);

      expect(merged).toHaveLength(1);
      expect(merged[0]?.sourceKind).toBe('event_map_order');
    });
  });

  describe('paymentHistoryInputToOrigin', () => {
    it('converte sourceKind cobranca para origem academica', () => {
      expect(
        paymentHistoryInputToOrigin({
          sourceKind: 'cobranca',
          origin: 'ACADEMICO',
          tipo: 'TAXA_MATRICULA',
        }),
      ).toEqual({ kind: 'ACADEMIC_COBRANCA', tipo: 'TAXA_MATRICULA' });
    });
  });
});
