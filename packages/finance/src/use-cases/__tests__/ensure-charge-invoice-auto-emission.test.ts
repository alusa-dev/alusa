import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    contaFiscalSettings: { findUnique: vi.fn() },
    invoice: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
  },
  handleChargeInvoicePaymentEvent: vi.fn(),
}));

vi.mock('../../fiscal/fiscal-prisma', () => ({
  getFiscalPrisma: () => mocks.prisma,
}));

vi.mock('../handle-charge-invoice-payment-event', () => ({
  handleChargeInvoicePaymentEvent: mocks.handleChargeInvoicePaymentEvent,
}));

import { ensureChargeInvoiceAutoEmission } from '../ensure-charge-invoice-auto-emission';

describe('ensureChargeInvoiceAutoEmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispara auto emissão quando pagamento confirmado e modo ON_PAYMENT', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      asaasPaymentId: 'pay-1',
      status: 'PAID',
      asaasStatus: 'CONFIRMED',
      cobranca: { status: 'PAGO' },
    });

    await ensureChargeInvoiceAutoEmission({ contaId: 't1', chargeId: 'charge-1' });

    expect(mocks.handleChargeInvoicePaymentEvent).toHaveBeenCalledWith({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
    });
  });

  it('não emite quando modo manual', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'MANUAL' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      asaasPaymentId: 'pay-1',
      status: 'PAID',
      asaasStatus: 'CONFIRMED',
      cobranca: { status: 'PAGO' },
    });

    await ensureChargeInvoiceAutoEmission({ contaId: 't1', chargeId: 'charge-1' });

    expect(mocks.handleChargeInvoicePaymentEvent).not.toHaveBeenCalled();
  });

  it('não emite quando pagamento ainda pendente', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      asaasPaymentId: 'pay-1',
      status: 'PENDING',
      asaasStatus: 'PENDING',
      cobranca: { status: 'PENDENTE' },
    });

    await ensureChargeInvoiceAutoEmission({ contaId: 't1', chargeId: 'charge-1' });

    expect(mocks.handleChargeInvoicePaymentEvent).not.toHaveBeenCalled();
  });
});
