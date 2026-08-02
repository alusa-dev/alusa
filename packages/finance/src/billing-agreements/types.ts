export type BillingChangeKind =
  | 'ADD_ALLOCATION'
  | 'REMOVE_ALLOCATION'
  | 'UPDATE_ALLOCATION'
  | 'TRANSFER_ALLOCATION'
  | 'PAUSE_ALLOCATION'
  | 'RESUME_ALLOCATION'
  | 'PAUSE_AGREEMENT'
  | 'RESUME_AGREEMENT'
  | 'CHANGE_PAYER'
  | 'CANCEL_AGREEMENT';

export type EffectivePolicy =
  | 'CURRENT_CYCLE_FULL'
  | 'CURRENT_CYCLE_PRORATED'
  | 'NEXT_CYCLE'
  | 'MANUAL_ADJUSTMENT';

export type BillingAgreementStatus =
  | 'DRAFT'
  | 'PENDING_PROVISION'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'FAILED'
  | 'REQUIRES_RECONCILIATION';

export type BillingAllocationStatus = 'SCHEDULED' | 'ACTIVE' | 'PAUSED' | 'ENDED' | 'CANCELLED';

export type BillingOperationStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REQUIRES_RECONCILIATION'
  | 'CANCELLED';

export type BillingAdjustmentType = 'CREDIT' | 'COMPLEMENT' | 'REFUND';

export type BillingAdjustmentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPLIED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REQUIRES_RECONCILIATION';

export type BillingAllocationKind = 'TUITION' | 'ENROLLMENT_FEE' | 'MATERIAL' | 'ADJUSTMENT';

export type BillingProrationPolicy =
  | 'FULL_CURRENT_CYCLE'
  | 'DAILY_CURRENT_CYCLE'
  | 'NEXT_CYCLE'
  | 'MANUAL';

export type PaidDecreaseHandling = 'CREDIT' | 'REFUND' | 'MANUAL_REVIEW';

export type BillingPayer = {
  type: 'ALUNO' | 'RESPONSAVEL';
  id: string;
  customerId: string;
};

