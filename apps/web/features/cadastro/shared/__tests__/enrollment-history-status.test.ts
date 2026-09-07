import { describe, expect, it } from 'vitest';

import {
  getEnrollmentHistoryStatusLabel,
  getEnrollmentHistoryStatusVariant,
} from '../enrollment-history-status';

describe('enrollment history status', () => {
  const timeZone = 'America/Sao_Paulo';

  it('shows an active enrollment that starts today as active before noon UTC', () => {
    const now = new Date('2026-09-07T04:30:00.000Z');
    const start = '2026-09-07T12:00:00.000Z';

    expect(getEnrollmentHistoryStatusLabel('ATIVA', start, timeZone, now)).toBe('Ativa');
    expect(getEnrollmentHistoryStatusVariant('ATIVA', start, timeZone, now)).toBe('success');
  });

  it('shows the same enrollment as active after noon UTC', () => {
    const now = new Date('2026-09-07T18:00:00.000Z');
    const start = '2026-09-07T12:00:00.000Z';

    expect(getEnrollmentHistoryStatusLabel('ATIVA', start, timeZone, now)).toBe('Ativa');
  });

  it('shows tomorrow as upcoming and preserves non-active status labels', () => {
    const now = new Date('2026-09-07T04:30:00.000Z');

    expect(
      getEnrollmentHistoryStatusLabel('ATIVA', '2026-09-08T12:00:00.000Z', timeZone, now),
    ).toBe('Próxima');
    expect(
      getEnrollmentHistoryStatusLabel('PAUSADA', '2026-09-08T12:00:00.000Z', timeZone, now),
    ).toBe('Pausada');
  });

  it('follows the tenant calendar for Manaus near midnight', () => {
    const now = new Date('2026-09-07T04:59:00.000Z');

    expect(
      getEnrollmentHistoryStatusLabel('ATIVA', '2026-09-07T12:00:00.000Z', 'America/Manaus', now),
    ).toBe('Ativa');
    expect(
      getEnrollmentHistoryStatusLabel('ATIVA', '2026-09-08T12:00:00.000Z', 'America/Manaus', now),
    ).toBe('Próxima');
  });
});
