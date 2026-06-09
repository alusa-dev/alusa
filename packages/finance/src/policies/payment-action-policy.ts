export type PaymentEntityType = 'COBRANCA' | 'CHARGE';

export type PaymentOrigin =
  | 'ACADEMIC'
  | 'STANDALONE'
  | 'INSTALLMENT'
  | 'SUBSCRIPTION'
  | 'EVENT'
  | 'STORE'
  | 'ENROLLMENT_FEE';

export type PaymentPolicyAction =
  | 'VIEW_INVOICE'
  | 'EDIT'
  | 'CANCEL'
  | 'REFUND'
  | 'PARTIAL_REFUND'
  | 'UNDO_CASH_PAYMENT'
  | 'RESEND_NOTIFICATION'
  | 'SYNC_WITH_ASAAS'
  | 'CHANGE_PAYER'
  | 'CHANGE_PAYMENT_METHOD';

export interface PaymentActionDecision {
  allowed: boolean;
  code?: string;
  reason?: string;
  hint?: string;
}

export interface PaymentActionPolicyInput {
  entityType: PaymentEntityType;
  origin: PaymentOrigin;
  localStatus?: string | null;
  asaasStatus?: string | null;
  billingType?: string | null;
  hasAsaasPaymentId?: boolean;
  hasInvoiceUrl?: boolean;
  wasReceivedInCash?: boolean;
  isInstallmentPayment?: boolean;
  isSubscriptionPayment?: boolean;
  isFirstInstallment?: boolean;
  isLastInstallment?: boolean;
  refundedValue?: number | null;
  paymentValue?: number | null;
  isAsaasEnabled?: boolean;
}

export interface PaymentActionPolicy {
  actions: Record<PaymentPolicyAction, PaymentActionDecision>;
  allowedActions: PaymentPolicyAction[];
  canViewInvoice: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canRefund: boolean;
  canPartialRefund: boolean;
  canUndoCashPayment: boolean;
  canResendNotification: boolean;
  canSyncWithAsaas: boolean;
  canChangePayer: boolean;
  canChangePaymentMethod: boolean;
}

const LOCAL_EDITABLE_STATUSES = new Set(['PENDENTE', 'A_VENCER', 'ATRASADO', 'CREATED', 'OPEN', 'OVERDUE']);
const LOCAL_CANCELABLE_STATUSES = LOCAL_EDITABLE_STATUSES;
const LOCAL_PAID_STATUSES = new Set(['PAGO', 'PAID']);
const LOCAL_TERMINAL_STATUSES = new Set([
  'CANCELADO',
  'CANCELED',
  'ESTORNADO',
  'REFUNDED',
  'ESTORNADO_PARCIAL',
]);

const ASAAS_EDITABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);
const ASAAS_REFUNDABLE_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'DUNNING_RECEIVED']);
const ASAAS_CASH_STATUS = 'RECEIVED_IN_CASH';
const ASAAS_TERMINAL_STATUSES = new Set([
  'DELETED',
  'REFUNDED',
  'REFUND_IN_PROGRESS',
  'REFUND_REQUESTED',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
]);

function normalize(value?: string | null): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && normalized.length > 0 ? normalized : null;
}

function allowed(hint?: string): PaymentActionDecision {
  return hint ? { allowed: true, hint } : { allowed: true };
}

function blocked(code: string, reason: string, hint?: string): PaymentActionDecision {
  return { allowed: false, code, reason, hint };
}

function withInstallmentHint(input: PaymentActionPolicyInput, decision: PaymentActionDecision) {
  if (!decision.allowed || !input.isInstallmentPayment) return decision;
  return {
    ...decision,
    hint:
      decision.hint ??
      'Esta ação afeta somente esta parcela. Para alterar o parcelamento inteiro, use uma ação específica do parcelamento.',
  };
}

function withSubscriptionHint(input: PaymentActionPolicyInput, decision: PaymentActionDecision) {
  if (!decision.allowed || !input.isSubscriptionPayment) return decision;
  return {
    ...decision,
    hint:
      decision.hint ??
      'Esta ação afeta somente a cobrança já emitida. Para alterar cobranças futuras, use uma ação específica da assinatura.',
  };
}

function canUseAsaas(input: PaymentActionPolicyInput): PaymentActionDecision {
  if (input.isAsaasEnabled === false) {
    return blocked('ASAAS_DISABLED', 'Integração Asaas desabilitada.');
  }

  if (!input.hasAsaasPaymentId) {
    return blocked('MISSING_ASAAS_PAYMENT_ID', 'Cobrança sem identificador de pagamento no Asaas.');
  }

  return allowed();
}

