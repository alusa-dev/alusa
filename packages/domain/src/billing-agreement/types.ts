export type MoneyCents = number;

export type BillingAgreementStatus =
  | 'DRAFT'
  | 'PENDING_PROVISION'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'CANCELLATION_PENDING'
  | 'CANCELLED'
  | 'FAILED'
  | 'REQUIRES_RECONCILIATION';

export type BillingAllocationKind =
  | 'TUITION'
  | 'ENROLLMENT_FEE'
  | 'MATERIAL'
  | 'ADJUSTMENT';

export type BillingAllocationStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED'
  | 'CANCELLED';

export type BillingEffectivePolicy =
  | 'CURRENT_CYCLE_FULL'
  | 'CURRENT_CYCLE_PRORATED'
  | 'NEXT_CYCLE'
  | 'MANUAL_ADJUSTMENT';

export type BillingChangeOperationType =
  | 'ADD'
  | 'REMOVE'
  | 'UPDATE'
  | 'UPDATE_TERMS'
  | 'TRANSFER'
  | 'CHANGE_PAYER'
  | 'REBALANCE_PAYER_SHARES'
  | 'PAUSE_ALLOCATION'
  | 'RESUME_ALLOCATION'
  | 'PAUSE_AGREEMENT'
  | 'RESUME_AGREEMENT'
  | 'CANCEL'
  | 'RENEW';

export type PaidDecreaseHandling = 'CREDIT' | 'REFUND' | 'MANUAL_REVIEW';

export type BillingChargeState =
  | 'NOT_GENERATED'
  | 'PENDING'
  | 'OVERDUE'
  | 'PAID'
  | 'REFUNDED'
  | 'CANCELLED';

export interface BillingAgreementSnapshot {
  status: BillingAgreementStatus;
  desiredAmountCents: MoneyCents;
  confirmedAmountCents: MoneyCents;
  version: number;
  remoteSubscriptionExists: boolean;
  validFrom?: Date | string | null;
  /** Limite exclusivo persistido no acordo. */
  validUntil?: Date | string | null;
}

/**
 * A validade segue intervalo semiaberto: validFrom inclusivo e validUntil
 * exclusivo. Isso evita cobrar duas vezes o dia de troca entre versões.
 */
export interface BillingAgreementAllocationInput {
  id: string;
  matriculaId: string;
  alunoId: string;
  kind: BillingAllocationKind;
  status: BillingAllocationStatus;
  recurring: boolean;
  netAmountCents: MoneyCents;
  validFrom: Date | string;
  validUntil?: Date | string | null;
}

export interface BillingCycleWindow {
  startsAt: Date | string;
  /** Limite exclusivo do ciclo. */
  endsAt: Date | string;
}

export interface CurrentChargeSnapshot {
  state: BillingChargeState;
  amountCents: MoneyCents;
}

export type BillingSubscriptionAction =
  | 'NONE'
  | 'CREATE'
  | 'UPDATE'
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'SCHEDULE_UPDATE'
  | 'SCHEDULE_PAUSE'
  | 'SCHEDULE_RESUME'
  | 'SCHEDULE_CANCEL';

export interface BillingCurrentCycleAdjustment {
  type: 'NONE' | 'CREDIT' | 'COMPLEMENT' | 'REFUND' | 'MANUAL_REVIEW';
  amountCents: MoneyCents;
  reason:
    | 'NO_DIFFERENCE'
    | 'NEXT_CYCLE_ONLY'
    | 'PENDING_CHARGE_CAN_BE_UPDATED'
    | 'OVERDUE_CHARGE_CAN_BE_UPDATED'
    | 'PAID_CHARGE_IS_IMMUTABLE'
    | 'OVERDUE_CHARGE_REQUIRES_REVIEW'
    | 'CANCELLED_OR_REFUNDED_CHARGE'
    | 'MANUAL_POLICY';
}

export interface CalculateBillingAgreementDesiredStateInput {
  calculatedAt: Date | string;
  effectiveAt: Date | string;
  effectivePolicy: BillingEffectivePolicy;
  agreement: BillingAgreementSnapshot | null;
  allocations: BillingAgreementAllocationInput[];
  currentCharge?: CurrentChargeSnapshot | null;
  currentCycle?: BillingCycleWindow | null;
  paidDecreaseHandling?: PaidDecreaseHandling;
}

export interface BillingAgreementDesiredState {
  previousRecurringAmountCents: MoneyCents;
  desiredRecurringAmountCents: MoneyCents;
  /**
   * Vigência agregada das alocações recorrentes não terminadas no instante
   * efetivo. Ambos são ISO-8601; o limite final é exclusivo.
   *
   * `agreementValidUntil` só é `null` quando existe uma alocação sem fim. Se
   * não restar alocação atual ou futura, ambos os campos são `null`.
   */
  agreementValidFrom: string | null;
  agreementValidUntil: string | null;
  currentCycleTargetAmountCents: MoneyCents;
  currentCycleDeltaCents: MoneyCents;
  subscriptionAction: BillingSubscriptionAction;
  updatePendingPayments: boolean;
  adjustment: BillingCurrentCycleAdjustment;
  activeAllocationIds: string[];
}

export type BillingAgreementCalculationErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_CYCLE'
  | 'INVALID_MONEY'
  | 'INVALID_VERSION'
  | 'DUPLICATE_ALLOCATION_ID'
  | 'DUPLICATE_ACTIVE_ENROLLMENT_ALLOCATION'
  | 'INVALID_ALLOCATION_VALIDITY'
  | 'CURRENT_CYCLE_REQUIRED';

export type CalculateBillingAgreementDesiredStateResult =
  | { success: true; value: BillingAgreementDesiredState }
  | {
      success: false;
      error: BillingAgreementCalculationErrorCode;
      message: string;
      allocationId?: string;
    };
