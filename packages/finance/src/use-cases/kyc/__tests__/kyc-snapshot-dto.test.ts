import { describe, it, expect } from 'vitest';
import { normalizeAreaStatus, isAreaBlocking } from '../../../dtos/kyc/kyc-snapshot.dto';

describe('normalizeAreaStatus', () => {
  it.each([
    ['APPROVED', 'APPROVED'],
    ['REJECTED', 'REJECTED'],
    ['AWAITING_APPROVAL', 'AWAITING_APPROVAL'],
    ['PENDING', 'PENDING'],
    ['NOT_SENT', 'NOT_SENT'],
  ] as const)('normaliza %s → %s', (input, expected) => {
    expect(normalizeAreaStatus(input)).toBe(expected);
  });

  it('normaliza lowercase → uppercase', () => {
    expect(normalizeAreaStatus('approved')).toBe('APPROVED');
    expect(normalizeAreaStatus('pending')).toBe('PENDING');
  });

  it('normaliza com espaços em branco', () => {
    expect(normalizeAreaStatus('  APPROVED  ')).toBe('APPROVED');
  });

  it('retorna UNKNOWN para valores desconhecidos', () => {
    expect(normalizeAreaStatus('SOMETHING_ELSE')).toBe('UNKNOWN');
    expect(normalizeAreaStatus('')).toBe('UNKNOWN');
  });

  it('não confunde COMMERCIAL_INFO (EXPIRED/EXPIRING_SOON) com status KYC', () => {
    expect(normalizeAreaStatus('EXPIRED')).toBe('UNKNOWN');
    expect(normalizeAreaStatus('EXPIRING_SOON')).toBe('UNKNOWN');
  });

  it('retorna UNKNOWN para null/undefined', () => {
    expect(normalizeAreaStatus(null)).toBe('UNKNOWN');
    expect(normalizeAreaStatus(undefined)).toBe('UNKNOWN');
  });
});

describe('isAreaBlocking', () => {
  it('APPROVED não bloqueia', () => {
    expect(isAreaBlocking('APPROVED')).toBe(false);
  });

  it.each(['PENDING', 'NOT_SENT', 'REJECTED', 'AWAITING_APPROVAL', 'UNKNOWN'] as const)(
    '%s bloqueia',
    (status) => {
      expect(isAreaBlocking(status)).toBe(true);
    },
  );
});
