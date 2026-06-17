import { describe, expect, it } from 'vitest';

import { evaluateChargeInvoiceEligibility } from '../charge-invoice-eligibility';

describe('evaluateChargeInvoiceEligibility', () => {
  it('permite emitir quando pagamento Asaas esta confirmado', () => {
    const result = evaluateChargeInvoiceEligibility({
      charge: {
        status: 'PAID',
        asaasStatus: 'RECEIVED',
        asaasPaymentId: 'pay_123',
        value: 165,
      },
    });

    expect(result.canEmit).toBe(true);
    expect(result.reason).toBe('READY');
  });

  it('bloqueia cobranca pendente', () => {
    const result = evaluateChargeInvoiceEligibility({
      charge: {
        status: 'OPEN',
        asaasStatus: 'PENDING',
        asaasPaymentId: 'pay_123',
        value: 165,
      },
    });

    expect(result.canEmit).toBe(false);
    expect(result.reason).toBe('PAYMENT_NOT_CONFIRMED');
  });

  it('bloqueia cobranca estornada', () => {
    const result = evaluateChargeInvoiceEligibility({
      charge: {
        status: 'REFUNDED',
        asaasStatus: 'REFUNDED',
        asaasPaymentId: 'pay_123',
        value: 165,
      },
    });

    expect(result.canEmit).toBe(false);
    expect(result.reason).toBe('PAYMENT_REFUNDED');
    expect(result.severity).toBe('danger');
  });

  it('permite retry quando a nota esta em erro', () => {
    const result = evaluateChargeInvoiceEligibility({
      charge: {
        status: 'PAID',
        asaasStatus: 'RECEIVED',
        asaasPaymentId: 'pay_123',
        value: 165,
      },
      invoice: { status: 'ERROR', hasProviderInvoice: true },
    });

    expect(result.canEmit).toBe(true);
    expect(result.canRetry).toBe(true);
  });

  it('permite cancelamento quando ja existe nota autorizada', () => {
    const result = evaluateChargeInvoiceEligibility({
      charge: {
        status: 'PAID',
        asaasStatus: 'RECEIVED',
        asaasPaymentId: 'pay_123',
        value: 165,
      },
      invoice: { status: 'AUTHORIZED', hasProviderInvoice: true },
    });

    expect(result.canEmit).toBe(false);
    expect(result.canCancel).toBe(true);
    expect(result.reason).toBe('ALREADY_HAS_ACTIVE_INVOICE');
  });

  it('prioriza cancelamento automatico quando cobranca estornada e nota emitida', () => {
    const result = evaluateChargeInvoiceEligibility({
      charge: {
        status: 'REFUNDED',
        asaasStatus: 'REFUNDED',
        asaasPaymentId: 'pay_123',
        value: 165,
      },
      invoice: { status: 'AUTHORIZED', hasProviderInvoice: true },
    });

    expect(result.canEmit).toBe(false);
    expect(result.shouldAutoCancel).toBe(true);
    expect(result.canCancel).toBe(true);
    expect(result.reason).toBe('PAYMENT_REFUNDED');
  });
});
