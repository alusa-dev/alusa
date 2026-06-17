import { sortLevelPanelChildren } from '../doc/levels.js';
import { buildLevelRenderStack } from '../layout/render-layer-order.js';
import {
  buildLevelLayerSortOrderPatches,
  reorderLevelPanelChildItems,
} from '../operations/layers/reorder-level-layers.js';
import type { EventMapDTO, EventMapObjectDTO } from '../types/event-map-types.js';

import { describe, expect, it } from 'vitest';

function object(partial: Partial<EventMapObjectDTO> & Pick<EventMapObjectDTO, 'id'>): EventMapObjectDTO {
  return {
    levelId: 'level-1',
    sectionId: null,
    type: 'RECT',
    data: { label: partial.id },
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: 0,
    ...partial,
  };
}

function map(partial: Partial<EventMapDTO>): EventMapDTO {
  return {
    id: 'map-1',
    contaId: 'conta-1',
    eventId: 'event-1',
    event: { id: 'event-1', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'NUMBERED_SEATS' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1440, heightPx: 900, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seatGroups: [],
    seats: [],
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
    ...partial,
  };
}

describe('reorderLevelPanelChildItems', () => {
  it('moves an item to a new index', () => {
    const items = sortLevelPanelChildren([], [object({ id: 'a', sortOrder: 2 }), object({ id: 'b', sortOrder: 1 }), object({ id: 'c', sortOrder: 0 })], 'level-1');
    const reordered = reorderLevelPanelChildItems(items, 2, 0);

    expect(reordered.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('buildLevelLayerSortOrderPatches', () => {
  it('assigns higher sortOrder to items at the top of the panel list', () => {
    const stage = object({ id: 'stage', type: 'STAGE', sortOrder: 0 });
    const square = object({ id: 'square', sortOrder: 1 });
    const sectionObject = object({ id: 'section-object', type: 'SECTION', sectionId: 'section-1', sortOrder: 2 });
    const currentMap = map({
      sections: [{ id: 'section-1', levelId: 'level-1', lotId: null, lot: null, name: 'Setor 1', color: '#6d28d9', capacity: 4, status: 'ACTIVE', notes: null }],
      objects: [stage, square, sectionObject],
      seatGroups: [{ id: 'group-1', levelId: 'level-1', name: 'Setor 1', x: 0, y: 0, rotation: 0, rows: 2, columns: 2, seatWidth: 24, seatHeight: 24, gapX: 4, gapY: 4, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, locked: false, hidden: false }],
      seats: [{ id: 'seat-1', levelId: 'level-1', sectionId: 'section-1', groupId: 'group-1', status: 'AVAILABLE', publicVisible: true, displayLabel: 'A1', technicalCode: 'A1', rowLabel: 'A', seatNumber: '1', rowIndex: 0, columnIndex: 0, x: 10, y: 10, size: 24, rotation: 0 }],
    });

    const panelItems = sortLevelPanelChildren(currentMap.sections, currentMap.objects, 'level-1');
    const reordered = reorderLevelPanelChildItems(panelItems, panelItems.findIndex((item) => item.id === 'section-1'), 0);
    const patches = buildLevelLayerSortOrderPatches(currentMap, reordered);
    const nextObjects = currentMap.objects.map((entry) => {
      const patch = patches.find((candidate) => candidate.id === entry.id);
      return patch ? { ...entry, ...patch.patch } : entry;
    });
    const stack = buildLevelRenderStack({ ...currentMap, objects: nextObjects }, 'level-1');

    expect(reordered[0]?.id).toBe('section-1');
    expect(patches.find((patch) => patch.id === 'section-object')?.patch.sortOrder).toBe(2);
    expect(patches.find((patch) => patch.id === 'stage')?.patch.sortOrder).toBe(0);
    expect(stack.at(-1)).toMatchObject({ kind: 'seatGroup', id: 'group-1' });
    expect(stack.at(-2)).toMatchObject({ kind: 'object', id: 'square' });
    expect(stack.at(-1)?.sortOrder).toBeGreaterThan(stack[0]?.sortOrder ?? -1);
  });
});