function resolveEdit(input: PaymentActionPolicyInput, localStatus: string | null, asaasStatus: string | null) {
  if (LOCAL_TERMINAL_STATUSES.has(localStatus ?? '')) {
    return blocked('EDIT_NOT_ALLOWED_FOR_TERMINAL_CHARGE', `Cobrança com status ${localStatus} não pode ser editada.`);
  }

  if (asaasStatus && !ASAAS_EDITABLE_STATUSES.has(asaasStatus)) {
    return blocked(
      'EDIT_NOT_ALLOWED_FOR_ASAAS_STATUS',
      `Não é possível editar cobrança com status ${asaasStatus} no Asaas.`,
      'A documentação do Asaas permite atualização apenas para cobranças aguardando pagamento ou vencidas.',
    );
  }

  if (!asaasStatus && localStatus && !LOCAL_EDITABLE_STATUSES.has(localStatus)) {
    return blocked('EDIT_NOT_ALLOWED_FOR_LOCAL_STATUS', `Não é possível editar cobrança com status ${localStatus}.`);
  }

  const asaasAvailability = canUseAsaas(input);
  if (!asaasAvailability.allowed && input.hasAsaasPaymentId) return asaasAvailability;

  return withSubscriptionHint(input, withInstallmentHint(input, allowed()));
}

function resolveCancel(input: PaymentActionPolicyInput, localStatus: string | null, asaasStatus: string | null) {
  if (LOCAL_PAID_STATUSES.has(localStatus ?? '')) {
    return blocked('CANCEL_NOT_ALLOWED_FOR_PAID_CHARGE', 'Cobrança paga não pode ser cancelada; use estorno quando aplicável.');
  }

  if (LOCAL_TERMINAL_STATUSES.has(localStatus ?? '')) {
    return blocked('CANCEL_NOT_ALLOWED_FOR_TERMINAL_CHARGE', `Cobrança com status ${localStatus} não pode ser cancelada.`);
  }

  if (asaasStatus && !ASAAS_EDITABLE_STATUSES.has(asaasStatus)) {
    return blocked(
      'CANCEL_NOT_ALLOWED_FOR_ASAAS_STATUS',
      `Não é possível cancelar cobrança com status ${asaasStatus} no Asaas.`,
      'Cancele apenas cobranças ainda aguardando pagamento ou vencidas.',
    );
  }

  if (!asaasStatus && localStatus && !LOCAL_CANCELABLE_STATUSES.has(localStatus)) {
    return blocked('CANCEL_NOT_ALLOWED_FOR_LOCAL_STATUS', `Não é possível cancelar cobrança com status ${localStatus}.`);
  }

  const asaasAvailability = canUseAsaas(input);
  if (!asaasAvailability.allowed) return asaasAvailability;

  return withSubscriptionHint(input, withInstallmentHint(input, allowed()));
}

function resolveRefund(input: PaymentActionPolicyInput, localStatus: string | null, asaasStatus: string | null) {
  const asaasAvailability = canUseAsaas(input);
  if (!asaasAvailability.allowed) return asaasAvailability;

  if (input.wasReceivedInCash || asaasStatus === ASAAS_CASH_STATUS) {
    return blocked(
      'REFUND_NOT_ALLOWED_FOR_CASH_PAYMENT',
      'Cobranças recebidas em dinheiro devem usar a ação de desfazer recebimento.',
      'O recebimento em dinheiro não movimenta saldo no Asaas; por isso não deve ser tratado como estorno.',
    );
  }

  if (asaasStatus && !ASAAS_REFUNDABLE_STATUSES.has(asaasStatus)) {
    return blocked(
      'REFUND_NOT_ALLOWED_FOR_ASAAS_STATUS',
      `Não é possível estornar cobrança com status ${asaasStatus} no Asaas.`,
    );
  }

  if (!asaasStatus && !LOCAL_PAID_STATUSES.has(localStatus ?? '')) {
    return blocked('REFUND_NOT_ALLOWED_FOR_LOCAL_STATUS', `Não é possível estornar cobrança com status ${localStatus}.`);
  }

  if (asaasStatus && ASAAS_TERMINAL_STATUSES.has(asaasStatus)) {
    return blocked('REFUND_NOT_ALLOWED_FOR_TERMINAL_ASAAS_STATUS', `Cobrança em status terminal ${asaasStatus}.`);
  }

  return allowed();
}

function resolvePartialRefund(input: PaymentActionPolicyInput, refundDecision: PaymentActionDecision) {
  if (!refundDecision.allowed) return refundDecision;

  const paymentValue = input.paymentValue ?? null;
  const refundedValue = input.refundedValue ?? 0;
  if (paymentValue != null && refundedValue >= paymentValue) {
    return blocked('NO_REFUNDABLE_BALANCE', 'Não há saldo restante para novo estorno.');
  }

  const billingType = normalize(input.billingType);
  if (billingType === 'PIX') {
    return allowed('Pix permite estorno total ou múltiplos estornos parciais, respeitando o valor recebido.');
  }

  return allowed('Valide saldo e regras do meio de pagamento no Asaas antes de confirmar o estorno parcial.');
}

