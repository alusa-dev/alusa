import type {
  BillingAgreementChangeInput,
  BillingAgreementChangePreview,
  BillingAgreementChangeResult,
  BillingAgreementContext,
  BillingChangeOperation,
  BillingChargeStatus,
  BillingRemoteProgress,
  ProposedBillingAdjustment,
  BillingAgreement,
} from './types';

export type ReserveBillingOperationInput = {
  contaId: string;
  uiRequestId: string;
  requestFingerprint: string;
  correlationId: string;
  change: BillingAgreementChangeInput;
  preview: BillingAgreementChangePreview;
};

export type ReserveBillingOperationResult =
  | { outcome: 'RESERVED'; operation: BillingChangeOperation }
  | { outcome: 'EXISTING'; operation: BillingChangeOperation }
  | { outcome: 'CONFLICT'; operation: BillingChangeOperation };

export type ApplyConfirmedBillingChangeInput = {
  contaId: string;
  operationId: string;
  change: BillingAgreementChangeInput;
  preview: BillingAgreementChangePreview;
  expectedVersions: Record<string, number>;
  remoteProgress: BillingRemoteProgress[];
  adjustments: ProposedBillingAdjustment[];
  correlationId: string;
};

export interface BillingAgreementRepositoryPort {
  getAgreementContext(input: {
    contaId: string;
    agreementId: string;
    effectiveDate?: string;
  }): Promise<BillingAgreementContext | null>;

  getOperationByRequest(input: {
    contaId: string;
    uiRequestId: string;
  }): Promise<BillingChangeOperation | null>;

  reserveOperation(input: ReserveBillingOperationInput): Promise<ReserveBillingOperationResult>;

  recordRemoteProgress(input: {
    contaId: string;
    operationId: string;
    progress: BillingRemoteProgress[];
  }): Promise<void>;

  applyConfirmedChange(
    input: ApplyConfirmedBillingChangeInput,
  ): Promise<BillingAgreementChangeResult>;

  markOperationUncertain(input: {
    contaId: string;
    operationId: string;
    errorCode: string;
    errorMessage: string;
    remoteProgress: BillingRemoteProgress[];
  }): Promise<void>;

  markOperationFailed(input: {
    contaId: string;
    operationId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

export type AsaasSubscriptionSnapshot = {
  id: string;
  customerId: string;
  valueCents: number;
  billingType: string;
  cycle: string;
  status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | string;
  nextDueDate: string;
  endDate: string | null;
  externalReference: string | null;
  deleted: boolean;
};

export type AsaasSubscriptionPaymentSnapshot = {
  id: string;
  status: BillingChargeStatus;
  valueCents: number;
  dueDate: string;
  billingType:
    | 'UNDEFINED'
    | 'BOLETO'
    | 'CREDIT_CARD'
    | 'DEBIT_CARD'
    | 'TRANSFER'
    | 'DEPOSIT'
    | 'PIX';
  deleted: boolean;
};

export interface AsaasSubscriptionPort {
  getSubscription(input: {
    contaId: string;
    subscriptionId: string;
  }): Promise<AsaasSubscriptionSnapshot>;

  listSubscriptionPayments(input: {
    contaId: string;
    subscriptionId: string;
  }): Promise<AsaasSubscriptionPaymentSnapshot[]>;

  findSubscriptionByExternalReference(input: {
    contaId: string;
    externalReference: string;
    includeDeleted?: boolean;
  }): Promise<AsaasSubscriptionSnapshot | null>;

  createSubscription(input: {
    contaId: string;
    customerId: string;
    valueCents: number;
    billingType: 'UNDEFINED' | 'BOLETO' | 'PIX' | 'CREDIT_CARD';
    cycle: BillingAgreement['cycle'];
    nextDueDate: string;
    endDate: string | null;
    description: string | null;
    externalReference: string;
    idempotencyKey: string;
  }): Promise<AsaasSubscriptionSnapshot>;

  updateSubscription(input: {
    contaId: string;
    subscriptionId: string;
    valueCents: number;
    updatePendingPayments: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
    nextDueDate?: string;
    /** Data limite inclusiva esperada pelo Asaas. */
    endDate?: string;
  }): Promise<AsaasSubscriptionSnapshot>;

  deleteSubscription(input: {
    contaId: string;
    subscriptionId: string;
  }): Promise<{ id: string; deleted: boolean }>;

  getPayment(input: {
    contaId: string;
    paymentId: string;
  }): Promise<AsaasSubscriptionPaymentSnapshot>;

  updatePayment(input: {
    contaId: string;
    paymentId: string;
    valueCents: number;
    billingType: 'UNDEFINED' | 'BOLETO' | 'CREDIT_CARD' | 'PIX';
    dueDate: string;
  }): Promise<AsaasSubscriptionPaymentSnapshot>;

  deletePayment(input: {
    contaId: string;
    paymentId: string;
  }): Promise<{ id: string; deleted: boolean }>;
}

export interface BillingAgreementLockPort {
  withAgreementLocks<T>(input: {
    contaId: string;
    agreementIds: string[];
    run: () => Promise<T>;
  }): Promise<{ acquired: true; result: T } | { acquired: false }>;
}

export interface BillingAgreementAuditPort {
  record(input: {
    contaId: string;
    actorId: string;
    correlationId: string;
    action: string;
    entityIds: string[];
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export type BillingAgreementLifecycleDependencies = {
  repository: BillingAgreementRepositoryPort;
  asaas: AsaasSubscriptionPort;
  lock: BillingAgreementLockPort;
  audit: BillingAgreementAuditPort;
  now?: () => Date;
  previewTtlMs?: number;
  createCorrelationId?: () => string;
};
