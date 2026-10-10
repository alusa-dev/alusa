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

  it('keeps an empty base-area name editable until a replacement is entered', () => {
    const store = useEventMapEditorStore.getState();

    store.updateLevel('level-1', { name: '' });
    expect(useEventMapEditorStore.getState().map?.levels[0]?.name).toBe('');

    useEventMapEditorStore.getState().updateLevel('level-1', { name: 'Sessão ' });
    expect(useEventMapEditorStore.getState().map?.levels[0]?.name).toBe('Sessão ');
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

  it('persists editable seat metadata in the canonical document and undo history', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    const initialMap = useEventMapEditorStore.getState().map!;
    const target = initialMap.seats[0]!;
    const owner = initialMap.document!.sections[0]!.blocks[0]!.rows[0]!;
    const previous = owner.seats.find((seat) => seat.id === target.id)!;

    useEventMapEditorStore.getState().updateSeat(target.id, {
      technicalCode: 'VIP-09',
      displayLabel: 'Poltrona VIP',
      rowLabel: 'Mezanino',
      seatNumber: '07',
      accessible: true,
      publicVisible: false,
    });

    let state = useEventMapEditorStore.getState();
    let canonicalSeat = state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === target.id)!;
    expect(canonicalSeat).toMatchObject({
      technicalCode: 'VIP-09',
      label: 'Poltrona VIP',
      rowLabel: 'Mezanino',
      seatNumber: '07',
      accessible: true,
      publicVisible: false,
    });
    expect(state.map!.seats.find((seat) => seat.id === target.id)).toMatchObject({
      technicalCode: 'VIP-09',
      displayLabel: 'Poltrona VIP',
      rowLabel: 'Mezanino',
      seatNumber: '07',
      accessible: true,
      publicVisible: false,
    });
    expect(state.toPayload()!.document?.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === target.id)).toMatchObject({
      technicalCode: 'VIP-09',
      label: 'Poltrona VIP',
      rowLabel: 'Mezanino',
      seatNumber: '07',
      accessible: true,
      publicVisible: false,
    });

    state.undo();
    state = useEventMapEditorStore.getState();
    canonicalSeat = state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === target.id)!;
    expect(canonicalSeat).toEqual(previous);

    state.redo();
    state = useEventMapEditorStore.getState();
    canonicalSeat = state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === target.id)!;
    expect(canonicalSeat).toMatchObject({ technicalCode: 'VIP-09', label: 'Poltrona VIP', rowLabel: 'Mezanino', seatNumber: '07' });
  });

  it('does not record a no-op update and reports stale item references', () => {
    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 80, y: 90 });
    useEventMapEditorStore.getState().markSaved(useEventMapEditorStore.getState().map!);
    const savedState = useEventMapEditorStore.getState();
    const savedMap = savedState.map!;
    const savedHistoryLength = savedState.past.length;
    const savedX = savedMap.objects.find((object) => object.id === objectId)!.x;

    savedState.updateObject(objectId!, { x: savedX });
    let state = useEventMapEditorStore.getState();
    expect(state.map).toBe(savedMap);
    expect(state.isDirty).toBe(false);
    expect(state.past).toHaveLength(savedHistoryLength);
    expect(state.commandFeedback).toBeNull();

    state.updateObject('deleted-object', { x: 140 });
    state = useEventMapEditorStore.getState();
    expect(state.map).toBe(savedMap);
    expect(state.isDirty).toBe(false);
    expect(state.past).toHaveLength(savedHistoryLength);
    expect(state.commandFeedback?.messages).toContain('Alguns itens não foram encontrados e não foram atualizados.');
  });

  it('uses the canonical document when loaded compatibility projections disagree', () => {
    const map = createMap();
    const canonicalObject = {
      id: 'object-1',
      levelId: 'level-1',
      sectionId: null,
      type: 'GENERAL_AREA' as const,
      data: { shape: 'square' },
      x: 40,
      y: 50,
      width: 120,
      height: 120,
      rotation: 0,
      locked: false,
      hidden: false,
      sortOrder: 0,
    };
    map.document = { ...map.document!, visualElements: [canonicalObject] };
    map.objects = [{ ...canonicalObject, x: 900 }];

    useEventMapEditorStore.getState().loadMap(map);
    let state = useEventMapEditorStore.getState();
    expect(state.map?.objects[0]?.x).toBe(40);
    expect(state.map?.document?.visualElements[0]?.x).toBe(40);

    state.updateObject('object-1', { x: 75 });
    state = useEventMapEditorStore.getState();
    expect(state.map?.objects[0]?.x).toBe(75);
    expect(state.map?.document?.visualElements[0]?.x).toBe(75);
    expect(state.toPayload()?.document?.visualElements[0]?.x).toBe(75);
  });

  it('keeps undo history when the inverse operation is blocked by operational seats', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 1,
      totalSeats: 1,
    });
    const map = useEventMapEditorStore.getState().map!;
    const sectionId = map.sections[0]!.id;
    useEventMapEditorStore.getState().updateSeat(map.seats[0]!.id, { status: 'SOLD' });
    useEventMapEditorStore.getState().markSaved(useEventMapEditorStore.getState().map!);
    const savedMap = useEventMapEditorStore.getState().map!;
    const historyEntry = {
      execute: { type: 'ADD_LEVEL' as const, payload: { levelId: 'history-level' } },
      undo: { type: 'DELETE_SELECTION' as const, payload: { selection: [{ type: 'section' as const, id: sectionId }] } },
      executeSelection: [],
      undoSelection: [],
    };
    useEventMapEditorStore.setState({ past: [historyEntry], future: [] });

    useEventMapEditorStore.getState().undo();
    const state = useEventMapEditorStore.getState();
    expect(state.map).toBe(savedMap);
    expect(state.past).toEqual([historyEntry]);
    expect(state.commandFeedback?.messages).toContain('A seleção contém assento vendido ou reservado.');
  });

  it('deletes a level and restores its complete map document through undo and redo', () => {
    const store = useEventMapEditorStore.getState();
    store.addLevel('Sessão 02');
    const levelId = useEventMapEditorStore.getState().activeLevelId!;
    useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 240, y: 180 });
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 420, y: 260 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    const before = useEventMapEditorStore.getState().map!;
    const deletedObjectIds = before.objects.filter((object) => object.levelId === levelId).map((object) => object.id);
    const deletedSectionIds = before.sections.filter((section) => section.levelId === levelId).map((section) => section.id);
    expect(deletedObjectIds.length).toBeGreaterThan(0);
    expect(deletedSectionIds.length).toBeGreaterThan(0);
    useEventMapEditorStore.getState().markSaved(before);

    useEventMapEditorStore.getState().deleteLevel(levelId);
    let map = useEventMapEditorStore.getState().map!;
    expect(map.levels.some((level) => level.id === levelId)).toBe(false);
    expect(map.document?.sections.some((section) => section.levelId === levelId)).toBe(false);
    expect(map.objects.some((object) => object.levelId === levelId)).toBe(false);
    expect(map.seats.some((seat) => seat.levelId === levelId)).toBe(false);

    useEventMapEditorStore.getState().undo();
    map = useEventMapEditorStore.getState().map!;
    expect(map.levels.some((level) => level.id === levelId)).toBe(true);
    expect(map.document?.sections.filter((section) => section.levelId === levelId).map((section) => section.id)).toEqual(deletedSectionIds);
    expect(map.objects.filter((object) => object.levelId === levelId).map((object) => object.id)).toEqual(deletedObjectIds);
    expect(map.seats.filter((seat) => seat.levelId === levelId)).toHaveLength(6);

    useEventMapEditorStore.getState().redo();
    map = useEventMapEditorStore.getState().map!;
    expect(map.levels.some((level) => level.id === levelId)).toBe(false);
    expect(map.document?.sections.some((section) => section.levelId === levelId)).toBe(false);
    expect(map.objects.some((object) => object.levelId === levelId)).toBe(false);
    expect(map.seats.some((seat) => seat.levelId === levelId)).toBe(false);
  });

  it('blocks deleting a level with operational seats and surfaces a warning without changing the map', () => {
    useEventMapEditorStore.getState().addLevel('Sessão 02');
    const levelId = useEventMapEditorStore.getState().activeLevelId!;
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    const seatId = useEventMapEditorStore.getState().map!.seats[0]!.id;
    useEventMapEditorStore.getState().updateSeat(seatId, { status: 'SOLD' });
    useEventMapEditorStore.getState().markSaved(useEventMapEditorStore.getState().map!);
    const before = useEventMapEditorStore.getState().map;

    useEventMapEditorStore.getState().deleteLevel(levelId);
    const state = useEventMapEditorStore.getState();
    expect(state.map).toBe(before);
    expect(state.isDirty).toBe(false);
    expect(state.commandFeedback?.messages).toContain('Este ambiente contém ingressos vendidos, reservados ou cortesia e não pode ser removido.');
  });

  it('keeps newly edited object geometry synchronized when changing a section lot', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 140, y: 180 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    let map = useEventMapEditorStore.getState().map!;
    const section = map.document!.sections[0]!;
    map = {
      ...map,
      document: {
        ...map.document!,
        sections: map.document!.sections.map((entry) => entry.id === section.id
          ? { ...entry, position: { x: 215, y: 175 }, rotation: 31 }
          : entry),
      },
    };
    useEventMapEditorStore.getState().loadMap(map);

    const objectId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 35, y: 42 });
    expect(objectId).toBeTruthy();
    useEventMapEditorStore.getState().updateObject(objectId!, {
      x: 67,
      y: 91,
      width: 146,
      height: 112,
      rotation: 27,
    });

    const before = useEventMapEditorStore.getState().map!;
    const beforeSection = structuredClone(before.document!.sections[0]!);
    const beforeObjects = structuredClone(before.objects);
    const beforeVisuals = structuredClone(before.document!.visualElements);
    const beforeSeats = before.seats.map(({ id, x, y, rotation, size }) => ({ id, x, y, rotation, size }));
    expect(before.document!.visualElements).toEqual(before.objects);

    useEventMapEditorStore.getState().updateSection(section.id, { lotId: 'lot-5' });

    let updated = useEventMapEditorStore.getState();
    expect(updated.map!.sections[0]!.lotId).toBe('lot-5');
    expect(updated.map!.document!.sections[0]).toEqual({ ...beforeSection, lotId: 'lot-5' });
    expect(updated.map!.objects).toEqual(beforeObjects);
    expect(updated.map!.document!.visualElements).toEqual(beforeVisuals);
    expect(updated.map!.seats.map(({ id, x, y, rotation, size }) => ({ id, x, y, rotation, size }))).toEqual(beforeSeats);

    useEventMapEditorStore.getState().toggleSectionVisibility(section.id);
    updated = useEventMapEditorStore.getState();
    expect(updated.map!.sections[0]!.lotId).toBe('lot-5');
    expect(updated.map!.document!.sections[0]!.hidden).toBe(true);
    expect(updated.map!.objects).toEqual(beforeObjects);
    expect(updated.map!.seats.map(({ id, x, y, rotation, size }) => ({ id, x, y, rotation, size }))).toEqual(beforeSeats);

    updated.undo();
    updated = useEventMapEditorStore.getState();
    expect(updated.map!.sections[0]!.lotId).toBe('lot-5');
    expect(updated.map!.document!.sections[0]!.hidden).toBeFalsy();
    expect(updated.map!.objects).toEqual(beforeObjects);

    updated.undo();
    updated = useEventMapEditorStore.getState();
    expect(updated.map!.sections[0]!.lotId).toBeNull();
    expect(updated.map!.document!.sections[0]).toEqual(beforeSection);
    expect(updated.map!.objects).toEqual(beforeObjects);
    expect(updated.map!.document!.visualElements).toEqual(beforeVisuals);
    expect(updated.map!.seats.map(({ id, x, y, rotation, size }) => ({ id, x, y, rotation, size }))).toEqual(beforeSeats);

    updated.redo();
    updated = useEventMapEditorStore.getState();
    expect(updated.map!.sections[0]!.lotId).toBe('lot-5');
    expect(updated.map!.objects).toEqual(beforeObjects);
    updated.redo();
    updated = useEventMapEditorStore.getState();
    expect(updated.map!.document!.sections[0]!.hidden).toBe(true);
    expect(updated.map!.document!.visualElements).toEqual(beforeVisuals);
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

  it('restores a duplicated sector document, seats, and linked visual elements through store undo/redo', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 3,
      totalSeats: 3,
    });
    let map = useEventMapEditorStore.getState().map!;
    const source = map.document!.sections[0]!;
    const linkedObject = {
      id: 'visual-linked-1', levelId: source.levelId, sectionId: source.id, type: 'TEXT' as const, data: { text: 'Identificação' },
      x: 120, y: 80, width: 100, height: 24, rotation: 0, locked: false, hidden: false, sortOrder: 10,
    };
    map = {
      ...map,
      objects: [...map.objects, linkedObject],
      document: { ...map.document!, visualElements: [...map.document!.visualElements, linkedObject] },
    };
    useEventMapEditorStore.getState().loadMap(map);
    const originalDocument = structuredClone(useEventMapEditorStore.getState().map!.document!);
    useEventMapEditorStore.getState().setSelection({ type: 'section', id: source.id });
    useEventMapEditorStore.getState().duplicateSelection();

    let current = useEventMapEditorStore.getState().map!;
    expect(current.document?.sections).toHaveLength(2);
    expect(current.seats).toHaveLength(6);
    expect(current.document?.visualElements).toHaveLength(2);

    useEventMapEditorStore.getState().undo();
    current = useEventMapEditorStore.getState().map!;
    expect(current.document?.sections).toHaveLength(1);
    expect(current.seats).toHaveLength(3);
    expect(current.document).toEqual(originalDocument);

    useEventMapEditorStore.getState().redo();
    current = useEventMapEditorStore.getState().map!;
    expect(current.document?.sections).toHaveLength(2);
    expect(current.seats).toHaveLength(6);
    expect(current.document?.visualElements).toHaveLength(2);
    expect(current.document?.visualElements.every((element) => element.sectionId && current.document?.sections.some((section) => section.id === element.sectionId))).toBe(true);
  });

  it('restores an independent object in the canonical document through store undo/redo', () => {
    let map = useEventMapEditorStore.getState().map!;
    const objectId = 'independent-object-1';
    const object = {
      id: objectId, levelId: 'level-1', sectionId: null, type: 'GENERAL_AREA' as const, data: { shape: 'square' },
      x: 100, y: 120, width: 80, height: 60, rotation: 0, locked: false, hidden: false, sortOrder: 0,
    };
    map = { ...map, objects: [object], document: { ...map.document!, visualElements: [object] } };
    useEventMapEditorStore.getState().loadMap(map);
    const originalDocument = structuredClone(useEventMapEditorStore.getState().map!.document!);
    useEventMapEditorStore.getState().setSelection({ type: 'object', id: objectId });
    useEventMapEditorStore.getState().duplicateSelection();

    map = useEventMapEditorStore.getState().map!;
    expect(map.document?.visualElements).toHaveLength(originalDocument.visualElements.length + 1);
    expect(map.objects).toHaveLength(2);

    useEventMapEditorStore.getState().undo();
    map = useEventMapEditorStore.getState().map!;
    expect(map.document).toEqual(originalDocument);
    expect(map.objects).toHaveLength(1);

    useEventMapEditorStore.getState().redo();
    map = useEventMapEditorStore.getState().map!;
    expect(map.document?.visualElements).toHaveLength(originalDocument.visualElements.length + 1);
    expect(map.objects).toHaveLength(2);
    expect(map.document?.visualElements.map((element) => element.id)).toContain(map.objects.find((entry) => entry.id !== objectId)!.id);
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

  it('persists an individual seat size override and supports removing it', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    let state = useEventMapEditorStore.getState();
    const row = state.map!.document!.sections[0]!.blocks[0]!.rows[0]!;
    const seatId = row.seatIds[0]!;
    const defaultSize = row.seatSize;
    state = useEventMapEditorStore.getState();
    state.updateMapItems({ seats: [{ id: seatId, patch: { size: 42 } }] });

    state = useEventMapEditorStore.getState();
    expect(state.map!.seats.find((seat) => seat.id === seatId)?.size).toBe(42);
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === seatId)?.size).toBe(42);

    expect(state.past.at(-1)?.undo).toMatchObject({
      type: 'UPDATE_ITEMS',
      payload: { seats: [{ id: seatId, patch: { size: null } }] },
    });
    state.undo();
    state = useEventMapEditorStore.getState();
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === seatId)?.size).toBeUndefined();
    expect(state.map!.seats.find((seat) => seat.id === seatId)?.size).toBe(defaultSize);

    state.redo();
    state = useEventMapEditorStore.getState();
    state.updateMapItems({ seats: [{ id: seatId, patch: { size: null } }] });
    expect(useEventMapEditorStore.getState().map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === seatId)?.size).toBeUndefined();
  });

  it('commits mixed shape, parametric block, and individual seat resizing as one undoable change', () => {
    const config = { ...DEFAULT_SEAT_BLOCK_CONFIG, rows: 1, columns: 2, totalSeats: 2 };
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, config);
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 500, y: 100 }, config);
    const shapeId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 300, y: 300 }, { width: 100, height: 100 });
    expect(shapeId).toBeTruthy();

    useEventMapEditorStore.setState({ past: [], future: [] });
    let state = useEventMapEditorStore.getState();
    const mapBefore = state.map!;
    const blocks = mapBefore.document!.sections.map((section) => section.blocks[0]!);
    const firstBlock = blocks[0]!;
    const individualSeatId = blocks[1]!.rows[0]!.seatIds[0]!;
    const originalShape = mapBefore.objects.find((object) => object.id === shapeId)!;
    const originalRowSize = firstBlock.rows[0]!.seatSize;
    const originalIndividualSeatSize = mapBefore.seats.find((seat) => seat.id === individualSeatId)!.size;
    const scale = [1.5, 0, 0, 1.5, 0, 0] as [number, number, number, number, number, number];

    state.transformParametricSelections(
      [{ item: { type: 'seatblock', id: firstBlock.id }, matrix: scale }],
      {
        objects: [{ id: shapeId!, patch: { x: originalShape.x + 15, y: originalShape.y + 20, width: originalShape.width! * 2, height: originalShape.height! * 2 } }],
        seats: [{ id: individualSeatId, patch: { size: 42 } }],
      },
    );

    state = useEventMapEditorStore.getState();
    expect(state.past).toHaveLength(1);
    expect(state.map!.objects.find((object) => object.id === shapeId)).toMatchObject({
      x: originalShape.x + 15,
      y: originalShape.y + 20,
      width: originalShape.width! * 2,
      height: originalShape.height! * 2,
    });
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seatSize).toBeCloseTo(originalRowSize * 1.5);
    expect(state.map!.document!.sections[1]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === individualSeatId)?.size).toBe(42);
    expect(state.map!.seats.find((seat) => seat.id === individualSeatId)?.size).toBe(42);

    state.undo();
    state = useEventMapEditorStore.getState();
    expect(state.map!.objects.find((object) => object.id === shapeId)).toMatchObject({
      x: originalShape.x,
      y: originalShape.y,
      width: originalShape.width,
      height: originalShape.height,
    });
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seatSize).toBe(originalRowSize);
    expect(state.map!.document!.sections[1]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === individualSeatId)?.size).toBeUndefined();
    expect(state.map!.seats.find((seat) => seat.id === individualSeatId)?.size).toBe(originalIndividualSeatSize);

    state.redo();
    state = useEventMapEditorStore.getState();
    expect(state.map!.objects.find((object) => object.id === shapeId)?.width).toBe(originalShape.width! * 2);
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seatSize).toBeCloseTo(originalRowSize * 1.5);
    expect(state.map!.seats.find((seat) => seat.id === individualSeatId)?.size).toBe(42);
  });

  it('resizes only the selected row and keeps sibling row geometry unchanged', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 120, y: 140 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 3,
      totalSeats: 6,
    });
    let state = useEventMapEditorStore.getState();
    const block = state.map!.document!.sections[0]!.blocks[0]!;
    const [selectedRow, siblingRow] = block.rows;
    expect(selectedRow).toBeTruthy();
    expect(siblingRow).toBeTruthy();
    useEventMapEditorStore.setState({ past: [], future: [] });

    const scale = [1.75, 0, 0, 1.75, 0, 0] as [number, number, number, number, number, number];
    state.transformParametricSelection({ type: 'seatrow', id: selectedRow!.id }, scale);

    state = useEventMapEditorStore.getState();
    const rowsAfterResize = state.map!.document!.sections[0]!.blocks[0]!.rows;
    expect(rowsAfterResize[0]!.seatSize).toBeCloseTo(selectedRow!.seatSize * 1.75);
    expect(rowsAfterResize[0]!.seatGap).toBeCloseTo(selectedRow!.seatGap * 1.75);
    expect(rowsAfterResize[0]!.path).not.toEqual(selectedRow!.path);
    expect(rowsAfterResize[1]).toEqual(siblingRow);
    expect(state.past).toHaveLength(1);

    state.undo();
    state = useEventMapEditorStore.getState();
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows).toEqual(block.rows);
    state.redo();
    expect(useEventMapEditorStore.getState().map!.document!.sections[0]!.blocks[0]!.rows[1]).toEqual(siblingRow);
  });

  it('scales existing individual seat overrides with their parametric block', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    let state = useEventMapEditorStore.getState();
    const block = state.map!.document!.sections[0]!.blocks[0]!;
    const seatId = block.rows[0]!.seatIds[0]!;
    state.updateMapItems({ seats: [{ id: seatId, patch: { size: 36 } }] });
    state = useEventMapEditorStore.getState();
    useEventMapEditorStore.setState({ past: [], future: [] });

    const initialRowSize = block.rows[0]!.seatSize;
    const scale = [2, 0, 0, 2, 0, 0] as [number, number, number, number, number, number];
    state.transformParametricSelection({ type: 'seatblock', id: block.id }, scale);

    state = useEventMapEditorStore.getState();
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seatSize).toBeCloseTo(initialRowSize * 2);
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === seatId)?.size).toBe(72);
    expect(state.map!.seats.find((seat) => seat.id === seatId)?.size).toBe(72);

    state.undo();
    state = useEventMapEditorStore.getState();
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seatSize).toBe(initialRowSize);
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats.find((seat) => seat.id === seatId)?.size).toBe(36);
    state.redo();
    expect(useEventMapEditorStore.getState().map!.seats.find((seat) => seat.id === seatId)?.size).toBe(72);
  });

  it('clears individual seat geometry overrides when the row layout changes and restores them on undo', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    let state = useEventMapEditorStore.getState();
    const row = state.map!.document!.sections[0]!.blocks[0]!.rows[0]!;
    const seatId = row.seatIds[0]!;
    const initialSeat = state.map!.seats.find((seat) => seat.id === seatId)!;
    state.updateMapItems({
      seats: [{ id: seatId, patch: { x: initialSeat.x + 17, y: initialSeat.y + 9, rotation: 25, size: 38 } }],
    });
    state = useEventMapEditorStore.getState();
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats[0]).toMatchObject({
      position: { x: expect.any(Number), y: expect.any(Number) },
      rotation: 25,
      size: 38,
    });
    useEventMapEditorStore.setState({ past: [], future: [] });

    state.updateSeatRow(row.id, { seatSize: 32, seatGap: 12 });

    state = useEventMapEditorStore.getState();
    const updatedRow = state.map!.document!.sections[0]!.blocks[0]!.rows[0]!;
    expect(updatedRow.seatSize).toBe(32);
    expect(updatedRow.seatGap).toBe(12);
    expect(updatedRow.seats[0]).not.toHaveProperty('position');
    expect(updatedRow.seats[0]).not.toHaveProperty('rotation');
    expect(updatedRow.seats[0]).not.toHaveProperty('size');

    state.undo();
    const restoredSeat = useEventMapEditorStore.getState().map!.document!.sections[0]!.blocks[0]!.rows[0]!.seats[0]!;
    expect(restoredSeat).toMatchObject({ rotation: 25, size: 38 });
    expect(restoredSeat.position).toBeDefined();
  });

  it('ignores singular parametric transforms without changing map geometry or history', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    const state = useEventMapEditorStore.getState();
    const block = state.map!.document!.sections[0]!.blocks[0]!;
    const mapBefore = state.map;
    useEventMapEditorStore.setState({ past: [], future: [] });

    state.transformParametricSelection(
      { type: 'seatblock', id: block.id },
      [1, 2, 2, 4, 200, 300],
    );

    expect(useEventMapEditorStore.getState().map).toBe(mapBefore);
    expect(useEventMapEditorStore.getState().past).toHaveLength(0);
  });

  it('does not shrink parametric seats below the minimum size', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 2,
      totalSeats: 2,
    });
    const state = useEventMapEditorStore.getState();
    const block = state.map!.document!.sections[0]!.blocks[0]!;
    const initialSeatGap = block.rows[0]!.seatGap;

    state.transformParametricSelection(
      { type: 'seatblock', id: block.id },
      [0.1, 0, 0, 0.1, 0, 0],
    );

    const transformedRow = useEventMapEditorStore.getState().map!.document!.sections[0]!.blocks[0]!.rows[0]!;
    expect(transformedRow.seatSize).toBe(8);
    expect(transformedRow.seatGap).toBeCloseTo(initialSeatGap * 0.1);
  });

  it('ignores seats outside the selected row when transforming a mixed selection', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 2,
      columns: 2,
      totalSeats: 4,
    });
    const shapeId = useEventMapEditorStore.getState().addObjectAt('shape-square', { x: 300, y: 300 });
    let state = useEventMapEditorStore.getState();
    const block = state.map!.document!.sections[0]!.blocks[0]!;
    const [selectedRow, siblingRow] = block.rows;
    const untouchedSeatId = siblingRow!.seatIds[0]!;
    const initialSeat = state.map!.seats.find((seat) => seat.id === untouchedSeatId)!;
    const shape = state.map!.objects.find((object) => object.id === shapeId)!;
    useEventMapEditorStore.setState({ past: [], future: [] });

    const scale = [1.5, 0, 0, 1.5, 0, 0] as [number, number, number, number, number, number];
    state.transformParametricSelections(
      [{ item: { type: 'seatrow', id: selectedRow!.id }, matrix: scale }],
      { objects: [{ id: shapeId!, patch: { width: shape.width! * 1.5, height: shape.height! * 1.5 } }] },
    );

    state = useEventMapEditorStore.getState();
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[0]!.seatSize).toBeCloseTo(selectedRow!.seatSize * 1.5);
    expect(state.map!.document!.sections[0]!.blocks[0]!.rows[1]).toEqual(siblingRow);
    expect(state.map!.seats.find((seat) => seat.id === untouchedSeatId)).toMatchObject({ x: initialSeat.x, y: initialSeat.y, size: initialSeat.size });
    expect(state.map!.objects.find((object) => object.id === shapeId)?.width).toBe(shape.width! * 1.5);
    expect(state.past).toHaveLength(1);
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

  it('blocks direct section and seat-block deletion when seats are operational', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 1,
      totalSeats: 1,
    });
    const initial = useEventMapEditorStore.getState().map!;
    const sectionId = initial.document!.sections[0]!.id;
    const blockId = initial.document!.sections[0]!.blocks[0]!.id;
    useEventMapEditorStore.getState().updateSeat(initial.seats[0]!.id, { status: 'SOLD' });
    useEventMapEditorStore.getState().markSaved(useEventMapEditorStore.getState().map!);
    const savedMap = useEventMapEditorStore.getState().map;

    useEventMapEditorStore.getState().deleteSeatBlock(blockId);
    let state = useEventMapEditorStore.getState();
    expect(state.map).toBe(savedMap);
    expect(state.isDirty).toBe(false);
    expect(state.commandFeedback?.messages).toContain('A seleção contém assento vendido ou reservado.');

    state.deleteSection(sectionId);
    state = useEventMapEditorStore.getState();
    expect(state.map).toBe(savedMap);
    expect(state.isDirty).toBe(false);
    expect(state.commandFeedback?.messages).toContain('A seleção contém assento vendido ou reservado.');
  });

  it('removes linked visual elements when deleting the final block through the store', () => {
    useEventMapEditorStore.getState().addSeatBlockAt({ x: 100, y: 100 }, {
      ...DEFAULT_SEAT_BLOCK_CONFIG,
      rows: 1,
      columns: 1,
      totalSeats: 1,
    });
    let map = useEventMapEditorStore.getState().map!;
    const section = map.document!.sections[0]!;
    const blockId = section.blocks[0]!.id;
    const linkedElement = {
      id: 'section-label',
      levelId: section.levelId,
      sectionId: section.id,
      type: 'TEXT',
      data: { text: 'Setor' },
      x: 100,
      y: 80,
      width: 80,
      height: 20,
      rotation: 0,
      locked: false,
      hidden: false,
      sortOrder: 1,
    };
    map = { ...map, document: { ...map.document!, visualElements: [linkedElement] } };
    useEventMapEditorStore.getState().loadMap(map);

    useEventMapEditorStore.getState().deleteSeatBlock(blockId);
    const after = useEventMapEditorStore.getState().map!;
    expect(after.document?.sections).toHaveLength(0);
    expect(after.document?.visualElements).toHaveLength(0);
    expect(after.objects).toHaveLength(0);
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
