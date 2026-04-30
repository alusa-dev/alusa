export { chargeGuards, canCreateCharge, canEditEntity } from './charge-guards';
export type { CreateChargeGuardInput, ChargeGuardResult, ChargeGuardErrorCode, EditGuardInput, EditGuardResult } from './charge-guards';

export {
  isAuthorizedCategory,
  validateFinanceStatusChange,
  updateMatriculaFinanceStatus,
  updateFinanceStatusFromPayment,
  updateFinanceStatusFromSubscription,
  tryUpdateFinanceStatus,
} from './finance-status-guard';
export type {
  UpdateFinanceStatusInput,
  UpdateFinanceStatusResult,
  FinanceStatusGuardContext,
} from './finance-status-guard';

// Charge status guard - Progressão monotônica
export {
  validateChargeStatusTransition,
  applyChargeStatusWithMonotonicity,
  getAllowedActionsByChargeStatus,
  isActionAllowed,
  isTerminalStatus,
  isIntermediateStatus,
  canProgressCobrancaStatus,
  canProgressChargeStatus,
  getCobrancaPrecedence,
  getChargePrecedence,
  CHARGE_ACTION_LABELS,
} from './charge-status-guard';
export type {
  ChargeStatusTransitionResult,
  StatusUpdateOrigin,
  ApplyStatusOptions,
  ChargeAction,
} from './charge-status-guard';

// KYC Gate - Gate obrigatório para operações financeiras
export { checkKycGate } from './kyc-gate.guard';
export type { KycGateResult } from './kyc-gate.guard';
