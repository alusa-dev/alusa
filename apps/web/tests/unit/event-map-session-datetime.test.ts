import { afterEach, describe, expect, it } from 'vitest';

import {
  formatMapSessionDateTime,
  mapSessionDateTimeToIso,
} from '../../features/events/map/session-datetime';

describe('mapSessionDateTimeToIso', () => {
  const originalTimezone = process.env.TZ;

  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati'])('preserves civil components with runtime timezone %s', (timezone) => {
    process.env.TZ = timezone;
    expect(mapSessionDateTimeToIso('2026-01-01T00:15')).toBe('2026-01-01T00:15:00.000Z');
  });

  it('preserves the last minute of a calendar day', () => {
    expect(mapSessionDateTimeToIso('2026-12-31T23:59')).toBe('2026-12-31T23:59:00.000Z');
  });

  it('round-trips and formats map session wall-clock values without runtime timezone conversion', () => {
    process.env.TZ = 'America/Manaus';
    const value = mapSessionDateTimeToIso('2026-11-14T18:00');
    expect(value).toBe('2026-11-14T18:00:00.000Z');
    expect(formatMapSessionDateTime(value, '2026-11-14T18:00')).toContain('18:00');
  });

  it('retains runtime-local formatting for legacy dates without an explicit local value', () => {
    process.env.TZ = 'America/Manaus';
    expect(formatMapSessionDateTime('2026-11-14T18:00:00.000Z')).toContain('14:00');
  });

  it('rejects invalid and incomplete values', () => {
    expect(mapSessionDateTimeToIso('2026-02-30T12:00')).toBeNull();
    expect(mapSessionDateTimeToIso('')).toBeNull();
  });
});
