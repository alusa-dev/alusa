import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    charge: { findFirst: vi.fn() },
    subscription: { findFirst: vi.fn() },
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

import { cancelChargeInvoice } from '../cancel-charge-invoice';
import { handleChargeInvoicePaymentEvent } from '../handle-charge-invoice-payment-event';

describe('handleChargeInvoicePaymentEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emitChargeInvoice.mockResolvedValue({
      success: true,
      data: { invoice: { id: 'inv-auto-1' } },
    });
  });

  it('emite pela Alusa quando taxa de matrícula paga pertence a matrícula com assinatura fiscal nativa', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      id: 'charge-1',
      standaloneSubscriptionId: null,
      standaloneSubscription: null,
      cobranca: { tipo: 'TAXA_MATRICULA', matriculaId: 'mat-1' },
    });
    mocks.prisma.subscription.findFirst.mockResolvedValueOnce({
      asaasSubscriptionId: 'sub-academic-1',
      asaasInvoiceSettingsConfigured: true,
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-taxa-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
      asaasPaymentSubscription: null,
    });

    expect(result).toMatchObject({ handled: true, action: 'AUTO_EMIT', invoiceId: 'inv-auto-1' });
    expect(mocks.emitChargeInvoice).toHaveBeenCalledWith({
      contaId: 't1',
      chargeId: 'charge-1',
      actor: { type: 'SYSTEM' },
    });
  });

  it('não emite pela Alusa quando mensalidade paga é da assinatura com invoiceSettings nativo no Asaas', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      id: 'charge-1',
      standaloneSubscriptionId: null,
      standaloneSubscription: null,
      cobranca: { tipo: 'MENSALIDADE', matriculaId: 'mat-1' },
    });
    mocks.prisma.subscription.findFirst.mockResolvedValueOnce({
      asaasSubscriptionId: 'sub-academic-1',
      asaasInvoiceSettingsConfigured: true,
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
      asaasPaymentSubscription: 'sub-academic-1',
    });

    expect(result.handled).toBe(true);
    expect(result.action).toBe('SKIPPED');
    expect(result.reason).toBe('SUBSCRIPTION_NATIVE_EMISSION');
    expect(mocks.emitChargeInvoice).not.toHaveBeenCalled();
  });

  it('emite pela Alusa quando mensalidade tem assinatura configurada mas o pagamento aponta outra assinatura', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      id: 'charge-1',
      standaloneSubscriptionId: null,
      standaloneSubscription: null,
      cobranca: { tipo: 'MENSALIDADE', matriculaId: 'mat-1' },
    });
    mocks.prisma.subscription.findFirst.mockResolvedValueOnce({
      asaasSubscriptionId: 'sub-academic-1',
      asaasInvoiceSettingsConfigured: true,
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
      asaasPaymentSubscription: 'sub-other',
    });

    expect(result.action).toBe('AUTO_EMIT');
    expect(mocks.emitChargeInvoice).toHaveBeenCalledTimes(1);
  });

  it.each(['AVULSA', 'EXTRA', 'PARCELADA'])(
    'emite pela Alusa para cobrança %s paga',
    async (tipo) => {
      mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
      mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
      mocks.prisma.charge.findFirst.mockResolvedValueOnce({
        id: 'charge-1',
        standaloneSubscriptionId: null,
        standaloneSubscription: null,
        cobranca: { tipo, matriculaId: tipo === 'PARCELADA' ? 'mat-1' : null },
      });
      if (tipo === 'PARCELADA') {
        mocks.prisma.subscription.findFirst.mockResolvedValueOnce({
          asaasSubscriptionId: 'sub-academic-1',
          asaasInvoiceSettingsConfigured: true,
        });
      }

      const result = await handleChargeInvoicePaymentEvent({
        contaId: 't1',
        chargeId: 'charge-1',
        asaasPaymentId: `pay-${tipo}`,
        event: 'PAYMENT_CONFIRMED',
        providerStatus: 'CONFIRMED',
      });

      expect(result.action).toBe('AUTO_EMIT');
      expect(mocks.emitChargeInvoice).toHaveBeenCalledTimes(1);
    },
  );

  it('não emite pela Alusa quando pagamento é de assinatura standalone com invoiceSettings nativo', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      id: 'charge-standalone-sub',
      standaloneSubscriptionId: 'standalone-sub-1',
      standaloneSubscription: {
        asaasSubscriptionId: 'sub-standalone-1',
        asaasInvoiceSettingsConfigured: true,
      },
      cobranca: null,
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-standalone-sub',
      asaasPaymentId: 'pay-standalone-sub',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
      asaasPaymentSubscription: 'sub-standalone-1',
    });

    expect(result.action).toBe('SKIPPED');
    expect(result.reason).toBe('SUBSCRIPTION_NATIVE_EMISSION');
    expect(mocks.emitChargeInvoice).not.toHaveBeenCalled();
  });

  it('emite pela Alusa para cobrança standalone avulsa da mesma conta sem vínculo de assinatura', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({
      id: 'charge-one-time',
      standaloneSubscriptionId: null,
      standaloneSubscription: null,
      cobranca: null,
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-one-time',
      asaasPaymentId: 'pay-one-time',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
    });

    expect(result.action).toBe('AUTO_EMIT');
    expect(mocks.emitChargeInvoice).toHaveBeenCalledTimes(1);
  });

  it('não auto-emite quando emissionMode é MANUAL', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'MANUAL' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce(null);

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
    });

    expect(result.action).toBe('SKIPPED');
    expect(result.reason).toBe('AUTO_EMISSION_DISABLED');
    expect(mocks.emitChargeInvoice).not.toHaveBeenCalled();
    expect(mocks.prisma.charge.findFirst).not.toHaveBeenCalled();
  });

  it('não auto-emite quando já existe nota ativa', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      status: 'SCHEDULED',
      asaasInvoiceId: 'asaas-inv-1',
    });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_CONFIRMED',
      providerStatus: 'CONFIRMED',
    });

    expect(result).toMatchObject({
      handled: true,
      action: 'SKIPPED',
      invoiceId: 'inv-1',
      reason: 'INVOICE_ALREADY_EXISTS',
    });
    expect(mocks.emitChargeInvoice).not.toHaveBeenCalled();
  });

  it('ignora estorno quando NFS-e já está em processamento de cancelamento', async () => {
    mocks.prisma.contaFiscalSettings.findUnique.mockResolvedValueOnce({ emissionMode: 'ON_PAYMENT' });
    mocks.prisma.invoice.findFirst.mockResolvedValueOnce({
      id: 'inv-1',
      status: 'PROCESSING_CANCELLATION',
      asaasInvoiceId: 'asaas-inv-1',
    });
    mocks.prisma.charge.findFirst.mockResolvedValueOnce({ id: 'charge-1' });

    const result = await handleChargeInvoicePaymentEvent({
      contaId: 't1',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      event: 'PAYMENT_REFUNDED',
      providerStatus: 'REFUNDED',
    });

    expect(result).toMatchObject({
      handled: true,
      action: 'SKIPPED',
      reason: 'INVOICE_CANCEL_IN_PROGRESS',
      invoiceId: 'inv-1',
    });
    expect(cancelChargeInvoice).not.toHaveBeenCalled();
  });
});
