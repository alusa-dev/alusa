import { renderHook } from '@testing-library/react';
import { DEFAULT_SEAT_BLOCK_CONFIG } from '@alusa/domain';
import type { EventMapDTO, MapSelectionItem } from '@alusa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { useSelectionSession } from '../sessions/use-selection-session';
import { buildParametricDragNodeIds } from '../sessions/use-map-node-drag-session';

function createMap(): EventMapDTO {
  return {
    id: 'map-selection-test',
    contaId: 'conta-test',
    eventId: 'event-test',
    event: { id: 'event-test', name: 'Evento', startsAt: '2026-01-01T00:00:00.000Z', status: 'DRAFT', ticketMode: 'SEATED' },
    name: 'Mapa',
    status: 'DRAFT',
    publishedVersionId: null,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1200, heightPx: 800, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seats: [],
    versions: [],
    document: { schemaVersion: 1, sections: [], visualElements: [] },
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
  };
}

describe('useSelectionSession parametric transform nodes', () => {
  beforeEach(() => {
    useEventMapEditorStore.getState().loadMap(createMap());
  });

  it('uses one proxy when both a block and its row are selected with a shape', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 });
    const map = useEventMapEditorStore.getState().map!;
    const block = map.document!.sections[0]!.blocks[0]!;
    const row = block.rows[0]!;
    const selection: MapSelectionItem[] = [
      { type: 'seatblock', id: block.id },
      { type: 'seatrow', id: row.id },
      { type: 'object', id: objectId! },
    ];

    const { result } = renderHook(() => useSelectionSession({
      map,
      selection,
      levelObjects: map.objects,
      levelSeats: map.seats,
      setSelection: vi.fn(),
      clearIndividualSeatDrag: vi.fn(),
    }));

    expect(result.current.selectedParametricItems).toEqual([{ type: 'seatblock', id: block.id }]);
    expect(result.current.selectedNodeIds).toEqual([`node-${objectId}`, `node-seatblock-${block.id}`]);
    expect(result.current.selectedNodeIds).not.toContain(`node-seatrow-${row.id}`);
    for (const seatId of block.rows.flatMap((entry) => entry.seatIds)) {
      expect(result.current.selectedNodeIds).not.toContain(`node-${seatId}`);
    }
  });

  it('selects a complete row proxy alongside a shape without including its seat nodes twice', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 });
    const map = useEventMapEditorStore.getState().map!;
    const row = map.document!.sections[0]!.blocks[0]!.rows[0]!;
    const selection: MapSelectionItem[] = [
      { type: 'seatrow', id: row.id },
      { type: 'object', id: objectId! },
    ];

    const { result } = renderHook(() => useSelectionSession({
      map,
      selection,
      levelObjects: map.objects,
      levelSeats: map.seats,
      setSelection: vi.fn(),
      clearIndividualSeatDrag: vi.fn(),
    }));

    expect(result.current.selectedParametricItems).toEqual([{ type: 'seatrow', id: row.id }]);
    expect(result.current.selectedNodeIds).toEqual([`node-${objectId}`, `node-seatrow-${row.id}`]);
    for (const seatId of row.seatIds) expect(result.current.selectedNodeIds).not.toContain(`node-${seatId}`);
  });
});

describe('buildParametricDragNodeIds', () => {
  it('includes seats, row visuals, row proxies and block proxies in a mixed drag group', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 });
    const map = useEventMapEditorStore.getState().map!;
    const block = map.document!.sections[0]!.blocks[0]!;

    const mixedGroupNodeIds = [...new Set([
      `node-${objectId}`,
      ...buildParametricDragNodeIds(map, [{ type: 'seatblock', id: block.id }]),
    ])];

    for (const seatId of block.rows.flatMap((row) => row.seatIds)) expect(mixedGroupNodeIds).toContain(`node-${seatId}`);
    for (const row of block.rows) {
      expect(mixedGroupNodeIds).toContain(`node-seatrow-line-${row.id}`);
      expect(mixedGroupNodeIds).toContain(`node-seatrow-label-${row.id}`);
      expect(mixedGroupNodeIds).toContain(`node-seatrow-${row.id}`);
    }
    expect(mixedGroupNodeIds).toContain(`node-seatblock-${block.id}`);
    expect(mixedGroupNodeIds).toContain(`node-${objectId}`);
  });
});
