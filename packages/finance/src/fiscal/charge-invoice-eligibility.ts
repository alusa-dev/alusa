import type { ChargeStatus, InvoiceStatus, StatusCobranca } from '@prisma/client';
import type { PaymentStatus } from '@alusa/asaas';

export type ChargeInvoiceEligibilityReason =
  | 'READY'
  | 'READY_AFTER_OVERDUE_PAYMENT'
  | 'ALREADY_HAS_ACTIVE_INVOICE'
  | 'INVOICE_CAN_RETRY'
  | 'INVOICE_CANCELED'
  | 'INVOICE_CANCEL_IN_PROGRESS'
  | 'PAYMENT_NOT_CONFIRMED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_PROCESSING'
  | 'PAYMENT_CANCELED'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_PARTIALLY_REFUNDED'
  | 'PAYMENT_CHARGEBACK'
  | 'PAYMENT_DELETED'
  | 'PAYMENT_STATUS_UNKNOWN'
  | 'CHARGE_NOT_SYNCED'
  | 'CHARGE_WITHOUT_PAYMENT'
  | 'CHARGE_VALUE_INVALID';

export type ChargeInvoiceEligibilitySeverity = 'success' | 'info' | 'warning' | 'danger';

export type ChargeInvoiceEligibility = {
  canEmit: boolean;
  canRetry: boolean;
  canCancel: boolean;
  shouldAutoCancel: boolean;
  reason: ChargeInvoiceEligibilityReason;
  message: string;
  severity: ChargeInvoiceEligibilitySeverity;
};

type EligibilityInput = {
  charge?: {
    status?: ChargeStatus | string | null;
    asaasStatus?: string | null;
    asaasPaymentId?: string | null;
    value?: number | null;
  } | null;
  cobranca?: {
    status?: StatusCobranca | string | null;
    valor?: number | null;
    valorFinal?: number | null;
  } | null;
  invoice?: {
    status?: InvoiceStatus | string | null;
    hasProviderInvoice?: boolean;
  } | null;
  asaasPayment?: {
    status?: PaymentStatus | string | null;
    deleted?: boolean | null;
  } | null;
};

const PAID_PROVIDER_STATUSES = new Set([
  'RECEIVED',
  'CONFIRMED',
  'RECEIVED_IN_CASH',
  'DUNNING_RECEIVED',
]);

const PENDING_PROVIDER_STATUSES = new Set(['PENDING']);
const PROCESSING_PROVIDER_STATUSES = new Set(['AWAITING_RISK_ANALYSIS']);
const OVERDUE_PROVIDER_STATUSES = new Set(['OVERDUE', 'DUNNING_REQUESTED']);
const REFUNDED_PROVIDER_STATUSES = new Set(['REFUNDED', 'REFUND_REQUESTED', 'REFUND_IN_PROGRESS']);
const CHARGEBACK_PROVIDER_STATUSES = new Set([
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

const ACTIVE_INVOICE_STATUSES = new Set<InvoiceStatus | string>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELLATION_DENIED',
]);

const CANCELABLE_INVOICE_STATUSES = new Set<InvoiceStatus | string>([
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
]);

function eligibility(input: Partial<ChargeInvoiceEligibility>): ChargeInvoiceEligibility {
  return {
    canEmit: false,
    canRetry: false,
    canCancel: false,
    shouldAutoCancel: false,
    severity: 'info',
    reason: 'PAYMENT_STATUS_UNKNOWN',
    message: 'Não foi possível confirmar se esta cobrança pode emitir nota fiscal.',
    ...input,
  };
}

