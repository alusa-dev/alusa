import { describe, expect, it } from 'vitest';

import {
  buildZonedAgendaRangeIso,
  formatAgendaPeriodLabel,
  formatAgendaTimeLabel,
} from '@/lib/agenda-timezone';

describe('agenda timezone helpers', () => {
  it('formats a weekly period in the account timezone', () => {
    const range = buildZonedAgendaRangeIso(
      new Date('2026-08-05T12:00:00.000Z'),
      'week',
      'America/Sao_Paulo',
    );

    expect(formatAgendaPeriodLabel(range.start, range.end, 'week', 'America/Sao_Paulo')).toBe(
      '02–08 de agosto de 2026',
    );
  });

  it('formats a monthly period and a wall-clock time in the account timezone', () => {
    const range = buildZonedAgendaRangeIso(
      new Date('2026-08-05T12:00:00.000Z'),
      'month-detailed',
      'America/Manaus',
    );

    expect(formatAgendaPeriodLabel(range.start, range.end, 'month-detailed', 'America/Manaus')).toBe(
      'agosto de 2026',
    );
    expect(formatAgendaTimeLabel('2026-08-05T13:30:00.000Z', 'America/Sao_Paulo')).toBe('10:30');
  });
});
