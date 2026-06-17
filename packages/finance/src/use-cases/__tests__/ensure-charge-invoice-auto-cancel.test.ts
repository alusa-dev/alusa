import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    invoice: { findFirst: vi.fn() },
    charge: { findFirst: vi.fn() },
  },
  cancelChargeInvoice: vi.fn(),
  syncInvoiceFromProvider: vi.fn(),
}));

vi.mock('../../fiscal/fiscal-prisma', () => ({
  getFiscalPrisma: () => mocks.prisma,
}));

vi.mock('../cancel-charge-invoice', () => ({
  cancelChargeInvoice: mocks.cancelChargeInvoice,
}));

vi.mock('../sync-invoice-from-provider', () => ({
  syncInvoiceFromProvider: mocks.syncInvoiceFromProvider,
}));

import { ensureChargeInvoiceAutoCancel } from '../ensure-charge-invoice-auto-cancel';

describe('ensureChargeInvoiceAutoCancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncInvoiceFromProvider.mockResolvedValue({ success: true, data: {} });
    mocks.cancelChargeInvoice.mockResolvedValue({
      success: true,
      data: { invoiceId: 'inv-1', status: 'PROCESSING_CANCELLATION' },
    });
  });

  it('cancela NFS-e emitida quando cobrança já está estornada', async () => {
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      asaasPaymentId: 'pay-1',
      status: 'REFUNDED',
      asaasStatus: 'REFUNDED',
      cobranca: { status: 'ESTORNADO' },
    });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce({ id: 'inv-1', status: 'AUTHORIZED' });

    const result = await ensureChargeInvoiceAutoCancel({ contaId: 't1', chargeId: 'charge-1' });

    expect(result.canceled).toBe(true);
    expect(mocks.cancelChargeInvoice).toHaveBeenCalledWith({
      contaId: 't1',
      chargeId: 'charge-1',
      actor: { type: 'SYSTEM' },
    });
  });

  it('não tenta cancelar novamente quando NFS-e já está em processamento', async () => {
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      asaasPaymentId: 'pay-1',
      status: 'REFUNDED',
      asaasStatus: 'REFUNDED',
      cobranca: { status: 'ESTORNADO' },
    });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      status: 'PROCESSING_CANCELLATION',
    });

    const result = await ensureChargeInvoiceAutoCancel({ contaId: 't1', chargeId: 'charge-1' });

    expect(result).toMatchObject({ canceled: false, synced: true });
    expect(mocks.cancelChargeInvoice).not.toHaveBeenCalled();
    expect(mocks.syncInvoiceFromProvider).not.toHaveBeenCalled();
  });

  it('não cancela quando pagamento não está estornado', async () => {
    mocks.prisma.charge.findFirst.mockResolvedValue({
      asaasPaymentId: 'pay-1',
      status: 'PAID',
      asaasStatus: 'CONFIRMED',
      cobranca: { status: 'PAGO' },
    });

    const result = await ensureChargeInvoiceAutoCancel({ contaId: 't1', chargeId: 'charge-1' });

    expect(result).toMatchObject({ canceled: false, skippedReason: 'PAYMENT_NOT_REFUNDED' });
    expect(mocks.prisma.invoice.findFirst).not.toHaveBeenCalled();
    expect(mocks.syncInvoiceFromProvider).not.toHaveBeenCalled();
    expect(mocks.cancelChargeInvoice).not.toHaveBeenCalled();
  });

  it('não sincroniza quando estornada mas ainda não existe NFS-e local', async () => {
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      asaasPaymentId: 'pay-1',
      status: 'REFUNDED',
      asaasStatus: 'REFUNDED',
      cobranca: { status: 'ESTORNADO' },
    });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);

    const result = await ensureChargeInvoiceAutoCancel({ contaId: 't1', chargeId: 'charge-1' });

    expect(result).toMatchObject({ canceled: false, skippedReason: 'NO_INVOICE' });
    expect(mocks.syncInvoiceFromProvider).not.toHaveBeenCalled();
    expect(mocks.cancelChargeInvoice).not.toHaveBeenCalled();
  });
});