function normalize(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

function resolveValue(input: EligibilityInput): number | null {
  if (typeof input.cobranca?.valorFinal === 'number') return input.cobranca.valorFinal;
  if (typeof input.cobranca?.valor === 'number') return input.cobranca.valor;
  if (typeof input.charge?.value === 'number') return input.charge.value;
  return null;
}

function resolveProviderStatus(input: EligibilityInput): string | null {
  return normalize(input.asaasPayment?.status) ?? normalize(input.charge?.asaasStatus);
}

export function isChargePaymentFullyRefunded(input: {
  chargeStatus?: string | null;
  cobrancaStatus?: string | null;
  providerStatus?: string | null;
}): boolean {
  const chargeStatus = normalize(input.chargeStatus);
  const cobrancaStatus = normalize(input.cobrancaStatus);
  const providerStatus = normalize(input.providerStatus);

  return (
    chargeStatus === 'REFUNDED' ||
    cobrancaStatus === 'ESTORNADO' ||
    (providerStatus != null && REFUNDED_PROVIDER_STATUSES.has(providerStatus))
  );
}

export function evaluateChargeInvoiceEligibility(input: EligibilityInput): ChargeInvoiceEligibility {
  const invoiceStatus = normalize(input.invoice?.status);
  const chargeStatus = normalize(input.charge?.status);
  const cobrancaStatus = normalize(input.cobranca?.status);
  const providerStatus = resolveProviderStatus(input);
  const value = resolveValue(input);

  if (value != null && value <= 0) {
    return eligibility({
      reason: 'CHARGE_VALUE_INVALID',
      severity: 'warning',
      message: 'Cobrança sem valor positivo não permite emissão de NFS-e.',
    });
  }

  if (!input.charge?.asaasPaymentId) {
    return eligibility({
      reason: 'CHARGE_WITHOUT_PAYMENT',
      severity: 'warning',
      message: 'Esta cobrança ainda não está vinculada ao emissor de pagamento.',
    });
  }

  if (invoiceStatus === 'ERROR') {
    return eligibility({
      canEmit: true,
      canRetry: true,
      reason: 'INVOICE_CAN_RETRY',
      severity: 'warning',
      message: 'A emissão anterior falhou. Revise os dados fiscais e tente novamente.',
    });
  }

  if (invoiceStatus === 'CANCELED') {
    return eligibility({
      reason: 'INVOICE_CANCELED',
      severity: 'info',
      message: 'A nota fiscal desta cobrança foi cancelada. Uma nova emissão deve ser tratada pelo fiscal/contador.',
    });
  }

  if (invoiceStatus === 'PROCESSING_CANCELLATION') {
    return eligibility({
      canCancel: false,
      reason: 'INVOICE_CANCEL_IN_PROGRESS',
      severity: 'info',
      message: 'O cancelamento da nota fiscal está em processamento na prefeitura.',
    });
  }

  if (cobrancaStatus === 'ESTORNADO_PARCIAL') {
    return eligibility({
      reason: 'PAYMENT_PARTIALLY_REFUNDED',
      severity: 'warning',
      message: 'Cobrança com estorno parcial exige revisão fiscal antes de emitir NFS-e.',
    });
  }

  const paymentRefunded =
    isChargePaymentFullyRefunded({
      chargeStatus,
      cobrancaStatus,
      providerStatus,
    }) && cobrancaStatus !== 'ESTORNADO_PARCIAL';

  if (paymentRefunded) {
    const cancelableInvoice =
      invoiceStatus != null && CANCELABLE_INVOICE_STATUSES.has(invoiceStatus);
    return eligibility({
      shouldAutoCancel: cancelableInvoice,
      canCancel: cancelableInvoice,
      reason: 'PAYMENT_REFUNDED',
      severity: 'danger',
      message: cancelableInvoice
        ? 'Cobrança estornada. A NFS-e será cancelada automaticamente.'
        : 'Cobrança estornada não permite emissão de nota fiscal.',
    });
  }

  if (providerStatus && CHARGEBACK_PROVIDER_STATUSES.has(providerStatus)) {
    const cancelableInvoice =
      invoiceStatus != null && CANCELABLE_INVOICE_STATUSES.has(invoiceStatus);
    return eligibility({
      shouldAutoCancel: cancelableInvoice,
      canCancel: cancelableInvoice,
      reason: 'PAYMENT_CHARGEBACK',
      severity: 'danger',
      message: cancelableInvoice
        ? 'Cobrança em chargeback. A NFS-e será cancelada automaticamente.'
        : 'Cobrança em chargeback não permite emissão de nota fiscal.',
    });
  }

  if (invoiceStatus && ACTIVE_INVOICE_STATUSES.has(invoiceStatus)) {
    return eligibility({
      canCancel: CANCELABLE_INVOICE_STATUSES.has(invoiceStatus),
      reason: 'ALREADY_HAS_ACTIVE_INVOICE',
      severity: invoiceStatus === 'AUTHORIZED' ? 'success' : 'info',
      message:
        invoiceStatus === 'AUTHORIZED'
          ? 'Nota fiscal já emitida para esta cobrança.'
          : 'Nota fiscal já agendada ou em processamento para esta cobrança.',
    });
  }

  if (input.asaasPayment?.deleted || providerStatus === 'DELETED' || chargeStatus === 'CANCELED' || cobrancaStatus === 'CANCELADO') {
    return eligibility({
      reason: providerStatus === 'DELETED' || input.asaasPayment?.deleted ? 'PAYMENT_DELETED' : 'PAYMENT_CANCELED',
      severity: 'warning',
      message: 'Cobrança cancelada não permite emissão de nota fiscal.',
    });
  }

  if (chargeStatus === 'PENDING_SYNC' || chargeStatus === 'CREATED') {
    return eligibility({
      reason: 'CHARGE_NOT_SYNCED',
      severity: 'info',
      message: 'A cobrança ainda está sincronizando. Aguarde a confirmação antes de emitir NFS-e.',
    });
  }

  if (providerStatus && PROCESSING_PROVIDER_STATUSES.has(providerStatus)) {
    return eligibility({
      reason: 'PAYMENT_PROCESSING',
      severity: 'info',
      message: 'Pagamento em análise/processamento. A NFS-e ficará disponível após a confirmação.',
    });
  }

  if (providerStatus && PENDING_PROVIDER_STATUSES.has(providerStatus)) {
    return eligibility({
      reason: 'PAYMENT_NOT_CONFIRMED',
      severity: 'info',
      message: 'Aguarde a confirmação do pagamento para emitir a NFS-e.',
    });
  }

  if (providerStatus && OVERDUE_PROVIDER_STATUSES.has(providerStatus)) {
    return eligibility({
      reason: 'PAYMENT_OVERDUE',
      severity: 'warning',
      message: 'Cobrança vencida ainda não permite emissão. Emita a NFS-e após a confirmação do pagamento.',
    });
  }

  if (providerStatus && PAID_PROVIDER_STATUSES.has(providerStatus)) {
    return eligibility({
      canEmit: true,
      reason: providerStatus === 'DUNNING_RECEIVED' ? 'READY_AFTER_OVERDUE_PAYMENT' : 'READY',
      severity: 'success',
      message: 'Cobrança confirmada. A NFS-e pode ser emitida.',
    });
  }

  if (chargeStatus === 'PAID' || cobrancaStatus === 'PAGO') {
    return eligibility({
      canEmit: true,
      reason: 'READY',
      severity: 'success',
      message: 'Cobrança confirmada. A NFS-e pode ser emitida.',
    });
  }

  return eligibility({
    reason: 'PAYMENT_STATUS_UNKNOWN',
    severity: 'info',
    message: 'Aguarde a sincronização da cobrança antes de emitir a NFS-e.',
  });
}

export function isInvoicePaymentSensitiveEvent(event: string, providerStatus?: string | null): boolean {
  const normalizedEvent = normalize(event);
  const normalizedStatus = normalize(providerStatus);
  return Boolean(
    normalizedEvent === 'PAYMENT_DELETED' ||
      normalizedEvent === 'PAYMENT_REFUNDED' ||
      normalizedEvent === 'PAYMENT_PARTIALLY_REFUNDED' ||
      normalizedEvent === 'PAYMENT_REFUND_IN_PROGRESS' ||
      normalizedEvent === 'PAYMENT_RECEIVED_IN_CASH_UNDONE' ||
      (normalizedEvent != null && normalizedEvent.includes('CHARGEBACK')) ||
      (normalizedStatus != null &&
        (REFUNDED_PROVIDER_STATUSES.has(normalizedStatus) ||
          CHARGEBACK_PROVIDER_STATUSES.has(normalizedStatus) ||
          normalizedStatus === 'DELETED')),
  );
}

export function isInvoicePaymentPaidEvent(event: string, providerStatus?: string | null): boolean {
  const normalizedEvent = normalize(event);
  const normalizedStatus = normalize(providerStatus);
  return Boolean(
    normalizedEvent === 'PAYMENT_CONFIRMED' ||
      normalizedEvent === 'PAYMENT_RECEIVED' ||
      normalizedEvent === 'PAYMENT_RECEIVED_IN_CASH' ||
      normalizedEvent === 'PAYMENT_DUNNING_RECEIVED' ||
      (normalizedStatus != null && PAID_PROVIDER_STATUSES.has(normalizedStatus)),
  );
}
