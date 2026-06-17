import { describe, expect, it } from 'vitest';

import {
  isAllowedInvoiceStatusTransition,
  isInvoiceProviderSyncPending,
  mapAsaasInvoiceStatusToInternal,
  mapInvoiceWebhookEventToStatus,
} from '../invoice-status.mapper';

describe('invoice-status.mapper', () => {
  it('mapeia status Asaas 1:1', () => {
    expect(mapAsaasInvoiceStatusToInternal('SCHEDULED')).toBe('SCHEDULED');
    expect(mapAsaasInvoiceStatusToInternal('SYNCHRONIZED')).toBe('SYNCHRONIZED');
    expect(mapAsaasInvoiceStatusToInternal('AUTHORIZED')).toBe('AUTHORIZED');
  });

  it('mapeia eventos de webhook', () => {
    expect(mapInvoiceWebhookEventToStatus('INVOICE_AUTHORIZED')).toBe('AUTHORIZED');
    expect(mapInvoiceWebhookEventToStatus('INVOICE_SYNCHRONIZED')).toBe('SYNCHRONIZED');
  });

  it('bloqueia regressão de status', () => {
    expect(isAllowedInvoiceStatusTransition('AUTHORIZED', 'SCHEDULED')).toBe(false);
    expect(isAllowedInvoiceStatusTransition('SCHEDULED', 'SYNCHRONIZED')).toBe(true);
  });

  it('permite transição para ERROR', () => {
    expect(isAllowedInvoiceStatusTransition('AUTHORIZED', 'ERROR')).toBe(true);
  });

  it('marca emissão e cancelamento em processamento como pendentes de sincronização', () => {
    expect(
      isInvoiceProviderSyncPending({
        status: 'SYNCHRONIZED',
        hasProviderInvoice: true,
      }),
    ).toBe(true);
    expect(
      isInvoiceProviderSyncPending({
        status: 'PROCESSING_CANCELLATION',
        hasProviderInvoice: true,
      }),
    ).toBe(true);
  });

  it('não mantém polling para estados terminais', () => {
    expect(
      isInvoiceProviderSyncPending({
        status: 'CANCELED',
        hasProviderInvoice: true,
      }),
    ).toBe(false);
    expect(
      isInvoiceProviderSyncPending({
        status: 'AUTHORIZED',
        hasProviderInvoice: true,
      }),
    ).toBe(false);
  });
});
