export type PrivacyRequestStatus =
  | 'PENDING_REVIEW'
  | 'NEEDS_IDENTITY_VERIFICATION'
  | 'IN_PROGRESS'
  | 'WAITING_SCHOOL_ACTION'
  | 'COMPLETED'
  | 'REJECTED_WITH_REASON'
  | 'CANCELLED';

export type PrivacyRequestAction =
  | 'DELETE'
  | 'ANONYMIZE'
  | 'RESTRICT_PROCESSING'
  | 'KEEP_WITH_LEGAL_BASIS';

export type PrivacyRequestContext = {
  hasActiveEnrollment?: boolean;
  hasFinancialObligation?: boolean;
  hasContractualRecord?: boolean;
  identityVerified?: boolean;
  schoolActionRequired?: boolean;
};

export function resolvePrivacyRequestAction(context: PrivacyRequestContext): PrivacyRequestAction {
  if (context.hasFinancialObligation || context.hasContractualRecord) {
    return 'KEEP_WITH_LEGAL_BASIS';
  }

  if (context.hasActiveEnrollment) {
    return 'RESTRICT_PROCESSING';
  }

  return 'ANONYMIZE';
}

export function transitionPrivacyRequest(
  current: PrivacyRequestStatus,
  event:
    | 'REVIEW'
    | 'REQUEST_IDENTITY_VERIFICATION'
    | 'VERIFY_IDENTITY'
    | 'REQUEST_SCHOOL_ACTION'
    | 'COMPLETE'
    | 'REJECT'
    | 'CANCEL',
): PrivacyRequestStatus {
  if (current === 'COMPLETED' || current === 'REJECTED_WITH_REASON' || current === 'CANCELLED') {
    return current;
  }

  if (event === 'CANCEL') return 'CANCELLED';
  if (event === 'REJECT') return 'REJECTED_WITH_REASON';
  if (event === 'REQUEST_IDENTITY_VERIFICATION') return 'NEEDS_IDENTITY_VERIFICATION';
  if (event === 'REQUEST_SCHOOL_ACTION') return 'WAITING_SCHOOL_ACTION';
  if (event === 'VERIFY_IDENTITY' || event === 'REVIEW') return 'IN_PROGRESS';
  if (event === 'COMPLETE') return 'COMPLETED';
  return current;
}
