// hooks
export { useAccountVerification } from './hooks/use-account-verification';
export { useKycUpload } from './hooks/use-kyc-upload';
export { useKyc403Interceptor } from './hooks/use-kyc-403-interceptor';
export { useKycGate } from './hooks/use-kyc-gate';

// components
export { KycStatusArea } from './components/KycStatusArea';
export { KycActionCard } from './components/KycActionCard';
export { KycExternalModal } from './components/KycExternalModal';
export { KycExternalOnboardingCard } from './components/KycExternalOnboardingCard';
export { KycUploadModal } from './components/KycUploadModal';
export { KycBlockingModal } from './components/KycBlockingModal';
export { KycDashboardCard } from './components/KycDashboardCard';
export { KycPendingBanner } from './components/KycPendingBanner';

// providers
export { KycEnforcementProvider, useKycEnforcement } from './KycEnforcementProvider';

// constants + types
export {
  statusBadge,
  verificationStatusBadge,
  UPLOAD_MAX_SIZE_MB,
  UPLOAD_ACCEPT,
  SNAPSHOT_POLL_INTERVAL_MS,
} from './constants';
export type {
  KycAreaStatus,
  KycNextAction,
  KycSlotInfo,
  KycSnapshot,
  SnapshotResponse,
  AccountVerificationStatus,
  AccountVerificationResponse,
  VerificationAction,
  VerificationActionMode,
  VerificationActionStatus,
  VerificationSlotInfo,
  VerificationAreaInfo,
} from './constants';
