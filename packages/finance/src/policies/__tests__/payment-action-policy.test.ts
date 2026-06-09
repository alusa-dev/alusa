import { describe, expect, it } from 'vitest';
import { evaluatePaymentActionPolicy } from '../payment-action-policy';

describe('PaymentActionPolicy', () => {
  it('permite editar e cancelar cobrança avulsa pendente no Asaas', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'CHARGE',
      origin: 'STANDALONE',
      localStatus: 'OPEN',
      asaasStatus: 'PENDING',
      billingType: 'PIX',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
    });

    expect(policy.canEdit).toBe(true);
    expect(policy.canCancel).toBe(true);
    expect(policy.canRefund).toBe(false);
    expect(policy.canChangePayer).toBe(false);
    expect(policy.actions.CHANGE_PAYER.code).toBe('CHANGE_PAYER_NOT_ALLOWED');
  });

  it('permite editar cobrança vencida porque o Asaas permite atualizar OVERDUE', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: 'ACADEMIC',
      localStatus: 'ATRASADO',
      asaasStatus: 'OVERDUE',
      billingType: 'BOLETO',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
    });

    expect(policy.canEdit).toBe(true);
    expect(policy.canCancel).toBe(true);
  });

  it('permite editar uma parcela específica pendente, mas orienta não alterar o parcelamento inteiro', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: 'INSTALLMENT',
      localStatus: 'PENDENTE',
      asaasStatus: 'PENDING',
      billingType: 'BOLETO',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
      isInstallmentPayment: true,
    });

    expect(policy.canEdit).toBe(true);
    expect(policy.actions.EDIT.hint).toContain('somente esta parcela');
    expect(policy.canChangePayer).toBe(false);
  });

  it('bloqueia edição de parcela já paga', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: 'INSTALLMENT',
      localStatus: 'PAGO',
      asaasStatus: 'RECEIVED',
      billingType: 'PIX',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
      isInstallmentPayment: true,
    });

    expect(policy.canEdit).toBe(false);
    expect(policy.actions.EDIT.code).toBe('EDIT_NOT_ALLOWED_FOR_ASAAS_STATUS');
    expect(policy.canRefund).toBe(true);
  });

  it('diferencia assinatura: editar cobrança emitida não edita recorrência futura', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: 'SUBSCRIPTION',
      localStatus: 'PENDENTE',
      asaasStatus: 'PENDING',
      billingType: 'CREDIT_CARD',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
      isSubscriptionPayment: true,
    });

    expect(policy.canEdit).toBe(true);
    expect(policy.actions.EDIT.hint).toContain('cobranças futuras');
  });

  it('bloqueia cancelamento de cobrança paga e orienta estorno quando aplicável', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'CHARGE',
      origin: 'STORE',
      localStatus: 'PAID',
      asaasStatus: 'RECEIVED',
      billingType: 'PIX',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
    });

    expect(policy.canCancel).toBe(false);
    expect(policy.actions.CANCEL.code).toBe('CANCEL_NOT_ALLOWED_FOR_PAID_CHARGE');
    expect(policy.canRefund).toBe(true);
  });

  it('usa desfazer recebimento para RECEIVED_IN_CASH, não estorno', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: 'ACADEMIC',
      localStatus: 'PAGO',
      asaasStatus: 'RECEIVED_IN_CASH',
      billingType: 'RECEIVED_IN_CASH',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
      wasReceivedInCash: true,
    });

    expect(policy.canRefund).toBe(false);
    expect(policy.actions.REFUND.code).toBe('REFUND_NOT_ALLOWED_FOR_CASH_PAYMENT');
    expect(policy.canUndoCashPayment).toBe(true);
  });

  it('permite estorno parcial de Pix quando ainda há saldo estornável', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'CHARGE',
      origin: 'EVENT',
      localStatus: 'PAID',
      asaasStatus: 'RECEIVED',
      billingType: 'PIX',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
      paymentValue: 120,
      refundedValue: 40,
    });

    expect(policy.canRefund).toBe(true);
    expect(policy.canPartialRefund).toBe(true);
    expect(policy.actions.PARTIAL_REFUND.hint).toContain('Pix');
  });

  it('bloqueia novo estorno parcial quando todo o valor já foi estornado', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'CHARGE',
      origin: 'EVENT',
      localStatus: 'PAID',
      asaasStatus: 'RECEIVED',
      billingType: 'PIX',
      hasAsaasPaymentId: true,
      hasInvoiceUrl: true,
      paymentValue: 120,
      refundedValue: 120,
    });

    expect(policy.canRefund).toBe(true);
    expect(policy.canPartialRefund).toBe(false);
    expect(policy.actions.PARTIAL_REFUND.code).toBe('NO_REFUNDABLE_BALANCE');
  });

  it('bloqueia comandos Asaas quando a cobrança não possui asaasPaymentId', () => {
    const policy = evaluatePaymentActionPolicy({
      entityType: 'COBRANCA',
      origin: 'ACADEMIC',
      localStatus: 'PENDENTE',
      hasAsaasPaymentId: false,
      hasInvoiceUrl: false,
    });

    expect(policy.canViewInvoice).toBe(false);
    expect(policy.canCancel).toBe(false);
    expect(policy.actions.CANCEL.code).toBe('MISSING_ASAAS_PAYMENT_ID');
    expect(policy.canSyncWithAsaas).toBe(false);
  });
});
