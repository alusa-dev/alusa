/**
 * KYC Onboarding State Machine
 *
 * Define transições válidas entre estados de onboarding/KYC,
 * impedindo regressões inválidas e garantindo que só eventos
 * oficiais do Asaas provoquem mudanças de estado.
 *
 * Fonte de verdade: AsaasWebhookEventType em @alusa/asaas
 */

import type { FinancialOnboardingStatus, KycProcessStatus } from '@prisma/client';

// ── Transições válidas de FinancialOnboardingStatus ──────────────────────

const ONBOARDING_TRANSITIONS: Record<FinancialOnboardingStatus, Set<FinancialOnboardingStatus>> = {
  NOT_STARTED: new Set(['IN_PROGRESS', 'READY_FOR_PROVISIONING']),
  IN_PROGRESS: new Set(['READY_FOR_PROVISIONING']),
  READY_FOR_PROVISIONING: new Set(['PROVISIONING', 'PROVISIONING_FAILED']),
  PROVISIONING: new Set(['CREATED', 'PROVISIONING_FAILED']),
  PROVISIONING_FAILED: new Set(['READY_FOR_PROVISIONING', 'PROVISIONING']),
  CREATED: new Set(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  UNDER_REVIEW: new Set(['APPROVED', 'REJECTED']),
  // APPROVED e REJECTED: podem voltar a UNDER_REVIEW via evento autoritativo
  APPROVED: new Set(['UNDER_REVIEW', 'REJECTED']),
  REJECTED: new Set(['UNDER_REVIEW', 'APPROVED']),
};

// ── Transições válidas de KycProcessStatus ───────────────────────────────

const KYC_PROCESS_TRANSITIONS: Record<KycProcessStatus, Set<KycProcessStatus>> = {
  NOT_STARTED: new Set(['WAITING_MIN_TIMEOUT', 'PENDING_DOCUMENTS', 'EXTERNAL_IN_PROGRESS']),
  WAITING_MIN_TIMEOUT: new Set(['PENDING_DOCUMENTS', 'EXTERNAL_IN_PROGRESS', 'INTERNAL_UPLOADING']),
  PENDING_DOCUMENTS: new Set(['EXTERNAL_IN_PROGRESS', 'INTERNAL_UPLOADING', 'UNDER_REVIEW', 'REJECTED']),
  EXTERNAL_IN_PROGRESS: new Set(['UNDER_REVIEW', 'REJECTED', 'PENDING_DOCUMENTS']),
  INTERNAL_UPLOADING: new Set(['UNDER_REVIEW', 'REJECTED', 'PENDING_DOCUMENTS']),
  UNDER_REVIEW: new Set(['APPROVED', 'REJECTED', 'PENDING_DOCUMENTS']),
  REJECTED: new Set(['PENDING_DOCUMENTS', 'EXTERNAL_IN_PROGRESS', 'INTERNAL_UPLOADING', 'UNDER_REVIEW', 'APPROVED']),
  APPROVED: new Set(['UNDER_REVIEW', 'REJECTED']),
};

// ── Eventos autoritativos (bypassa monotonicidade) ───────────────────────

const AUTHORITATIVE_EVENTS: ReadonlySet<string> = new Set([
  'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
]);

// ── Eventos oficiais do Asaas para account status ────────────────────────

export const ACCOUNT_STATUS_EVENTS = {
  GENERAL: {
    APPROVED: 'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
    REJECTED: 'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
    PENDING: 'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
    AWAITING_APPROVAL: 'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
  },
  DOCUMENT: {
    APPROVED: 'ACCOUNT_STATUS_DOCUMENT_APPROVED',
    REJECTED: 'ACCOUNT_STATUS_DOCUMENT_REJECTED',
    PENDING: 'ACCOUNT_STATUS_DOCUMENT_PENDING',
    AWAITING_APPROVAL: 'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
  },
  BANK_ACCOUNT: {
    APPROVED: 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
    REJECTED: 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
    PENDING: 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
    AWAITING_APPROVAL: 'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
  },
  COMMERCIAL_INFO: {
    APPROVED: 'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
    REJECTED: 'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
    PENDING: 'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
    AWAITING_APPROVAL: 'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
    EXPIRING_SOON: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
    EXPIRED: 'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
  },
} as const;

export const ALL_ACCOUNT_STATUS_EVENTS: ReadonlySet<string> = new Set([
  ...Object.values(ACCOUNT_STATUS_EVENTS.GENERAL),
  ...Object.values(ACCOUNT_STATUS_EVENTS.DOCUMENT),
  ...Object.values(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT),
  ...Object.values(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO),
]);

// ── Validação de transição ───────────────────────────────────────────────

export type TransitionResult = {
  allowed: boolean;
  reason?: string;
};

export function isOnboardingTransitionValid(
  current: FinancialOnboardingStatus,
  next: FinancialOnboardingStatus,
  event?: string,
): TransitionResult {
  if (current === next) return { allowed: true };

  if (event && AUTHORITATIVE_EVENTS.has(event)) {
    return { allowed: true };
  }

  const allowed = ONBOARDING_TRANSITIONS[current];
  if (!allowed?.has(next)) {
    return {
      allowed: false,
      reason: `Transição ${current} → ${next} não permitida`,
    };
  }

  return { allowed: true };
}

export function isKycProcessTransitionValid(
  current: KycProcessStatus,
  next: KycProcessStatus,
  event?: string,
): TransitionResult {
  if (current === next) return { allowed: true };

  if (event && AUTHORITATIVE_EVENTS.has(event)) {
    return { allowed: true };
  }

  const allowed = KYC_PROCESS_TRANSITIONS[current];
  if (!allowed?.has(next)) {
    return {
      allowed: false,
      reason: `Transição KYC ${current} → ${next} não permitida`,
    };
  }

  return { allowed: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function isAccountStatusEvent(event: string): boolean {
  return ALL_ACCOUNT_STATUS_EVENTS.has(event);
}

export function isAuthoritativeEvent(event: string): boolean {
  return AUTHORITATIVE_EVENTS.has(event);
}

export function isDocumentEvent(event: string): boolean {
  return event.startsWith('ACCOUNT_STATUS_DOCUMENT_');
}

export function isBankAccountEvent(event: string): boolean {
  return event.startsWith('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_');
}

export function isCommercialInfoEvent(event: string): boolean {
  return event.startsWith('ACCOUNT_STATUS_COMMERCIAL_INFO_');
}

export function isCommercialInfoExpirationEvent(event: string): boolean {
  return (
    event === ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRING_SOON ||
    event === ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRED
  );
}
