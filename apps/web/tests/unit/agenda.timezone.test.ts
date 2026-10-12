import { describe, expect, it } from 'vitest';

import {
  buildZonedAgendaRangeIso,
  formatAgendaPeriodLabel,
  formatAgendaTimeLabel,
  shiftZonedAgendaAnchor,
} from '@/lib/agenda-timezone';
import { agendaViewModeSchema } from '@/features/lessons/dtos';

describe('agenda timezone helpers', () => {
  it('accepts the day calendar mode in agenda queries', () => {
    expect(agendaViewModeSchema.parse('day')).toBe('day');
  });

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

  it('builds a single account-local day range in the configured timezone', () => {
    const range = buildZonedAgendaRangeIso(
      new Date('2026-08-05T12:00:00.000Z'),
      'day',
      'America/Manaus',
    );

    expect(range.start).toBe('2026-08-05T04:00:00.000Z');
    expect(range.end).toBe('2026-08-06T03:59:59.999Z');
    expect(formatAgendaPeriodLabel(range.start, range.end, 'day', 'America/Manaus')).toBe(
      '05 de agosto de 2026',
    );
  });

  it.each([
    ['day', '2026-08-04T04:00:00.000Z'],
    ['week', '2026-07-26T04:00:00.000Z'],
    ['month-detailed', '2026-07-01T04:00:00.000Z'],
  ] as const)('navigates to the previous %s range in the account timezone', (viewMode, expectedStart) => {
    const anchor = new Date('2026-08-05T12:00:00.000Z');
    const shiftedAnchor = shiftZonedAgendaAnchor(anchor, viewMode, 'prev', 'America/Manaus');
    const range = buildZonedAgendaRangeIso(shiftedAnchor, viewMode, 'America/Manaus');

    expect(range.start).toBe(expectedStart);
  });
});
