import { DEFAULT_SEAT_BLOCK_CONFIG } from '@alusa/domain';
import type { EventMapDTO } from '../../api/event-map-service';
import type { MapReferenceChart } from '@alusa/domain';
import { useEventMapEditorStore } from '../event-map-editor-store';
import { describe, expect, it, beforeEach } from 'vitest';

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
    levels: [{ id: 'level-1', name: 'Ambiente 1', sortOrder: 0, widthPx: 1200, heightPx: 800, unit: 'px', scale: null }],
    sections: [],
    objects: [],
    seats: [],
    versions: [],
    document: { schemaVersion: 1, sections: [], visualElements: [] },
    counts: { levels: 1, sections: 0, seats: 0, availableSeats: 0 },
  };
}

describe('event map editor store', () => {
  beforeEach(() => {
    useEventMapEditorStore.getState().loadMap(createMap());
  });

  it('creates a row block as one undoable operation', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, DEFAULT_SEAT_BLOCK_CONFIG);
    const state = useEventMapEditorStore.getState();
    expect(state.map?.document?.sections[0]?.blocks).toHaveLength(1);
    expect(state.map?.document?.sections[0]?.blocks[0]?.rows).toHaveLength(DEFAULT_SEAT_BLOCK_CONFIG.rows);
    expect(state.map?.seats).toHaveLength(DEFAULT_SEAT_BLOCK_CONFIG.totalSeats);

    state.undo();
    expect(useEventMapEditorStore.getState().map?.document?.sections).toHaveLength(0);
    state.redo();
    expect(useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks).toHaveLength(1);
  });

  it('creates every seat block in its own independently sellable section', () => {
    const config = { ...DEFAULT_SEAT_BLOCK_CONFIG, rows: 2, columns: 4, totalSeats: 8 };
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, config);
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 400, y: 100 }, config);

    const map = useEventMapEditorStore.getState().map!;
    const document = map.document!;
    expect(document.sections).toHaveLength(2);
    expect(map.sections.map((section) => section.id)).toEqual(document.sections.map((section) => section.id));
    expect(document.sections.map((section) => section.blocks[0]?.rows.map((row) => row.label))).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(document.sections.map((section) => section.blocks)).toEqual([
      [expect.objectContaining({ sectionId: document.sections[0]!.id })],
      [expect.objectContaining({ sectionId: document.sections[1]!.id })],
    ]);
    expect(new Set(map.seats.map((seat) => seat.sectionId))).toEqual(new Set(map.sections.map((section) => section.id)));
    expect(map.sections.every((section) => section.lotId === null)).toBe(true);
  });

  it('continues row labels alphabetically beyond Z for later seat groups', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 26,
      columns: 1,
      totalSeats: 26,
    });
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 400, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 1,
      totalSeats: 1,
    });

    const sections = useEventMapEditorStore.getState().map!.document!.sections;
    expect(sections[0]!.blocks[0]!.rows.at(-1)?.label).toBe('Z');
    expect(sections[1]!.blocks[0]!.rows[0]?.label).toBe('AA');
  });

  it('duplicates a seat block into a new section instead of appending it to its source', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 4,
      totalSeats: 8,
    });
    let state = useEventMapEditorStore.getState();
    const source = state.map!.document!.sections[0]!;
    state.setSelection({ type: 'seatblock', id: source.blocks[0]!.id });
    state.duplicateSelection();

    state = useEventMapEditorStore.getState();
    const sections = state.map!.document!.sections;
    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.blocks)).toEqual([
      [expect.objectContaining({ sectionId: source.id })],
      [expect.objectContaining({ sectionId: sections[1]!.id })],
    ]);
    expect(sections[1]!.id).not.toBe(source.id);
    expect(sections[1]!.lotId).toBeNull();
    expect(state.map!.seats.filter((seat) => seat.sectionId === sections[1]!.id)).toHaveLength(8);
    expect(state.map!.seats.filter((seat) => seat.sectionId === source.id)).toHaveLength(8);
    expect(sections[1]!.blocks[0]!.rows.map((row) => row.label)).toEqual(['C', 'D']);
  });

  it('duplicates a sector as a separate section and applies the offset only once', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 3,
      totalSeats: 3,
    });
    let state = useEventMapEditorStore.getState();
    const source = state.map!.document!.sections[0]!;
    const sourceSeats = state.map!.seats.filter((seat) => seat.sectionId === source.id);
    state.setSelection({ type: 'section', id: source.id });
    state.duplicateSelection();

    state = useEventMapEditorStore.getState();
    const duplicate = state.map!.document!.sections.find((section) => section.id !== source.id)!;
    const duplicateSeats = state.map!.seats.filter((seat) => seat.sectionId === duplicate.id);
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.lotId).toBeNull();
    expect(duplicateSeats).toHaveLength(sourceSeats.length);
    expect(duplicate.blocks[0]!.rows[0]!.label).toBe('B');
    expect(duplicateSeats[0]!.displayLabel).toBe('B1');
    expect(duplicateSeats[0]!.x - sourceSeats[0]!.x).toBeCloseTo(28);
    expect(duplicateSeats[0]!.y - sourceSeats[0]!.y).toBeCloseTo(28);
  });

  it('updates a row path without recreating its seats', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 4,
      totalSeats: 4,
    });
    const beforeIds = useEventMapEditorStore.getState().map?.seats.map((seat) => seat.id);
    const rowId = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0]?.rows[0]?.id;
    expect(rowId).toBeTruthy();
    useEventMapEditorStore.getState().updateSeatRowPath(rowId!, {
      type: 'ARC',
      center: { x: 100, y: 100 },
      radius: 160,
      startAngle: 0,
      endAngle: Math.PI / 2,
      clockwise: false,
    });
    const state = useEventMapEditorStore.getState();
    expect(state.map?.document?.sections[0]?.blocks[0]?.rows[0]?.path.type).toBe('ARC');
    expect(state.map?.seats.map((seat) => seat.id)).toEqual(beforeIds);
    expect(new Set(state.map?.seats.map((seat) => seat.rotation)).size).toBeGreaterThan(1);
  });

  it('updates seat size and progressive alignment at block level', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 4,
      totalSeats: 8,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      seatSize: 42,
      distributionMode: 'PROGRESSIVE',
      distributionAlignment: 'CENTER',
      firstRowSeatCount: 2,
      lastRowSeatCount: 4,
    });

    const state = useEventMapEditorStore.getState();
    const updatedBlock = state.map?.document?.sections[0]?.blocks[0];
    expect(updatedBlock?.distributionAlignment).toBe('CENTER');
    expect(updatedBlock?.rows.every((row) => row.seatSize === 42)).toBe(true);
    expect(state.map?.seats.every((seat) => seat.size === 42)).toBe(true);
  });

  it('reflows seats after changing size or default spacing instead of keeping stale positions', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 4,
      totalSeats: 8,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, { seatSize: 48, defaultSeatGap: 24 });

    const seats = useEventMapEditorStore.getState().map?.seats ?? [];
    const firstRow = seats.filter((seat) => seat.rowIndex === 0).sort((left, right) => left.x - right.x);
    const secondRow = seats.filter((seat) => seat.rowIndex === 1).sort((left, right) => left.x - right.x);
    expect(firstRow).toHaveLength(4);
    expect(new Set(firstRow.map((seat) => seat.x)).size).toBe(4);
    expect(firstRow[1]!.x - firstRow[0]!.x).toBeCloseTo(72);
    expect(secondRow[0]!.y).toBeGreaterThan(firstRow[0]!.y);
    expect(useEventMapEditorStore.getState().map?.document?.sections[0]?.outline).toEqual([]);
  });

  it('supports changing fixed total seats one at a time across rows', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 4,
      totalSeats: 8,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      distributionMode: 'FIXED',
      distribution: [{ type: 'SEATS', count: 3 }],
      rowSeatCounts: [4, 3],
    });

    const updated = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(updated?.rows.map((row) => row.distribution?.[0])).toEqual([
      { type: 'SEATS', count: 4 },
      { type: 'SEATS', count: 3 },
    ]);
    expect(useEventMapEditorStore.getState().map?.seats).toHaveLength(7);
  });

  it('updates the horizontal column capacity without recreating the block', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 2,
      totalSeats: 4,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      columnCount: 3,
      distributionMode: 'FIXED',
      distribution: [{ type: 'SEATS', count: 3 }],
      rowSeatCounts: [3, 1],
    });

    const updated = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(updated?.columnCount).toBe(3);
    expect(updated?.rows.map((row) => row.distribution?.[0])).toEqual([
      { type: 'SEATS', count: 3 },
      { type: 'SEATS', count: 1 },
    ]);
    expect(useEventMapEditorStore.getState().map?.seats).toHaveLength(4);
  });

  it('wraps new seats into additional rows when the fixed column count is reached', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 4,
      columns: 14,
      totalSeats: 56,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    const nextTotal = 57;
    const rowCounts = [14, 14, 14, 14, 1];
    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      rowSeatCounts: rowCounts,
      distributionMode: 'FIXED',
    });

    const updated = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(updated?.columnCount).toBe(14);
    expect(updated?.rows).toHaveLength(5);
    expect(updated?.rowIds).toHaveLength(5);
    expect(updated?.rows[4]?.label).toBe('E');
    expect(updated?.rows.map((row) => row.distribution?.[0])).toEqual(
      rowCounts.map((count) => ({ type: 'SEATS', count })),
    );
    expect(updated?.rows.map((row) => row.seats.length)).toEqual([14, 14, 14, 14, 14]);
    expect(useEventMapEditorStore.getState().map?.seats).toHaveLength(57);

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      rowSeatCounts: [14, 14, 14, 14],
      distributionMode: 'FIXED',
    });
    const reduced = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(reduced?.columnCount).toBe(14);
    expect(reduced?.rows.map((row) => row.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(useEventMapEditorStore.getState().map?.seats).toHaveLength(56);
  });

  it('moves a seat block and stage in one undoable transaction', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 3,
      columns: 14,
      totalSeats: 42,
    });
    const stageId = useEventMapEditorStore.getState().addObjectAt('stage', { x: 400, y: 40 }, { width: 240, height: 60 });
    expect(stageId).toBeTruthy();
    useEventMapEditorStore.setState({ past: [], future: [] });

    const before = useEventMapEditorStore.getState().map!;
    const seatIds = before.seats.map((seat) => seat.id);
    const initialStage = before.objects.find((object) => object.id === stageId)!;
    const initialSeatPositions = new Map(before.seats.map((seat) => [seat.id, { x: seat.x, y: seat.y }]));
    useEventMapEditorStore.getState().applyTransform({
      type: 'MOVE_OBJECTS',
      payload: { objectIds: [stageId!], seatIds, delta: { x: 80, y: 45 } },
    });

    let state = useEventMapEditorStore.getState();
    expect(state.past).toHaveLength(1);
    expect(state.map?.objects.find((object) => object.id === stageId)).toMatchObject({ x: initialStage.x + 80, y: initialStage.y + 45 });
    expect(state.map?.seats.every((seat) => {
      const initial = initialSeatPositions.get(seat.id)!;
      return Math.abs(seat.x - initial.x - 80) < 0.01 && Math.abs(seat.y - initial.y - 45) < 0.01;
    })).toBe(true);

    state.undo();
    state = useEventMapEditorStore.getState();
    expect(state.map?.objects.find((object) => object.id === stageId)).toMatchObject({ x: initialStage.x, y: initialStage.y });
    expect(state.map?.seats.every((seat) => {
      const initial = initialSeatPositions.get(seat.id)!;
      return Math.abs(seat.x - initial.x) < 0.01 && Math.abs(seat.y - initial.y) < 0.01;
    })).toBe(true);

    state.redo();
    state = useEventMapEditorStore.getState();
    expect(state.map?.objects.find((object) => object.id === stageId)).toMatchObject({ x: initialStage.x + 80, y: initialStage.y + 45 });
    expect(state.map?.seats.every((seat) => {
      const initial = initialSeatPositions.get(seat.id)!;
      return Math.abs(seat.x - initial.x - 80) < 0.01 && Math.abs(seat.y - initial.y - 45) < 0.01;
    })).toBe(true);
  });

  it('supports a fixed block with more than eighty columns', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 81,
      totalSeats: 81,
    });

    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block?.columnCount).toBe(81);
    expect(block?.rows[0]?.seats).toHaveLength(81);
    expect(useEventMapEditorStore.getState().map?.seats).toHaveLength(81);
  });

  it('keeps the seat-block section as a logical container during a complete drag', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 4,
      totalSeats: 8,
    });
    const before = useEventMapEditorStore.getState().map?.document?.sections[0]?.outline ?? [];
    const seatIds = useEventMapEditorStore.getState().map?.seats.map((seat) => seat.id) ?? [];

    useEventMapEditorStore.getState().applyTransform({
      type: 'MOVE_OBJECTS',
      payload: {
        seatIds,
        delta: { x: 20, y: 15 },
      },
    });

    const after = useEventMapEditorStore.getState().map?.document?.sections[0]?.outline ?? [];
    expect(before).toEqual([]);
    expect(after).toEqual([]);
  });

  it('keeps progressive row guides aligned when only the visible seats are dragged', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 4,
      totalSeats: 8,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();
    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      distributionMode: 'PROGRESSIVE',
      firstRowSeatCount: 1,
      lastRowSeatCount: 4,
    });

    const progressiveState = useEventMapEditorStore.getState();
    const progressiveSeats = progressiveState.map?.seats ?? [];
    expect(progressiveState.map?.document?.sections[0]?.outline).toEqual([]);

    const beforeRow = progressiveState.map?.document?.sections[0]?.blocks[0]?.rows[0];
    const visibleFirstRowSeats = progressiveSeats
      .filter((seat) => seat.rowIndex === 0)
      .map((seat) => seat.id);
    expect(visibleFirstRowSeats).toHaveLength(1);
    expect(beforeRow).toBeTruthy();

    useEventMapEditorStore.getState().applyTransform({
      type: 'MOVE_OBJECTS',
      payload: { seatIds: visibleFirstRowSeats, delta: { x: 20, y: 15 } },
    });

    const afterRow = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0]?.rows[0];
    expect(afterRow?.path.type).toBe('LINE');
    if (afterRow?.path.type === 'LINE' && beforeRow?.path.type === 'LINE') {
      expect(afterRow.path.start.x).toBeCloseTo(beforeRow.path.start.x + 20);
      expect(afterRow.path.start.y).toBeCloseTo(beforeRow.path.start.y + 15);
    }
  });

  it('shrinks the row guide when returning from progressive to fixed distribution', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 10,
      totalSeats: 20,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      distributionMode: 'PROGRESSIVE',
      firstRowSeatCount: 3,
      lastRowSeatCount: 10,
    });
    useEventMapEditorStore.getState().updateSeatBlock(block!.id, { distributionMode: 'FIXED' });

    const state = useEventMapEditorStore.getState();
    const seats = state.map?.seats ?? [];
    const row = state.map?.document?.sections[0]?.blocks[0]?.rows[0];
    expect(row?.path.type).toBe('LINE');
    if (row?.path.type === 'LINE') {
      expect(row.path.end.x).toBeCloseTo(Math.max(...seats.map((seat) => seat.x)) + (seats[0]?.size ?? 0) / 2);
    }
    expect(state.map?.document?.sections[0]?.outline).toEqual([]);
  });

  it('transforms multiple parametric seat blocks together while preserving their geometry', () => {
    const config = { ...DEFAULT_SEAT_BLOCK_CONFIG, rows: 2, columns: 3, totalSeats: 6 };
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, config);
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 500, y: 100 }, config);

    let state = useEventMapEditorStore.getState();
    const blocks = state.map?.document?.sections.flatMap((section) => section.blocks) ?? [];
    expect(blocks).toHaveLength(2);
    const items = blocks.map((block) => ({ type: 'seatblock' as const, id: block.id }));
    const seatIds = blocks.map((block) => block.rows.flatMap((row) => row.seatIds));
    const initialSeatSize = blocks[0]!.rows[0]!.seatSize;
    const initialSeats = seatIds.map((ids) => ids.map((id) => state.map!.seats.find((seat) => seat.id === id)!));

    const move = [1, 0, 0, 1, 30, 20] as [number, number, number, number, number, number];
    state.transformParametricSelections(items.map((item) => ({ item, matrix: move })));
    state = useEventMapEditorStore.getState();
    for (let blockIndex = 0; blockIndex < seatIds.length; blockIndex += 1) {
      for (let seatIndex = 0; seatIndex < seatIds[blockIndex]!.length; seatIndex += 1) {
        const moved = state.map!.seats.find((seat) => seat.id === seatIds[blockIndex]![seatIndex])!;
        expect(moved.x).toBeCloseTo(initialSeats[blockIndex]![seatIndex]!.x + 30);
        expect(moved.y).toBeCloseTo(initialSeats[blockIndex]![seatIndex]!.y + 20);
      }
    }

    const rotate = [0, 1, -1, 0, 550, -350] as [number, number, number, number, number, number];
    state.transformParametricSelections(items.map((item) => ({ item, matrix: rotate })));
    state = useEventMapEditorStore.getState();
    const rotatedBlocks = state.map!.document!.sections.flatMap((section) => section.blocks);
    expect(rotatedBlocks.every((block) => block.rows.every((row) => row.path.type === 'LINE'))).toBe(true);
    const afterRotationSeats = seatIds.map((ids) => ids.map((id) => state.map!.seats.find((seat) => seat.id === id)!));
    for (let blockIndex = 0; blockIndex < seatIds.length; blockIndex += 1) {
      for (let seatIndex = 0; seatIndex < seatIds[blockIndex]!.length; seatIndex += 1) {
        const moved = initialSeats[blockIndex]![seatIndex]!;
        const rotated = afterRotationSeats[blockIndex]![seatIndex]!;
        expect(rotated.x).toBeCloseTo(550 - (moved.y + 20));
        expect(rotated.y).toBeCloseTo(moved.x + 30 - 350);
      }
    }

    const scale = [1.5, 0, 0, 1.5, -225, -50] as [number, number, number, number, number, number];
    state.transformParametricSelections(items.map((item) => ({ item, matrix: scale })));
    state = useEventMapEditorStore.getState();
    const scaledBlocks = state.map!.document!.sections.flatMap((section) => section.blocks);
    expect(scaledBlocks.every((block) => block.rows.every((row) => Math.abs(row.seatSize - initialSeatSize * 1.5) < 0.001))).toBe(true);
    for (let blockIndex = 0; blockIndex < seatIds.length; blockIndex += 1) {
      for (let seatIndex = 0; seatIndex < seatIds[blockIndex]!.length; seatIndex += 1) {
        const current = state.map!.seats.find((seat) => seat.id === seatIds[blockIndex]![seatIndex])!;
        const previous = afterRotationSeats[blockIndex]![seatIndex]!;
        expect(current.x).toBeCloseTo(previous.x * 1.5 - 225);
        expect(current.y).toBeCloseTo(previous.y * 1.5 - 50);
      }
    }
  });

  it('preserves the visible progressive capacity when switching to equal rows', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 4,
      columns: 10,
      totalSeats: 40,
    });
    const block = useEventMapEditorStore.getState().map?.document?.sections[0]?.blocks[0];
    expect(block).toBeTruthy();

    useEventMapEditorStore.getState().updateSeatBlock(block!.id, {
      distributionMode: 'PROGRESSIVE',
      firstRowSeatCount: 3,
      lastRowSeatCount: 6,
    });
    useEventMapEditorStore.getState().updateSeatBlock(block!.id, { distributionMode: 'FIXED' });

    const state = useEventMapEditorStore.getState();
    const updated = state.map?.document?.sections[0]?.blocks[0];
    expect(updated?.distribution).toEqual([{ type: 'SEATS', count: 6 }]);
    expect(state.map?.seats).toHaveLength(24);
  });

  it('removes the empty section when its last seat block is deleted', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const state = useEventMapEditorStore.getState();
    const blockId = state.map?.document?.sections[0]?.blocks[0]?.id;
    expect(blockId).toBeTruthy();
    state.setSelection({ type: 'seatblock', id: blockId! });

    state.deleteSeatBlock(blockId!);

    const after = useEventMapEditorStore.getState();
    expect(after.map?.document?.sections).toHaveLength(0);
    expect(after.map?.seats).toHaveLength(0);
    expect(after.selection).toEqual([]);
  });

  it('keeps reference-chart metadata outside the map draft history', () => {
    const referenceChart: MapReferenceChart = {
      url: '/uploads/reference.png',
      storageKey: 'uploads/event-maps/conta-1/map-1/reference.png',
      fileName: 'reference.png',
      mimeType: 'image/png',
      width: 1200,
      height: 800,
      visible: true,
      opacity: 0.5,
      locked: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
      calibration: { seatDiameter: 24, seatPitch: 8, rowPitch: 18 },
    };

    useEventMapEditorStore.getState().setReferenceChart(referenceChart);

    const state = useEventMapEditorStore.getState();
    expect(state.map?.referenceChart).toEqual(referenceChart);
    expect(state.isDirty).toBe(false);
    expect(state.past).toHaveLength(0);
  });
});
