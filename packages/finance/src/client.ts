// Entry point seguro para uso em componentes client (apenas itens puros)
export {
  getAllowedActionsByChargeStatus,
  isActionAllowed,
  CHARGE_ACTION_LABELS,
} from './guards/charge-status-guard';
export type { ChargeAction } from './guards/charge-status-guard';
export {
  evaluatePaymentActionPolicy,
  toLegacyChargeActions,
  type PaymentActionDecision,
  type PaymentActionPolicy,
  type PaymentActionPolicyInput,
  type PaymentEntityType,
  type PaymentOrigin,
  type PaymentPolicyAction,
} from './policies';
export {
  getUnifiedBadgeStatus,
  getStatusLabel,
  getStatusBadgePresentation,
} from './mappers/charge-status';