function resolveUndoCash(input: PaymentActionPolicyInput, asaasStatus: string | null) {
  const asaasAvailability = canUseAsaas(input);
  if (!asaasAvailability.allowed) return asaasAvailability;

  if (input.wasReceivedInCash || asaasStatus === ASAAS_CASH_STATUS) {
    return allowed();
  }

  return blocked(
    'UNDO_CASH_PAYMENT_NOT_ALLOWED',
    'Apenas cobranças recebidas em dinheiro podem ter o recebimento desfeito.',
  );
}

export function evaluatePaymentActionPolicy(input: PaymentActionPolicyInput): PaymentActionPolicy {
  const localStatus = normalize(input.localStatus);
  const asaasStatus = normalize(input.asaasStatus);
  const hasAsaasPaymentId = input.hasAsaasPaymentId ?? false;
  const hasInvoiceUrl = input.hasInvoiceUrl ?? false;
  const hasRemoteAccess = hasAsaasPaymentId || hasInvoiceUrl;

  const viewInvoice = hasRemoteAccess
    ? allowed()
    : blocked('MISSING_INVOICE_ACCESS', 'Cobrança sem link ou identificador de fatura disponível.');
  const edit = resolveEdit({ ...input, hasAsaasPaymentId }, localStatus, asaasStatus);
  const cancel = resolveCancel({ ...input, hasAsaasPaymentId }, localStatus, asaasStatus);
  const refund = resolveRefund({ ...input, hasAsaasPaymentId }, localStatus, asaasStatus);
  const partialRefund = resolvePartialRefund(input, refund);
  const undoCashPayment = resolveUndoCash({ ...input, hasAsaasPaymentId }, asaasStatus);
  const resendNotification =
    hasAsaasPaymentId && (asaasStatus ? ASAAS_EDITABLE_STATUSES.has(asaasStatus) : LOCAL_EDITABLE_STATUSES.has(localStatus ?? ''))
      ? allowed()
      : blocked('RESEND_NOTIFICATION_NOT_ALLOWED', 'Reenvio disponível apenas para cobranças abertas no Asaas.');
  const syncWithAsaas = hasAsaasPaymentId
    ? allowed()
    : blocked('SYNC_NOT_AVAILABLE_WITHOUT_ASAAS_PAYMENT', 'Cobrança sem identificador de pagamento no Asaas.');
  const changePayer = blocked(
    'CHANGE_PAYER_NOT_ALLOWED',
    'Não é possível alterar o pagador de uma cobrança já criada no Asaas.',
    'Crie uma nova cobrança para o pagador correto.',
  );
  const changePaymentMethod = edit.allowed
    ? withSubscriptionHint(input, withInstallmentHint(input, allowed()))
    : edit;

  const actions: Record<PaymentPolicyAction, PaymentActionDecision> = {
    VIEW_INVOICE: viewInvoice,
    EDIT: edit,
    CANCEL: cancel,
    REFUND: refund,
    PARTIAL_REFUND: partialRefund,
    UNDO_CASH_PAYMENT: undoCashPayment,
    RESEND_NOTIFICATION: resendNotification,
    SYNC_WITH_ASAAS: syncWithAsaas,
    CHANGE_PAYER: changePayer,
    CHANGE_PAYMENT_METHOD: changePaymentMethod,
  };

  const allowedActions = (Object.keys(actions) as PaymentPolicyAction[]).filter(
    (action) => actions[action].allowed,
  );

  return {
    actions,
    allowedActions,
    canViewInvoice: viewInvoice.allowed,
    canEdit: edit.allowed,
    canCancel: cancel.allowed,
    canRefund: refund.allowed,
    canPartialRefund: partialRefund.allowed,
    canUndoCashPayment: undoCashPayment.allowed,
    canResendNotification: resendNotification.allowed,
    canSyncWithAsaas: syncWithAsaas.allowed,
    canChangePayer: changePayer.allowed,
    canChangePaymentMethod: changePaymentMethod.allowed,
  };
}

export function toLegacyChargeActions(policy: PaymentActionPolicy) {
  return policy.allowedActions.filter((action): action is Extract<PaymentPolicyAction, 'VIEW_INVOICE' | 'EDIT' | 'CANCEL' | 'REFUND' | 'UNDO_CASH_PAYMENT' | 'RESEND_NOTIFICATION'> =>
    action === 'VIEW_INVOICE' ||
    action === 'EDIT' ||
    action === 'CANCEL' ||
    action === 'REFUND' ||
    action === 'UNDO_CASH_PAYMENT' ||
    action === 'RESEND_NOTIFICATION',
  );
}
