import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  formatDateOnlyInBrazil,
  isInvoiceEffectiveDateValid,
  resolveInvoiceEffectiveDate,
  todayInBrazil,
} from '../invoice-effective-date';

describe('invoice-effective-date', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formata data no fuso de São Paulo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T03:00:00.000Z'));

    expect(formatDateOnlyInBrazil(new Date('2026-06-15T03:00:00.000Z'))).toBe('2026-06-15');
    expect(todayInBrazil()).toBe('2026-06-16');
  });

  it('usa hoje quando vencimento está no passado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));

    expect(resolveInvoiceEffectiveDate(new Date('2026-06-05T12:00:00.000Z'))).toBe('2026-06-16');
  });

  it('mantém vencimento futuro', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));

    expect(resolveInvoiceEffectiveDate('2026-07-01')).toBe('2026-07-01');
  });

  it('respeita override explícito', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00.000Z'));

    expect(resolveInvoiceEffectiveDate('2026-06-05', '2026-06-20')).toBe('2026-06-20');
  });

  it('valida data mínima', () => {
    expect(isInvoiceEffectiveDateValid('2026-06-16', '2026-06-16')).toBe(true);
    expect(isInvoiceEffectiveDateValid('2026-06-15', '2026-06-16')).toBe(false);
  });
});
