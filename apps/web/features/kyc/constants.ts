import type { BadgeVariant } from '@/components/ui/badge';
import type {
  AccountVerificationResponse,
  KycAreaStatus,
  SubaccountProvisioningHint,
} from '@alusa/finance';

// Re-exportar tipos canônicos de @alusa/finance (fonte única de verdade)
export type {
  KycAreaStatus,
  KycSlotInfo,
  KycNextAction,
  KycSnapshot,
  AccountVerificationStatus,
  AccountVerificationResponse,
  VerificationAction,
  VerificationActionMode,
  VerificationActionStatus,
  VerificationSlotInfo,
  VerificationAreaInfo,
  SubaccountProvisioningHint,
} from '@alusa/finance';

export type SnapshotResponse = {
  data: AccountVerificationResponse | null;
  reason?: string;
  subaccountProvisioning?: SubaccountProvisioningHint;
};

export const UPLOAD_MAX_SIZE_MB = 10;
export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png';
export const SNAPSHOT_POLL_INTERVAL_MS = 10_000;

export function statusBadge(status: KycAreaStatus): { label: string; variant: BadgeVariant } {
  switch (status) {
    case 'APPROVED':
      return { label: 'Aprovado', variant: 'default' };
    case 'AWAITING_APPROVAL':
      return { label: 'Em análise', variant: 'outline' };
    case 'REJECTED':
      return { label: 'Rejeitado', variant: 'destructive' };
    case 'PENDING':
    case 'NOT_SENT':
      return { label: 'Pendente', variant: 'warning' };
    default:
      return { label: 'Aguardando', variant: 'outline' };
  }
}

export function verificationStatusBadge(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case 'ACCOUNT_ACTIVE':
      return { label: 'Ativa', variant: 'default' };
    case 'ACCOUNT_UNDER_REVIEW':
      return { label: 'Em análise', variant: 'outline' };
    case 'ACCOUNT_REQUIRES_CORRECTION':
      return { label: 'Requer correção', variant: 'destructive' };
    case 'ACCOUNT_PENDING_USER_ACTION':
      return { label: 'Ação necessária', variant: 'warning' };
    case 'ACCOUNT_PENDING_ACTIVATION':
      return { label: 'Ativação pendente', variant: 'outline' };
    default:
      return { label: 'Aguardando', variant: 'outline' };
  }
}
