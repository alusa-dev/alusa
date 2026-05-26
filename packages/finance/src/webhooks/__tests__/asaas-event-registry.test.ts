import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

import { prisma } from '@alusa/database';

import {
  ASAAS_EVENT_REGISTRY,
  getRegistryStats,
  getHandledEvents,
  getUnhandledEvents,
  getCriticalEvents,
  isKnownEvent,
  isHandledEvent,
  getEventsByCategory,
  getWebhookEventPolicies,
  getWebhookEventPolicy,
  shouldAlertUnknownWebhookEvent,
} from '../asaas-event-registry';
import { PROVISIONED_WEBHOOK_EVENTS } from '../webhook-provisioning-events';

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    getMyAccountDocuments: vi.fn(),
  };
});

vi.mock('@alusa/database', async () => {
  const actual = await vi.importActual<typeof import('@alusa/database')>('@alusa/database');
  return {
    ...actual,
    prisma: actual.prisma,
    loadAsaasCredentials: vi.fn(async () => ({
      apiKey: 'sandbox_x',
      apiKeyStatus: 'CONNECTED',
      source: 'conta_legacy',
      webhookSecret: null,
    })),
  };
});

describe('Asaas Event Registry', () => {
  describe('Registry completeness', () => {
    it('deve ter todos os eventos PAYMENT definidos', () => {
      const paymentEvents = [
        'PAYMENT_CREATED',
        'PAYMENT_AWAITING_RISK_ANALYSIS',
        'PAYMENT_APPROVED_BY_RISK_ANALYSIS',
        'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
        'PAYMENT_AUTHORIZED',
        'PAYMENT_UPDATED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED',
        'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
        'PAYMENT_ANTICIPATED',
        'PAYMENT_OVERDUE',
        'PAYMENT_DELETED',
        'PAYMENT_RESTORED',
        'PAYMENT_REFUNDED',
        'PAYMENT_PARTIALLY_REFUNDED',
        'PAYMENT_REFUND_IN_PROGRESS',
        'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        'PAYMENT_CHARGEBACK_REQUESTED',
        'PAYMENT_CHARGEBACK_DISPUTE',
        'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        'PAYMENT_DUNNING_RECEIVED',
        'PAYMENT_DUNNING_REQUESTED',
        'PAYMENT_BANK_SLIP_VIEWED',
        'PAYMENT_CHECKOUT_VIEWED',
        'PAYMENT_SPLIT_DIVERGENCE_BLOCK',
        'PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED',
        'PAYMENT_REFUND_DENIED',
        'PAYMENT_BANK_SLIP_CANCELLED',
        'PAYMENT_SPLIT_CANCELLED',
      ];

      for (const event of paymentEvents) {
        expect(isKnownEvent(event), `Evento ${event} deve estar registrado`).toBe(true);
      }
    });

    it('deve ter todos os eventos SUBSCRIPTION definidos', () => {
      const subscriptionEvents = [
        'SUBSCRIPTION_CREATED',
        'SUBSCRIPTION_UPDATED',
        'SUBSCRIPTION_INACTIVATED',
        'SUBSCRIPTION_DELETED',
        'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK',
        'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED',
      ];

      for (const event of subscriptionEvents) {
        expect(isKnownEvent(event), `Evento ${event} deve estar registrado`).toBe(true);
      }
    });

    it('deve ter todos os eventos TRANSFER definidos', () => {
      const transferEvents = [
        'TRANSFER_CREATED',
        'TRANSFER_PENDING',
        'TRANSFER_IN_BANK_PROCESSING',
        'TRANSFER_BLOCKED',
        'TRANSFER_DONE',
        'TRANSFER_FAILED',
        'TRANSFER_CANCELLED',
      ];

      for (const event of transferEvents) {
        expect(isKnownEvent(event), `Evento ${event} deve estar registrado`).toBe(true);
      }
    });

    it('deve ter todos os eventos ACCOUNT_STATUS definidos', () => {
      const accountEvents = [
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
        'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
        'ACCOUNT_STATUS_DOCUMENT_APPROVED',
        'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_DOCUMENT_PENDING',
        'ACCOUNT_STATUS_DOCUMENT_REJECTED',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
      ];

      for (const event of accountEvents) {
        expect(isKnownEvent(event), `Evento ${event} deve estar registrado`).toBe(true);
      }
    });

    it('deve ter todos os eventos INTERNAL_TRANSFER definidos', () => {
      const internalTransferEvents = ['INTERNAL_TRANSFER_CREDIT', 'INTERNAL_TRANSFER_DEBIT'];

      for (const event of internalTransferEvents) {
        expect(isKnownEvent(event), `Evento ${event} deve estar registrado`).toBe(true);
      }
    });
  });

  describe('Handler coverage', () => {
    it('deve ter handlers para todos os eventos críticos de PAYMENT', () => {
      const criticalPaymentEvents = [
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED',
        'PAYMENT_OVERDUE',
        'PAYMENT_REFUNDED',
        'PAYMENT_CHARGEBACK_REQUESTED',
        'PAYMENT_DUNNING_RECEIVED',
      ];

      for (const event of criticalPaymentEvents) {
        expect(isHandledEvent(event), `Evento crítico ${event} deve ter handler`).toBe(true);
        expect(ASAAS_EVENT_REGISTRY[event].impactLevel).toBe('critical');
      }
    });

    it('deve ter handlers para todos os eventos críticos de SUBSCRIPTION', () => {
      const criticalSubscriptionEvents = ['SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED'];

      for (const event of criticalSubscriptionEvents) {
        expect(isHandledEvent(event), `Evento crítico ${event} deve ter handler`).toBe(true);
        expect(ASAAS_EVENT_REGISTRY[event].impactLevel).toBe('critical');
      }
    });

    it('deve ter handlers para todos os eventos de ACCOUNT_STATUS que impactam operação', () => {
      const criticalAccountEvents = [
        'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
        'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
        'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
      ];

      for (const event of criticalAccountEvents) {
        expect(isHandledEvent(event), `Evento crítico ${event} deve ter handler`).toBe(true);
      }
    });

    it('não deve ter handlers para eventos que não afetam fluxo Alusa', () => {
      const nonAlusaEvents = [
        'INVOICE_CREATED',
        'BILL_CREATED',
        'MOBILE_PHONE_RECHARGE_PENDING',
        'CHECKOUT_CREATED',
      ];

      for (const event of nonAlusaEvents) {
        expect(isHandledEvent(event), `Evento ${event} não deve ter handler`).toBe(false);
      }
    });
  });

  describe('Registry helpers', () => {
    it('getRegistryStats deve retornar estatísticas corretas', () => {
      const stats = getRegistryStats();

      expect(stats.total).toBeGreaterThan(50);
      expect(stats.handled).toBeGreaterThan(30);
      expect(stats.unhandled).toBeGreaterThan(0);
      expect(stats.critical).toBeGreaterThan(10);
      expect(stats.handled + stats.unhandled).toBe(stats.total);
    });

    it('getHandledEvents deve retornar apenas eventos com handler', () => {
      const handled = getHandledEvents();

      for (const event of handled) {
        expect(ASAAS_EVENT_REGISTRY[event].handled).toBe(true);
        expect(ASAAS_EVENT_REGISTRY[event].handler).not.toBeNull();
      }
    });

    it('getUnhandledEvents deve retornar apenas eventos sem handler', () => {
      const unhandled = getUnhandledEvents();

      for (const event of unhandled) {
        expect(ASAAS_EVENT_REGISTRY[event].handled).toBe(false);
        expect(ASAAS_EVENT_REGISTRY[event].handler).toBeNull();
      }
    });

    it('getCriticalEvents deve retornar todos os eventos críticos', () => {
      const critical = getCriticalEvents();

      for (const event of critical) {
        expect(ASAAS_EVENT_REGISTRY[event].impactLevel).toBe('critical');
      }
    });

    it('getEventsByCategory deve retornar eventos da categoria correta', () => {
      const paymentEvents = getEventsByCategory('PAYMENT');
      const subscriptionEvents = getEventsByCategory('SUBSCRIPTION');

      expect(paymentEvents.length).toBeGreaterThan(20);
      expect(subscriptionEvents.length).toBeGreaterThanOrEqual(6);

      for (const event of paymentEvents) {
        expect(ASAAS_EVENT_REGISTRY[event].category).toBe('PAYMENT');
      }

      for (const event of subscriptionEvents) {
        expect(ASAAS_EVENT_REGISTRY[event].category).toBe('SUBSCRIPTION');
      }
    });

    it('isKnownEvent deve retornar false para eventos desconhecidos', () => {
      expect(isKnownEvent('UNKNOWN_EVENT')).toBe(false);
      expect(isKnownEvent('PAYMENT_UNKNOWN')).toBe(false);
      expect(isKnownEvent('')).toBe(false);
    });
  });

  describe('Invariantes de negócio', () => {
    it('eventos de PAYMENT que mudam status financeiro devem requerer sync', () => {
      const statusChangingEvents = [
        'PAYMENT_CONFIRMED',
        'PAYMENT_RECEIVED',
        'PAYMENT_OVERDUE',
        'PAYMENT_REFUNDED',
        'PAYMENT_DELETED',
      ];

      for (const event of statusChangingEvents) {
        expect(
          ASAAS_EVENT_REGISTRY[event].requiresSync,
          `Evento ${event} deve requerer sync`
        ).toBe(true);
      }
    });

    it('eventos informativos não devem requerer sync', () => {
      const infoEvents = ['PAYMENT_BANK_SLIP_VIEWED', 'PAYMENT_CHECKOUT_VIEWED'];

      for (const event of infoEvents) {
        expect(
          ASAAS_EVENT_REGISTRY[event].requiresSync,
          `Evento ${event} não deve requerer sync`
        ).toBe(false);
        expect(ASAAS_EVENT_REGISTRY[event].impactLevel).toBe('info');
      }
    });

    it('todos os eventos handled devem ter handler definido', () => {
      for (const [event, def] of Object.entries(ASAAS_EVENT_REGISTRY)) {
        if (def.handled) {
          expect(def.handler, `Evento ${event} handled deve ter handler`).not.toBeNull();
        } else {
          expect(def.handler, `Evento ${event} não handled deve ter handler null`).toBeNull();
        }
      }
    });

    it('todos os eventos críticos devem ser handled', () => {
      const critical = getCriticalEvents();
      const unhandledCritical = critical.filter((e) => !isHandledEvent(e));

      // Listar eventos críticos sem handler para diagnóstico
      if (unhandledCritical.length > 0) {
        console.warn('⚠️ Eventos críticos sem handler:', unhandledCritical);
      }

      expect(unhandledCritical.length, 'Todos os eventos críticos devem ter handler').toBe(0);
    });

    it('todos os eventos handled devem ser provisionados no webhook da subconta', () => {
      expect(PROVISIONED_WEBHOOK_EVENTS).toEqual(getHandledEvents());
    });

    it('todos os eventos registrados devem ter política operacional canônica', () => {
      const policies = getWebhookEventPolicies();

      expect(policies).toHaveLength(Object.keys(ASAAS_EVENT_REGISTRY).length);
      expect(policies).toMatchSnapshot();

      for (const policy of policies) {
        expect(policy.event).toBeTruthy();
        expect(policy.category).toBeTruthy();
        expect(policy.handlingMode).toBeTruthy();
        expect(policy.criticality).toBeTruthy();
        expect(policy.mustProvision).toBe(isHandledEvent(policy.event));
      }
    });

    it('eventos financeiros críticos mudam estado e devem ser provisionados', () => {
      expect(getWebhookEventPolicy('PAYMENT_CONFIRMED')).toMatchObject({
        category: 'PAYMENT',
        handlingMode: 'STATE_CHANGE',
        criticality: 'CRITICAL',
        mustProvision: true,
        requiresReconciliation: true,
      });

      expect(getWebhookEventPolicy('SUBSCRIPTION_DELETED')).toMatchObject({
        category: 'SUBSCRIPTION',
        handlingMode: 'STATE_CHANGE',
        criticality: 'CRITICAL',
        mustProvision: true,
        requiresReconciliation: true,
      });
    });

    it('evento desconhecido deve virar alerta operacional', () => {
      expect(getWebhookEventPolicy('ASAAS_NEW_CRITICAL_EVENT')).toMatchObject({
        category: 'AUDIT_ONLY',
        handlingMode: 'UNKNOWN_ALERT',
        criticality: 'HIGH',
        mustProvision: false,
        requiresReconciliation: true,
      });
      expect(shouldAlertUnknownWebhookEvent('ASAAS_NEW_CRITICAL_EVENT')).toBe(true);
    });
  });
});
