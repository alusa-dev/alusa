import { describe, it, expect } from 'vitest';
import {
  parseExternalReference,
  buildExternalReference,
  isExternalReferenceOfType,
  extractIdFromExternalReference,
} from '../external-reference';

describe('parseExternalReference', () => {
  it('retorna null para valores falsy', () => {
    expect(parseExternalReference(null)).toBeNull();
    expect(parseExternalReference(undefined)).toBeNull();
    expect(parseExternalReference('')).toBeNull();
  });

  it('faz parse de subscription', () => {
    const result = parseExternalReference('subscription:sub123');
    expect(result).toEqual({
      type: 'subscription',
      id: 'sub123',
      raw: 'subscription:sub123',
    });
  });

  it('faz parse de installmentPlan', () => {
    const result = parseExternalReference('installmentPlan:ip456');
    expect(result).toEqual({
      type: 'installmentPlan',
      id: 'ip456',
      raw: 'installmentPlan:ip456',
    });
  });

  it('faz parse de standaloneCharge', () => {
    const result = parseExternalReference('standaloneCharge:ch789');
    expect(result).toEqual({
      type: 'standaloneCharge',
      id: 'ch789',
      raw: 'standaloneCharge:ch789',
    });
  });

  it('faz parse de charge', () => {
    const result = parseExternalReference('charge:cob123');
    expect(result).toEqual({
      type: 'charge',
      id: 'cob123',
      raw: 'charge:cob123',
    });
  });

  it('faz parse de transfer', () => {
    const result = parseExternalReference('transfer:tr999');
    expect(result).toEqual({
      type: 'transfer',
      id: 'tr999',
      raw: 'transfer:tr999',
    });
  });

  it('faz parse de standalone (legado)', () => {
    const result = parseExternalReference('standalone:abc');
    expect(result).toEqual({
      type: 'standalone',
      id: 'abc',
      raw: 'standalone:abc',
    });
  });

  it('retorna unknown para formato desconhecido', () => {
    const result = parseExternalReference('some-random-id');
    expect(result).toEqual({
      type: 'unknown',
      id: 'some-random-id',
      raw: 'some-random-id',
    });
  });
});

describe('buildExternalReference', () => {
  it('constrói subscription', () => {
    expect(buildExternalReference('subscription', 'sub1')).toBe('subscription:sub1');
  });

  it('constrói installmentPlan', () => {
    expect(buildExternalReference('installmentPlan', 'ip1')).toBe('installmentPlan:ip1');
  });

  it('constrói standaloneCharge', () => {
    expect(buildExternalReference('standaloneCharge', 'ch1')).toBe('standaloneCharge:ch1');
  });

  it('constrói charge', () => {
    expect(buildExternalReference('charge', 'cob1')).toBe('charge:cob1');
  });

  it('constrói transfer', () => {
    expect(buildExternalReference('transfer', 'tr1')).toBe('transfer:tr1');
  });
});

describe('isExternalReferenceOfType', () => {
  it('retorna true quando tipo corresponde', () => {
    expect(isExternalReferenceOfType('subscription:s1', 'subscription')).toBe(true);
    expect(isExternalReferenceOfType('installmentPlan:ip1', 'installmentPlan')).toBe(true);
  });

  it('retorna false quando tipo não corresponde', () => {
    expect(isExternalReferenceOfType('subscription:s1', 'installmentPlan')).toBe(false);
  });

  it('retorna false para null/undefined', () => {
    expect(isExternalReferenceOfType(null, 'subscription')).toBe(false);
    expect(isExternalReferenceOfType(undefined, 'subscription')).toBe(false);
  });
});

describe('extractIdFromExternalReference', () => {
  it('extrai ID quando tipo corresponde', () => {
    expect(extractIdFromExternalReference('subscription:sub123', 'subscription')).toBe('sub123');
  });

  it('retorna null quando tipo não corresponde', () => {
    expect(extractIdFromExternalReference('subscription:sub123', 'charge')).toBeNull();
  });

  it('retorna null para null/undefined', () => {
    expect(extractIdFromExternalReference(null, 'subscription')).toBeNull();
  });
});
