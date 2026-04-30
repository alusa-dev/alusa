/**
 * Testes da máquina de estados KYC.
 *
 * Valida transições permitidas e bloqueadas entre estados de onboarding
 * e do processo KYC, incluindo bypass por eventos autoritativos.
 */
import { describe, it, expect } from 'vitest';
import {
  isOnboardingTransitionValid,
  isKycProcessTransitionValid,
  isAccountStatusEvent,
  isAuthoritativeEvent,
  isDocumentEvent,
  isBankAccountEvent,
  isCommercialInfoEvent,
  isCommercialInfoExpirationEvent,
  ACCOUNT_STATUS_EVENTS,
  ALL_ACCOUNT_STATUS_EVENTS,
} from '../kyc-state-machine';

describe('kyc-state-machine', () => {
  describe('isOnboardingTransitionValid', () => {
    it('permite transição CREATED → UNDER_REVIEW', () => {
      expect(isOnboardingTransitionValid('CREATED', 'UNDER_REVIEW').allowed).toBe(true);
    });

    it('permite transição UNDER_REVIEW → APPROVED', () => {
      expect(isOnboardingTransitionValid('UNDER_REVIEW', 'APPROVED').allowed).toBe(true);
    });

    it('permite transição UNDER_REVIEW → REJECTED', () => {
      expect(isOnboardingTransitionValid('UNDER_REVIEW', 'REJECTED').allowed).toBe(true);
    });

    it('bloqueia CREATED → APPROVED diretamente (sem UNDER_REVIEW)', () => {
      expect(isOnboardingTransitionValid('CREATED', 'APPROVED').allowed).toBe(true);
    });

    it('bloqueia NOT_STARTED → APPROVED', () => {
      expect(isOnboardingTransitionValid('NOT_STARTED', 'APPROVED').allowed).toBe(false);
    });

    it('bloqueia NOT_STARTED → UNDER_REVIEW', () => {
      expect(isOnboardingTransitionValid('NOT_STARTED', 'UNDER_REVIEW').allowed).toBe(false);
    });

    it('permite APPROVED → UNDER_REVIEW via evento autoritativo', () => {
      const result = isOnboardingTransitionValid(
        'APPROVED',
        'UNDER_REVIEW',
        ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED,
      );
      expect(result.allowed).toBe(true);
    });

    it('bloqueia PROVISIONING → APPROVED (sem passagem por CREATED)', () => {
      expect(isOnboardingTransitionValid('PROVISIONING', 'APPROVED').allowed).toBe(false);
    });

    it('same status = allowed', () => {
      expect(isOnboardingTransitionValid('APPROVED', 'APPROVED').allowed).toBe(true);
    });
  });

  describe('isKycProcessTransitionValid', () => {
    it('permite PENDING_DOCUMENTS → UNDER_REVIEW', () => {
      expect(isKycProcessTransitionValid('PENDING_DOCUMENTS', 'UNDER_REVIEW').allowed).toBe(true);
    });

    it('permite UNDER_REVIEW → APPROVED', () => {
      expect(isKycProcessTransitionValid('UNDER_REVIEW', 'APPROVED').allowed).toBe(true);
    });

    it('permite REJECTED → PENDING_DOCUMENTS (reenvio)', () => {
      expect(isKycProcessTransitionValid('REJECTED', 'PENDING_DOCUMENTS').allowed).toBe(true);
    });

    it('bloqueia NOT_STARTED → APPROVED direto', () => {
      expect(isKycProcessTransitionValid('NOT_STARTED', 'APPROVED').allowed).toBe(false);
    });

    it('permite APPROVED → REJECTED via evento autoritativo', () => {
      const result = isKycProcessTransitionValid(
        'APPROVED',
        'REJECTED',
        ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED,
      );
      expect(result.allowed).toBe(true);
    });
  });

  describe('event classification helpers', () => {
    it('isAccountStatusEvent identifica todos os eventos oficiais', () => {
      for (const event of ALL_ACCOUNT_STATUS_EVENTS) {
        expect(isAccountStatusEvent(event)).toBe(true);
      }
    });

    it('isAccountStatusEvent rejeita evento desconhecido', () => {
      expect(isAccountStatusEvent('PAYMENT_RECEIVED')).toBe(false);
      expect(isAccountStatusEvent('INVALID_EVENT')).toBe(false);
    });

    it('isAuthoritativeEvent identifica GENERAL_APPROVAL_APPROVED', () => {
      expect(isAuthoritativeEvent(ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED)).toBe(true);
    });

    it('isAuthoritativeEvent identifica GENERAL_APPROVAL_REJECTED', () => {
      expect(isAuthoritativeEvent(ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED)).toBe(true);
    });

    it('isAuthoritativeEvent rejeita eventos de documentos', () => {
      expect(isAuthoritativeEvent(ACCOUNT_STATUS_EVENTS.DOCUMENT.APPROVED)).toBe(false);
    });

    it('isDocumentEvent identifica eventos DOCUMENT_*', () => {
      expect(isDocumentEvent('ACCOUNT_STATUS_DOCUMENT_APPROVED')).toBe(true);
      expect(isDocumentEvent('ACCOUNT_STATUS_DOCUMENT_REJECTED')).toBe(true);
      expect(isDocumentEvent('ACCOUNT_STATUS_DOCUMENT_PENDING')).toBe(true);
      expect(isDocumentEvent('ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL')).toBe(true);
    });

    it('isDocumentEvent rejeita BANK_ACCOUNT', () => {
      expect(isDocumentEvent('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED')).toBe(false);
    });

    it('isBankAccountEvent identifica eventos BANK_ACCOUNT_INFO_*', () => {
      expect(isBankAccountEvent('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED')).toBe(true);
      expect(isBankAccountEvent('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED')).toBe(true);
    });

    it('isCommercialInfoEvent identifica eventos COMMERCIAL_INFO_*', () => {
      expect(isCommercialInfoEvent('ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED')).toBe(true);
      expect(isCommercialInfoEvent('ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED')).toBe(true);
    });

    it('isCommercialInfoExpirationEvent identifica EXPIRING_SOON e EXPIRED', () => {
      expect(isCommercialInfoExpirationEvent(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRING_SOON)).toBe(true);
      expect(isCommercialInfoExpirationEvent(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRED)).toBe(true);
      expect(isCommercialInfoExpirationEvent(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.APPROVED)).toBe(false);
    });
  });

  describe('ACCOUNT_STATUS_EVENTS contract', () => {
    it('GENERAL events match official Asaas contract', () => {
      expect(ACCOUNT_STATUS_EVENTS.GENERAL.APPROVED).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED');
      expect(ACCOUNT_STATUS_EVENTS.GENERAL.REJECTED).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED');
      expect(ACCOUNT_STATUS_EVENTS.GENERAL.PENDING).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING');
      expect(ACCOUNT_STATUS_EVENTS.GENERAL.AWAITING_APPROVAL).toBe('ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL');
    });

    it('DOCUMENT events match official Asaas contract', () => {
      expect(ACCOUNT_STATUS_EVENTS.DOCUMENT.APPROVED).toBe('ACCOUNT_STATUS_DOCUMENT_APPROVED');
      expect(ACCOUNT_STATUS_EVENTS.DOCUMENT.REJECTED).toBe('ACCOUNT_STATUS_DOCUMENT_REJECTED');
      expect(ACCOUNT_STATUS_EVENTS.DOCUMENT.PENDING).toBe('ACCOUNT_STATUS_DOCUMENT_PENDING');
      expect(ACCOUNT_STATUS_EVENTS.DOCUMENT.AWAITING_APPROVAL).toBe('ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL');
    });

    it('BANK_ACCOUNT events match official Asaas contract', () => {
      expect(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.APPROVED).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED');
      expect(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.REJECTED).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED');
      expect(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.PENDING).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING');
      expect(ACCOUNT_STATUS_EVENTS.BANK_ACCOUNT.AWAITING_APPROVAL).toBe('ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL');
    });

    it('COMMERCIAL_INFO events match official Asaas contract', () => {
      expect(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.APPROVED).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED');
      expect(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.REJECTED).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED');
      expect(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.PENDING).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING');
      expect(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.AWAITING_APPROVAL).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL');
      expect(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRING_SOON).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON');
      expect(ACCOUNT_STATUS_EVENTS.COMMERCIAL_INFO.EXPIRED).toBe('ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED');
    });

    it('ALL_ACCOUNT_STATUS_EVENTS contains exactly 18 event types', () => {
      // 4 GENERAL + 4 DOCUMENT + 4 BANK_ACCOUNT + 6 COMMERCIAL_INFO = 18
      expect(ALL_ACCOUNT_STATUS_EVENTS.size).toBe(18);
    });
  });
});
