/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';

import { buildConflictMap } from '@/src/server/aulas/calendar/calendar-core.service';

describe('calendar-core.service', () => {
  it('detecta conflitos simultâneos de sala e professor', () => {
    const events = [
      {
        id: 'event-1',
        titulo: 'Ballet Kids',
        startAt: new Date('2026-03-20T18:00:00.000Z'),
        endAt: new Date('2026-03-20T19:00:00.000Z'),
        salaId: 'sala-1',
        professores: [{ professorId: 'prof-1' }],
      },
      {
        id: 'event-2',
        titulo: 'Jazz Teen',
        startAt: new Date('2026-03-20T18:30:00.000Z'),
        endAt: new Date('2026-03-20T19:30:00.000Z'),
        salaId: 'sala-1',
        professores: [{ professorId: 'prof-1' }],
      },
    ] as unknown as Parameters<typeof buildConflictMap>[0];

    const conflictMap = buildConflictMap(events);

    expect(conflictMap.get('event-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'SALA', relatedEventId: 'event-2' }),
        expect.objectContaining({ type: 'PROFESSOR', relatedEventId: 'event-2' }),
      ]),
    );
    expect(conflictMap.get('event-2')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'SALA', relatedEventId: 'event-1' }),
        expect.objectContaining({ type: 'PROFESSOR', relatedEventId: 'event-1' }),
      ]),
    );
  });
});
