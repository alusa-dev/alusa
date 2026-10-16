import { describe, expect, it } from 'vitest';

import {
  parseCivilDatePreservingInstant,
  parseFirstValidCivilDatePreservingInstant,
  parseOptionalCivilDatePreservingInstant,
} from '../civil-date';

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Map(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}`;
}

describe('parseCivilDatePreservingInstant', () => {
  it.each(['America/Rio_Branco', 'America/Manaus', 'America/Sao_Paulo', 'America/Fortaleza'])(
    'preserva 2026-10-14 como data civil em %s',
    (timeZone) => {
      const parsed = parseCivilDatePreservingInstant('2026-10-14');
      expect(parsed).not.toBeNull();
      expect(dateKeyInTimeZone(parsed!, timeZone)).toBe('2026-10-14');
    },
  );

  it('preserva o instante de timestamps com horário e offset', () => {
    expect(parseCivilDatePreservingInstant('2026-10-14T02:15:30-03:00')?.toISOString())
      .toBe('2026-10-14T05:15:30.000Z');
  });

  it('rejeita data civil inválida', () => {
    expect(parseCivilDatePreservingInstant('2026-02-30')).toBeNull();
    expect(parseCivilDatePreservingInstant('2026-02-30T00:00:00.000Z')).toBeNull();
  });

  it('escolhe a primeira data válida respeitando a preferência entre fontes', () => {
    expect(parseFirstValidCivilDatePreservingInstant('2026-02-30', '2026-10-14')?.toISOString())
      .toBe('2026-10-14T12:00:00.000Z');
    expect(parseFirstValidCivilDatePreservingInstant('2026-10-13', '2026-10-14')?.toISOString())
      .toBe('2026-10-13T12:00:00.000Z');
    expect(parseFirstValidCivilDatePreservingInstant('invalid', null)).toBeNull();
  });

  it('distingue data ausente de valor inválido para preservar dados já persistidos', () => {
    expect(parseOptionalCivilDatePreservingInstant(null)).toBeNull();
    expect(parseOptionalCivilDatePreservingInstant('')).toBeNull();
    expect(parseOptionalCivilDatePreservingInstant('   ')).toBeUndefined();
    expect(parseOptionalCivilDatePreservingInstant('2026-02-30')).toBeUndefined();
  });
});
