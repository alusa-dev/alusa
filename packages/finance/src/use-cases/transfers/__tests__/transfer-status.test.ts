import { describe, it, expect } from 'vitest';

import {
  isAllowedTransition,
  isTerminalTransferStatus,
  mapAsaasTransferStatus,
  mapTransferWebhookEventToStatus,
  mapTransferStatusToPixTransferSessionStatus,
  resolveTransferStatus,
  isOpenTransferStatus,
} from '../transfer-status';

describe('transfer-status', () => {
  describe('mapAsaasTransferStatus', () => {
    it.each([
      ['PENDING', 'PENDING'],
      ['BLOCKED', 'BLOCKED'],
      ['BANK_PROCESSING', 'PROCESSING'],
      ['DONE', 'DONE'],
      ['CANCELLED', 'CANCELED'],
      ['FAILED', 'FAILED'],
    ] as const)('mapeia %s para %s', (input, expected) => {
      expect(mapAsaasTransferStatus(input)).toBe(expected);
    });

    it('retorna null para status desconhecido', () => {
      expect(mapAsaasTransferStatus('UNKNOWN')).toBeNull();
      expect(mapAsaasTransferStatus(null)).toBeNull();
      expect(mapAsaasTransferStatus(undefined)).toBeNull();
    });
  });

  describe('mapTransferWebhookEventToStatus', () => {
    it.each([
      ['TRANSFER_CREATED', 'PENDING'],
      ['TRANSFER_PENDING', 'PENDING'],
      ['TRANSFER_IN_BANK_PROCESSING', 'PROCESSING'],
      ['TRANSFER_BLOCKED', 'BLOCKED'],
      ['TRANSFER_DONE', 'DONE'],
      ['TRANSFER_FAILED', 'FAILED'],
      ['TRANSFER_CANCELLED', 'CANCELED'],
    ] as const)('mapeia %s para %s', (input, expected) => {
      expect(mapTransferWebhookEventToStatus(input)).toBe(expected);
    });

    it('retorna null para evento desconhecido', () => {
      expect(mapTransferWebhookEventToStatus('UNKNOWN')).toBeNull();
    });
  });

  describe('resolveTransferStatus', () => {
    it('prioriza asaasStatus sobre event', () => {
      expect(resolveTransferStatus({ asaasStatus: 'DONE', event: 'TRANSFER_PENDING' })).toBe('DONE');
    });

    it('usa event quando asaasStatus é null', () => {
      expect(resolveTransferStatus({ asaasStatus: null, event: 'TRANSFER_DONE' })).toBe('DONE');
    });

    it('retorna null quando ambos são inválidos', () => {
      expect(resolveTransferStatus({ asaasStatus: 'UNKNOWN', event: 'UNKNOWN' })).toBeNull();
    });
  });

  describe('isTerminalTransferStatus', () => {
    it.each(['DONE', 'CANCELED', 'FAILED'] as const)('%s é terminal', (status) => {
      expect(isTerminalTransferStatus(status)).toBe(true);
    });

    it.each(['REQUESTED', 'PENDING', 'BLOCKED', 'PROCESSING'] as const)('%s não é terminal', (status) => {
      expect(isTerminalTransferStatus(status)).toBe(false);
    });
  });

  describe('isOpenTransferStatus', () => {
    it.each(['REQUESTED', 'PENDING', 'BLOCKED', 'PROCESSING'] as const)('%s é aberto', (status) => {
      expect(isOpenTransferStatus(status)).toBe(true);
    });

    it.each(['DONE', 'CANCELED', 'FAILED'] as const)('%s não é aberto', (status) => {
      expect(isOpenTransferStatus(status)).toBe(false);
    });
  });

  describe('isAllowedTransition (state machine monotônica)', () => {
    it('permite same-status (idempotência)', () => {
      expect(isAllowedTransition('PENDING', 'PENDING')).toBe(true);
      expect(isAllowedTransition('DONE', 'DONE')).toBe(true);
    });

    // Transições válidas
    it.each([
      ['REQUESTED', 'PENDING'],
      ['REQUESTED', 'BLOCKED'],
      ['REQUESTED', 'PROCESSING'],
      ['REQUESTED', 'DONE'],
      ['REQUESTED', 'CANCELED'],
      ['REQUESTED', 'FAILED'],
      ['PENDING', 'BLOCKED'],
      ['PENDING', 'PROCESSING'],
      ['PENDING', 'DONE'],
      ['PENDING', 'CANCELED'],
      ['PENDING', 'FAILED'],
      ['BLOCKED', 'PENDING'],
      ['BLOCKED', 'PROCESSING'],
      ['BLOCKED', 'DONE'],
      ['BLOCKED', 'CANCELED'],
      ['BLOCKED', 'FAILED'],
      ['PROCESSING', 'DONE'],
      ['PROCESSING', 'CANCELED'],
      ['PROCESSING', 'FAILED'],
    ] as const)('permite %s → %s', (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(true);
    });

    // Transições inválidas (regressão)
    it.each([
      ['DONE', 'PENDING'],
      ['DONE', 'PROCESSING'],
      ['DONE', 'BLOCKED'],
      ['DONE', 'REQUESTED'],
      ['DONE', 'CANCELED'],
      ['DONE', 'FAILED'],
      ['CANCELED', 'PENDING'],
      ['CANCELED', 'DONE'],
      ['FAILED', 'PENDING'],
      ['FAILED', 'DONE'],
      ['PROCESSING', 'PENDING'],
      ['PROCESSING', 'REQUESTED'],
      ['PENDING', 'REQUESTED'],
    ] as const)('bloqueia %s → %s (regressão)', (from, to) => {
      expect(isAllowedTransition(from, to)).toBe(false);
    });
  });

  describe('mapTransferStatusToPixTransferSessionStatus', () => {
    it('DONE retorna DONE', () => {
      expect(mapTransferStatusToPixTransferSessionStatus('DONE')).toBe('DONE');
    });

    it.each(['FAILED', 'CANCELED'] as const)('%s retorna FAILED', (status) => {
      expect(mapTransferStatusToPixTransferSessionStatus(status)).toBe('FAILED');
    });

    it.each(['REQUESTED', 'PENDING', 'PROCESSING'] as const)('%s retorna null (não terminal)', (status) => {
      expect(mapTransferStatusToPixTransferSessionStatus(status)).toBeNull();
    });

    it('BLOCKED retorna null — aguardando SMS token, não falha a sessão', () => {
      expect(mapTransferStatusToPixTransferSessionStatus('BLOCKED')).toBeNull();
    });
  });
});
