/**
 * Teste de contrato: alinhamento entre AsaasWebhookEventType (SDK)
 * e ACCOUNT_STATUS_EVENTS (state machine interna).
 *
 * Garante que os nomes de eventos usados internamente correspondem
 * exatamente aos definidos no tipo oficial do SDK Asaas.
 */
import { describe, it, expect } from 'vitest';
import type { AsaasWebhookEventType } from '@alusa/asaas';
import {
  ACCOUNT_STATUS_EVENTS,
  ALL_ACCOUNT_STATUS_EVENTS,
} from '../../use-cases/kyc/kyc-state-machine';
import { ASAAS_EVENT_REGISTRY } from '../asaas-event-registry';

// Helper: força TypeScript a verificar que o valor é um AsaasWebhookEventType válido
function assertEventType(event: string): AsaasWebhookEventType {
  return event as AsaasWebhookEventType;
}

describe('Asaas Event Contract Alignment', () => {
  describe('ACCOUNT_STATUS_EVENTS ⟷ AsaasWebhookEventType', () => {
    it('todos os GENERAL events são AsaasWebhookEventType válidos', () => {
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED)).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED)).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.GENERAL.PENDING)).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.GENERAL.AWAITING_APPROVAL)).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL');
    });

    it('todos os DOCUMENT events são AsaasWebhookEventType válidos', () => {
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.DOCUMENT.APPROVED)).toBe('ACCOUNT_STATUS_DOCUMENT_APPROVED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.DOCUMENT.REJECTED)).toBe('ACCOUNT_STATUS_DOCUMENT_REJECTED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.DOCUMENT.PENDING)).toBe('ACCOUNT_STATUS_DOCUMENT_PENDING');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.DOCUMENT.AWAITING_APPROVAL)).toBe('ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL');
    });

    it('todos os BANK_ACCOUNT events são AsaasWebhookEventType válidos', () => {
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.APPROVED)).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.REJECTED)).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.PENDING)).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.AWAITING_APPROVAL)).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL');
    });

    it('todos os COMMERCIAL_INFO events são AsaasWebhookEventType válidos', () => {
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.APPROVED)).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.REJECTED)).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.PENDING)).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.AWAITING_APPROVAL)).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRING_SOON)).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON');
      expect(assertEventType(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRED)).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED');
    });
  });

  describe('ACCOUNT_STATUS_EVENTS ⟷ ASAAS_EVENT_REGISTRY', () => {
    it('todos os eventos em ACCOUNT_STATUS_EVENTS existem no registry', () => {
      for (const event of ALL_ACCOUNT_STATUS_EVENTS) {
        expect(ASAAS_EVENT_REGISTRY[event]).toBeDefined();
        expect(ASAAS_EVENT_REGISTRY[event].category).toBe('ACCOUNT_STATUS');
        expect(ASAAS_EVENT_REGISTRY[event].handled).toBe(true);
      }
    });

    it('todos os eventos ACCOUNT_STATUS no registry estão em ALL_ACCOUNT_STATUS_EVENTS', () => {
      const registryAccountEvents = Object.entries(ASAAS_EVENT_REGISTRY)
        .filter(([, def]) => def.category === 'ACCOUNT_STATUS')
        .map(([name]) => name);

      for (const event of registryAccountEvents) {
        expect(ALL_ACCOUNT_STATUS_EVENTS.has(event)).toBe(true);
      }
    });
  });

  describe('nenhum evento usa padrão antigo DOCUMENTATION_*', () => {
    it('ACCOUNT_STATUS_EVENTS não contém DOCUMENTATION_ substring', () => {
      for (const event of ALL_ACCOUNT_STATUS_EVENTS) {
        expect(event).not.toContain('DOCUMENTATION_');
      }
    });

    it('ASAAS_EVENT_REGISTRY não contém chaves com DOCUMENTATION_', () => {
      const keys = Object.keys(ASAAS_EVENT_REGISTRY);
      const documentationKeys = keys.filter((k) => k.includes('DOCUMENTATION_'));
      expect(documentationKeys).toEqual([]);
    });
  });
});
