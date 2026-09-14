import { addDays, dateKey, getAgendaRange, getMonthGrid } from './date';

describe('agenda date helpers', () => {
  it('usa domingo como início da semana exibida', () => {
    const anchor = new Date(2026, 8, 16, 12, 0, 0);
    const range = getAgendaRange(anchor, 'week');

    expect(dateKey(range.start)).toBe('2026-09-13');
    expect(dateKey(range.end)).toBe('2026-09-19');
  });

  it('monta uma grade mensal completa com 42 dias', () => {
    const days = getMonthGrid(new Date(2026, 8, 16, 12, 0, 0));

    expect(days).toHaveLength(42);
    expect(dateKey(days[0])).toBe('2026-08-30');
    expect(dateKey(days[41])).toBe('2026-10-10');
  });

  it('adiciona dias sem alterar a data original', () => {
    const original = new Date(2026, 8, 13, 12, 0, 0);
    const next = addDays(original, 7);

    expect(dateKey(original)).toBe('2026-09-13');
    expect(dateKey(next)).toBe('2026-09-20');
  });
});
