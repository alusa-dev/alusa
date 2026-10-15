import { describe, expect, it } from 'vitest';

import {
  addAcademicDays,
  getAcademicDateBoundsForInstant,
  getAcademicDateKey,
  getAcademicDateStartInstant,
  getCurrentAcademicDateKey,
  isAcademicDateInFuture,
} from './date-only';
import { formatPaymentDate, getPaymentDateKey, parseOptionalPaymentDate, parsePaymentDate } from './formatters/date';

describe('academic date semantics in shared', () => {
  const instant = new Date('2026-09-07T03:00:00.000Z');

  it('preserva a data civil armazenada e o timezone da Conta', () => {
    expect(getAcademicDateKey('2026-09-07T12:00:00.000Z')).toBe('2026-09-07');
    expect(getCurrentAcademicDateKey(instant, 'America/Manaus')).toBe('2026-09-06');
    expect(getAcademicDateBoundsForInstant(instant, 'America/Sao_Paulo').dateKey).toBe('2026-09-07');
  });

  it('calcula avanço e vigência por dia civil', () => {
    expect(addAcademicDays('2026-09-07', 1)).toBe('2026-09-08');
    expect(isAcademicDateInFuture('2026-09-08', instant, 'America/Sao_Paulo')).toBe(true);
  });

  it('resolve a meia-noite local no timezone acadêmico da Conta', () => {
    expect(getAcademicDateStartInstant('2026-09-07', 'America/Manaus'))
      .toEqual(new Date('2026-09-07T04:00:00.000Z'));
    expect(getAcademicDateStartInstant('2026-09-07', 'UTC'))
      .toEqual(new Date('2026-09-07T00:00:00.000Z'));
  });

  it('normaliza timezone inválido pelo padrão acadêmico existente', () => {
    expect(getAcademicDateStartInstant('2026-09-07', 'Not/A_Timezone'))
      .toEqual(new Date('2026-09-07T03:00:00.000Z'));
  });
});

describe('payment date formatting', () => {
  it('preserva datas civis serializadas e converte instantes reais no fuso informado', () => {
    const dateOnly = '2026-03-27T00:00:00.000Z';
    const instant = '2026-03-27T02:30:00.000Z';

    expect(formatPaymentDate(dateOnly, 'America/Los_Angeles')).toBe('27/03/2026');
    expect(formatPaymentDate(dateOnly, 'Pacific/Kiritimati')).toBe('27/03/2026');
    expect(formatPaymentDate(instant, 'America/Los_Angeles')).toBe('26/03/2026');
    expect(formatPaymentDate(instant, 'Pacific/Kiritimati')).toBe('27/03/2026');
    expect(formatPaymentDate('2026-03-27T00:00:00.000Z', 'America/Los_Angeles', { dateOnly: false }))
      .toBe('26/03/2026');
    expect(getPaymentDateKey(dateOnly)).toBe('2026-03-27');
    expect(getPaymentDateKey(dateOnly, 'America/Los_Angeles', { dateOnly: false })).toBe('2026-03-26');
    expect(parsePaymentDate('2026-03-27').toISOString()).toBe('2026-03-27T00:00:00.000Z');
    expect(parsePaymentDate(instant).toISOString()).toBe(instant);
    expect(() => parsePaymentDate('2026-02-30')).toThrow(RangeError);
    expect(() => parsePaymentDate('2026-02-30T00:00:00.000Z')).toThrow(RangeError);
    expect(formatPaymentDate('2026-02-30')).toBeNull();
    expect(formatPaymentDate('2026-02-30T00:00:00.000Z')).toBeNull();
    expect(getPaymentDateKey('2026-02-30')).toBeNull();
    expect(getPaymentDateKey('2026-02-30T00:00:00.000Z')).toBeNull();
    expect(parseOptionalPaymentDate('2026-02-30')).toBeUndefined();
    expect(parseOptionalPaymentDate(undefined)).toBeNull();
    expect(parseOptionalPaymentDate('2026-03-27')).toEqual(new Date('2026-03-27T00:00:00.000Z'));
  });
});
