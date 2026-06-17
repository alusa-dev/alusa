import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    charge: { findFirst: vi.fn() },
    contaFiscalSettings: { findUnique: vi.fn() },
    invoice: { findFirst: vi.fn() },
  },
  emitChargeInvoice: vi.fn(),
}));

vi.mock('../../fiscal/fiscal-prisma', () => ({
  getFiscalPrisma: () => mocks.prisma,
}));

vi.mock('../emit-charge-invoice', () => ({
  emitChargeInvoice: mocks.emitChargeInvoice,
}));

vi.mock('../cancel-charge-invoice', () => ({
  cancelChargeInvoice: vi.fn(),
}));

vi.mock('../../foundation/audit-log.service', () => ({
  auditLogService: { record: vi.fn() },
}));

import { handleChargeInvoicePaymentEvent } from '../handle-charge-invoice-payment-event';

describe('handleChargeInvoicePaymentEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não emite pela Alusa quando assinatura já usa invoiceSettings nativo no Asaas', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      id: 'charge-1',
      standaloneSubscription: { asaasInvoiceSettingsConfigured: true },
      cobranca: null,
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
    });

    expect(result.handled).toBe(true);
    expect(result.action).toBe('SKIPPED');
    expect(result.reason).toBe('SUBSCRIPTION_NATIVE_EMISSION');
    expect(mocks.emitChargeInvoice).not.toHaveBeenCalled();
  });
});