export type BillingAgreement = {
  id: string;
  contaId: string;
  payer: BillingPayer;
  status: BillingAgreementStatus;
  billingType: 'UNDEFINED' | 'BOLETO' | 'PIX' | 'CREDIT_CARD';
  cycle:
    | 'WEEKLY'
    | 'BIWEEKLY'
    | 'MONTHLY'
    | 'BIMONTHLY'
    | 'QUARTERLY'
    | 'SEMIANNUALLY'
    | 'YEARLY';
  dueDay: number | null;
  nextDueDate: string | null;
  validFrom: string | null;
  validUntil: string | null;
  desiredAmountCents: number;
  confirmedAmountCents: number;
  asaasSubscriptionId: string | null;
  remoteStatus: string | null;
  version: number;
  externalReference: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingAllocation = {
  id: string;
  contaId: string;
  agreementId: string;
  enrollmentId: string;
  studentId: string;
  kind: BillingAllocationKind;
  status: BillingAllocationStatus;
  recurring: boolean;
  baseAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  validFrom: string;
  validUntil: string | null;
  prorationPolicy: BillingProrationPolicy;
};

export type BillingChargeStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED'
  | string;

export type BillingCharge = {
  id: string;
  contaId: string;
  agreementId: string;
  allocationId: string | null;
  providerPaymentId: string | null;
  status: BillingChargeStatus;
  amountCents: number;
  dueDate: string;
};

export type BillingAgreementContext = {
  agreement: BillingAgreement;
  allocations: BillingAllocation[];
  charges: BillingCharge[];
  currentCycle: { startsAt: string; endsAt: string } | null;
};

export type BillingAllocationDraft = {
  clientId?: string;
  enrollmentId: string;
  studentId: string;
  kind: BillingAllocationKind;
  recurring?: boolean;
  baseAmountCents: number;
  discountAmountCents?: number;
  netAmountCents: number;
  validFrom?: string;
  validUntil?: string | null;
  prorationPolicy?: BillingProrationPolicy;
};

export type BillingAllocationUpdate = {
  allocationId: string;
  recurring?: boolean;
  baseAmountCents: number;
  discountAmountCents?: number;
  netAmountCents: number;
  validFrom?: string;
  validUntil?: string | null;
  prorationPolicy?: BillingProrationPolicy;
};

type BaseBillingAgreementChangeInput = {
  contaId: string;
  agreementId: string;
  actorId: string;
  reason: string;
  paidDecreaseHandling?: PaidDecreaseHandling;
  effectivePolicy: EffectivePolicy;
  effectiveDate: string;
};

export type BillingAgreementChangeInput =
  | (BaseBillingAgreementChangeInput & {
      kind: 'ADD_ALLOCATION';
      allocations: BillingAllocationDraft[];
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'REMOVE_ALLOCATION';
      allocationIds: string[];
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'UPDATE_ALLOCATION';
      allocations: BillingAllocationUpdate[];
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'TRANSFER_ALLOCATION';
      allocationIds: string[];
      targetAgreementId: string;
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'PAUSE_ALLOCATION';
      allocationIds: string[];
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'RESUME_ALLOCATION';
      allocationIds: string[];
      nextDueDate?: string;
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'PAUSE_AGREEMENT' | 'RESUME_AGREEMENT';
      nextDueDate?: string;
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'CHANGE_PAYER';
      newPayer: BillingPayer;
    })
  | (BaseBillingAgreementChangeInput & {
      kind: 'CANCEL_AGREEMENT';
    });

export type BillingAgreementRemoteAction =
  | 'NONE'
  | 'CREATE_SUBSCRIPTION'
  | 'UPDATE_SUBSCRIPTION'
  | 'DELETE_SUBSCRIPTION'
  | 'REPLACE_SUBSCRIPTION'
  | 'PAUSE_SUBSCRIPTION'
  | 'RESUME_SUBSCRIPTION'
  | 'SCHEDULE_UPDATE'
  | 'SCHEDULE_PAUSE'
  | 'SCHEDULE_RESUME'
  | 'SCHEDULE_CANCEL';

export type BillingChargeImpactAction =
  | 'UPDATE_WITH_SUBSCRIPTION'
  | 'UPDATE_PAYMENT'
  | 'CREATE_PAYMENT'
  | 'CANCEL_PENDING'
  | 'PRESERVE'
  | 'CREATE_CREDIT'
  | 'CREATE_COMPLEMENT'
  | 'MANUAL_REVIEW';

export type BillingChargeImpact = {
  chargeId: string;
  providerPaymentId: string | null;
  status: BillingChargeStatus;
  dueDate: string;
  amountCents: number;
  targetAmountCents: number | null;
  action: BillingChargeImpactAction;
};

export type ProposedBillingAdjustment = {
  agreementId: string;
  chargeId: string | null;
  type: BillingAdjustmentType | 'MANUAL_REVIEW';
  amountCents: number;
  effectiveDate: string;
  reason:
    | 'PAID_CHARGE_IMMUTABLE'
    | 'PRORATION'
    | 'MANUAL_POLICY'
    | 'CANCELLATION_AFTER_PAYMENT';
};

export type BillingAgreementPlan = {
  agreementId: string;
  sourceVersion: number;
  /** Vigência agregada das alocações recorrentes; fim exclusivo. */
  agreementValidFrom: string | null;
  agreementValidUntil: string | null;
  previousAmountCents: number;
  resultingAmountCents: number;
  addedAmountCents: number;
  removedAmountCents: number;
  remoteAction: BillingAgreementRemoteAction;
  updatePendingPayments: boolean;
  payer: BillingPayer;
  chargeImpacts: BillingChargeImpact[];
  adjustments: ProposedBillingAdjustment[];
};

export type BillingAgreementChangePreview = {
  contaId: string;
  kind: BillingChangeKind;
  agreementId: string;
  targetAgreementId: string | null;
  effectivePolicy: EffectivePolicy;
  effectiveDate: string;
  sourceVersion: number;
  previewHash: string;
  expiresAt: string;
  plans: BillingAgreementPlan[];
  currentAmountCents: number;
  addedAmountCents: number;
  removedAmountCents: number;
  resultingAmountCents: number;
  affectedCharges: BillingChargeImpact[];
  adjustments: ProposedBillingAdjustment[];
  warnings: string[];
  blockers: string[];
};

export type CommitBillingAgreementChangeInput = BillingAgreementChangeInput & {
  uiRequestId: string;
  previewHash: string;
  previewExpiresAt: string;
  expectedAgreementVersion: number;
};

export type BillingRemoteProgress = {
  agreementId: string;
  action: BillingAgreementRemoteAction;
  previousSubscriptionId: string | null;
  resultingSubscriptionId: string | null;
  expectedAmountCents: number;
  confirmed: boolean;
};

export type BillingChangeOperation = {
  id: string;
  contaId: string;
  uiRequestId: string;
  kind: BillingChangeKind;
  status: BillingOperationStatus;
  requestFingerprint: string;
  sourceAgreementId: string;
  targetAgreementId: string | null;
  expectedVersion: number;
  previewHash: string;
  effectivePolicy: EffectivePolicy;
  effectiveDate: string;
  correlationId: string;
  remoteProgress: BillingRemoteProgress[];
  result: BillingAgreementChangeResult | null;
  errorCode: string | null;
};

export type BillingAgreementChangeResult = {
  operationId: string;
  uiRequestId: string;
  status: Extract<BillingOperationStatus, 'COMPLETED' | 'REQUIRES_RECONCILIATION'>;
  agreementIds: string[];
  resultingAmountsCents: Record<string, number>;
  versions: Record<string, number>;
  adjustments: ProposedBillingAdjustment[];
  remoteProgress: BillingRemoteProgress[];
  correlationId: string;
};

export type BillingAgreementView = BillingAgreementContext & {
  activeAllocationTotalCents: number;
  hasLocalDivergence: boolean;
};
