import type { EventMapDTO } from '../types/event-map-types.js';
import {
  findSeatGroupForSection,
  getSeatGroupSectionId,
  isSeatedSectorLayerSelected,
  resolveSeatedSectorContext,
  resolveSeatedSectorFromSelection,
} from '../selection/seated-sector.js';

import { describe, expect, it } from 'vitest';

function createMap(): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'SEATED' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
    sections: [
      {
        id: 'section-1',
        levelId: 'level-1',
        lotId: null,
        lot: null,
        name: 'Setor 1',
        color: '#6d28d9',
        capacity: 4,
        status: 'ACTIVE',
        notes: null,
      },
    ],
    objects: [
      {
        id: 'object-1',
        levelId: 'level-1',
        sectionId: 'section-1',
        type: 'SECTION',
        data: { label: 'Setor 1', fill: '#6d28d9' },
        x: 100,
        y: 100,
        width: 200,
        height: 120,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 0,
      },
    ],
    seatGroups: [
      {
        id: 'group-1',
        levelId: 'level-1',
        name: 'Setor 1',
        x: 120,
        y: 120,
        rotation: 0,
        rows: 2,
        columns: 2,
        seatWidth: 24,
        seatHeight: 24,
        gapX: 10,
        gapY: 8,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        numbering: {},
        locked: false,
      },
    ],
    seats: [
      {
        id: 'seat-1',
        levelId: 'level-1',
        sectionId: 'section-1',
        objectId: null,
        groupId: 'group-1',
        rowIndex: 0,
        columnIndex: 0,
        technicalCode: 'SETOR-1-A1',
        displayLabel: 'A1',
        rowLabel: 'A',
        seatNumber: '1',
        status: 'AVAILABLE',
        accessible: false,
        publicVisible: true,
        x: 120,
        y: 120,
        size: 24,
        rotation: 0,
      },
    ],
    versions: [],
    counts: { levels: 1, sections: 1, seats: 1, availableSeats: 1 },
  };
}

describe('seated-sector', () => {
  it('links seat groups to their section through seats', () => {
    const map = createMap();
    expect(getSeatGroupSectionId(map.seatGroups![0]!, map.seats)).toBe('section-1');
    expect(findSeatGroupForSection(map, 'section-1')?.id).toBe('group-1');
  });

  it('resolves the same seated sector from section or seat group selection', () => {
    const map = createMap();
    const fromSection = resolveSeatedSectorContext(map, { type: 'section', id: 'section-1' });
    const fromGroup = resolveSeatedSectorContext(map, { type: 'seatgroup', id: 'group-1' });

    expect(fromSection?.section.id).toBe('section-1');
    expect(fromSection?.seatGroup.id).toBe('group-1');
    expect(fromGroup).toEqual(fromSection);
  });

  it('highlights the section layer when its seat group is selected on the canvas', () => {
    const map = createMap();
    const selection = [{ type: 'seatgroup' as const, id: 'group-1' }];

    expect(resolveSeatedSectorFromSelection(map, selection)?.section.id).toBe('section-1');
    expect(isSeatedSectorLayerSelected(map, selection, 'section-1')).toBe(true);
  });
});
