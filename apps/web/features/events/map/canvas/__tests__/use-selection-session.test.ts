import { renderHook } from '@testing-library/react';
import { DEFAULT_SEAT_BLOCK_CONFIG } from '@alusa/domain';
import type { EventMapDTO, MapSelectionItem } from '@alusa/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEventMapEditorStore } from '../../store/event-map-editor-store';
import { useSelectionSession } from '../sessions/use-selection-session';
import { buildParametricDragNodeIds, resolveSelectedParametricDragItems } from '../sessions/use-map-node-drag-session';

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

  it('keeps a selected sector together with ordinary map objects', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 });
    const map = useEventMapEditorStore.getState().map!;
    const section = map.document!.sections[0]!;
    const block = section.blocks[0]!;
    const selection: MapSelectionItem[] = [
      { type: 'section', id: section.id },
      { type: 'object', id: objectId! },
    ];
    expect(resolveSelectedParametricDragItems(map, selection)).toEqual([
      { type: 'seatblock', id: section.blocks[0]!.id },
    ]);

    const { result } = renderHook(() => useSelectionSession({
      map,
      selection,
      levelObjects: map.objects,
      levelSeats: map.seats,
      setSelection: vi.fn(),
      clearIndividualSeatDrag: vi.fn(),
    }));

    expect(result.current.selectedParametricItems).toEqual([{ type: 'seatblock', id: block.id }]);
    expect(result.current.selectedNodeIds).toContain(`node-${objectId}`);
    expect(result.current.selectedNodeIds).toContain(`node-seatblock-${block.id}`);
    for (const seatId of block.rows.flatMap((row) => row.seatIds)) {
      expect(result.current.selectedNodeIds).not.toContain(`node-${seatId}`);
    }
  });

  it('transforms a selected sector and shape through the expanded parametric items', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 });
    const before = useEventMapEditorStore.getState().map!;
    const section = before.document!.sections[0]!;
    const block = section.blocks[0]!;
    const row = block.rows[0]!;
    if (row.path.type !== 'LINE') throw new Error('Expected line row geometry');
    const start = row.path.start;
    const end = row.path.end;
    const originalSeats = new Map(before.seats.map((seat) => [seat.id, { x: seat.x, y: seat.y }]));
    const shape = before.objects.find((object) => object.id === objectId)!;
    const selection: MapSelectionItem[] = [
      { type: 'section', id: section.id },
      { type: 'object', id: objectId! },
    ];

    const { result } = renderHook(() => useSelectionSession({
      map: before,
      selection,
      levelObjects: before.objects,
      levelSeats: before.seats,
      setSelection: vi.fn(),
      clearIndividualSeatDrag: vi.fn(),
    }));

    expect(result.current.selectedParametricItems).toEqual([{ type: 'seatblock', id: block.id }]);
    expect(result.current.selectedNodeIds).toContain(`node-${objectId}`);
    expect(result.current.selectedNodeIds).toContain(`node-seatblock-${block.id}`);
    for (const seatId of block.rows.flatMap((entry) => entry.seatIds)) {
      expect(result.current.selectedNodeIds).not.toContain(`node-${seatId}`);
    }

    const delta = { x: 24, y: 18 };
    useEventMapEditorStore.getState().transformParametricSelections(
      result.current.selectedParametricItems.map((item) => ({
        item,
        matrix: [1, 0, 0, 1, delta.x, delta.y] as [number, number, number, number, number, number],
      })),
      { objects: [{ id: shape.id, patch: { x: shape.x + delta.x, y: shape.y + delta.y } }] },
    );

    const after = useEventMapEditorStore.getState().map!;
    const movedRow = after.document!.sections[0]!.blocks[0]!.rows[0]!;
    const movedShape = after.objects.find((object) => object.id === objectId)!;
    expect(movedRow.path.type).toBe('LINE');
    if (movedRow.path.type === 'LINE') {
      expect(movedRow.path.start.x).toBeCloseTo(start.x + delta.x);
      expect(movedRow.path.start.y).toBeCloseTo(start.y + delta.y);
      expect(movedRow.path.end.x).toBeCloseTo(end.x + delta.x);
      expect(movedRow.path.end.y).toBeCloseTo(end.y + delta.y);
    }
    expect(movedShape).toMatchObject({ x: shape.x + delta.x, y: shape.y + delta.y });
    for (const [seatId, position] of originalSeats) {
      const movedSeat = after.seats.find((seat) => seat.id === seatId)!;
      expect(movedSeat.x).toBeCloseTo(position.x + delta.x);
      expect(movedSeat.y).toBeCloseTo(position.y + delta.y);
    }
  });

  it('keeps a section and shape aligned through a scaled rotation', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 }, { width: 80, height: 60 });
    const before = useEventMapEditorStore.getState().map!;
    const section = before.document!.sections[0]!;
    const block = section.blocks[0]!;
    const originalRow = block.rows[0]!;
    if (originalRow.path.type !== 'LINE') throw new Error('Expected line row geometry');
    const originalSeats = new Map(before.seats.map((seat) => [seat.id, { x: seat.x, y: seat.y }]));
    const shape = before.objects.find((object) => object.id === objectId)!;
    const shapeWidth = shape.width ?? 80;
    const shapeHeight = shape.height ?? 60;
    const selection: MapSelectionItem[] = [
      { type: 'section', id: section.id },
      { type: 'object', id: objectId! },
    ];
    const { result } = renderHook(() => useSelectionSession({
      map: before,
      selection,
      levelObjects: before.objects,
      levelSeats: before.seats,
      setSelection: vi.fn(),
      clearIndividualSeatDrag: vi.fn(),
    }));

    expect(result.current.selectedParametricItems).toEqual([{ type: 'seatblock', id: block.id }]);
    const matrix: [number, number, number, number, number, number] = [0, -1.25, 1.25, 0, 500, 300];
    const transformWorldPoint = (point: { x: number; y: number }) => ({
      x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
      y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
    });
    const transformSectionPoint = (point: { x: number; y: number }) => {
      const world = { x: point.x + section.position.x, y: point.y + section.position.y };
      const transformed = transformWorldPoint(world);
      return { x: transformed.x - section.position.x, y: transformed.y - section.position.y };
    };
    const shapeCenter = transformWorldPoint({ x: shape.x + shapeWidth / 2, y: shape.y + shapeHeight / 2 });
    const nextShapeWidth = shapeHeight * 1.25;
    const nextShapeHeight = shapeWidth * 1.25;
    const shapePatch = {
      x: shapeCenter.x - nextShapeWidth / 2,
      y: shapeCenter.y - nextShapeHeight / 2,
      width: nextShapeWidth,
      height: nextShapeHeight,
      rotation: 90,
    };

    useEventMapEditorStore.getState().transformParametricSelections(
      result.current.selectedParametricItems.map((item) => ({ item, matrix })),
      { objects: [{ id: shape.id, patch: shapePatch }] },
    );

    const after = useEventMapEditorStore.getState().map!;
    const transformedRow = after.document!.sections[0]!.blocks[0]!.rows[0]!;
    expect(transformedRow.path.type).toBe('LINE');
    if (transformedRow.path.type === 'LINE') {
      expect(transformedRow.path.start).toEqual(transformSectionPoint(originalRow.path.start));
      expect(transformedRow.path.end).toEqual(transformSectionPoint(originalRow.path.end));
    }
    expect(after.objects.find((object) => object.id === objectId)).toMatchObject(shapePatch);
    for (const [seatId, position] of originalSeats) {
      const expected = transformWorldPoint(position);
      const transformedSeat = after.seats.find((seat) => seat.id === seatId)!;
      expect(transformedSeat.x).toBeCloseTo(expected.x);
      expect(transformedSeat.y).toBeCloseTo(expected.y);
    }
  });

  it('marquee-selects parametric sectors and regular shapes in one mixed selection', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 400, y: 200 });
    const map = useEventMapEditorStore.getState().map!;

    const { result } = renderHook(() => useSelectionSession({
      map,
      selection: [],
      levelObjects: map.objects,
      levelSeats: map.seats,
      setSelection: vi.fn(),
      clearIndividualSeatDrag: vi.fn(),
    }));

    const marqueeSelection = result.current.getMarqueeSelection({ x: 0, y: 0, width: 1000, height: 900 });

    expect(marqueeSelection).toContainEqual({ type: 'object', id: objectId });
    expect(marqueeSelection).toContainEqual({ type: 'seatblock', id: map.document!.sections[0]!.blocks[0]!.id });
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
