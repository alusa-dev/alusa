import { describe, expect, it } from 'vitest';

import type { EventMapDTO } from '../api/event-map-service';
import { DEFAULT_SEAT_GRID_CONFIG } from '../lib/seat-grid';
import { getSeatBounds, intersectsRect } from '../lib/selection-utils';
import { resolveSmartCorridorLayout } from '../lib/smart-corridor-layout';
import { useEventMapEditorStore } from '../store/event-map-editor-store';

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
        capacity: null,
        status: 'ACTIVE',
        notes: null,
      },
    ],
    objects: [
      {
        id: 'object-1',
        levelId: 'level-1',
        sectionId: null,
        type: 'GENERAL_AREA',
        data: { label: 'Objeto 1' },
        x: 100,
        y: 100,
        width: 100,
        height: 80,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 0,
      },
      {
        id: 'object-2',
        levelId: 'level-1',
        sectionId: null,
        type: 'GENERAL_AREA',
        data: { label: 'Objeto 2' },
        x: 240,
        y: 100,
        width: 100,
        height: 80,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: 1,
      },
    ],
    seats: [
      {
        id: 'seat-1',
        levelId: 'level-1',
        sectionId: 'section-1',
        objectId: null,
        groupId: null,
        rowIndex: null,
        columnIndex: null,
        technicalCode: 'A1',
        displayLabel: 'A1',
        rowLabel: 'A',
        seatNumber: '1',
        status: 'AVAILABLE',
        accessible: false,
        publicVisible: true,
        x: 400,
        y: 100,
        size: 24,
        rotation: 0,
      },
    ],
    seatGroups: [],
    versions: [],
    counts: { levels: 1, sections: 1, seats: 1, availableSeats: 1 },
  };
}

describe('event-map-editor-store history', () => {
  it('undoes and redoes mixed group movement as one history entry', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().updateMapItems({
      objects: [
        { id: 'object-1', patch: { x: 120, y: 130 } },
        { id: 'object-2', patch: { x: 260, y: 130 } },
      ],
      seats: [{ id: 'seat-1', patch: { x: 420, y: 130 } }],
    });

    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().map?.objects.map((object) => object.x)).toEqual([120, 260]);
    expect(store.getState().map?.seats[0]?.x).toBe(420);

    store.getState().undo();
    expect(store.getState().map?.objects.map((object) => object.x)).toEqual([100, 240]);
    expect(store.getState().map?.seats[0]?.x).toBe(400);

    store.getState().redo();
    expect(store.getState().map?.objects.map((object) => object.x)).toEqual([120, 260]);
    expect(store.getState().map?.seats[0]?.x).toBe(420);
  });

  it('creates new map areas with area-oriented labels', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addLevel();

    const created = store.getState().map?.levels.find((level) => level.sortOrder === 1);
    expect(created?.name).toBe('Ambiente 2');
    expect(created?.widthPx).toBe(1440);
    expect(created?.heightPx).toBe(900);
    expect(store.getState().selection).toEqual([{ type: 'level', id: created?.id }]);
  });

  it('creates a seat grid as one undoable history entry', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 120, y: 160 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 6,
        rows: 2,
        columns: 3,
        horizontalSpacing: 40,
        verticalSpacing: 50,
      },
    );

    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().map?.sections).toHaveLength(2);
    expect(store.getState().map?.objects).toHaveLength(3);
    expect(store.getState().map?.seats).toHaveLength(7);
    const createdSection = store.getState().map?.sections.at(-1);
    const createdSectionObject = store.getState().map?.objects.find((object) => object.sectionId === createdSection?.id);
    expect(store.getState().selection).toEqual([{ type: 'section', id: createdSection?.id }]);
    expect(createdSection?.capacity).toBe(6);
    expect(createdSectionObject).toMatchObject({
      x: 84,
      y: 124,
      width: 152,
      height: 122,
    });
    expect(store.getState().map?.seats.slice(1).map((seat) => seat.displayLabel)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);

    store.getState().nudgeSelection({ x: 10, y: 12 });
    expect(store.getState().map?.objects.find((object) => object.sectionId === createdSection?.id)?.x).toBe(94);
    expect(store.getState().map?.seats.at(1)).toMatchObject({ x: 130, y: 172 });

    store.getState().undo();
    expect(store.getState().map?.objects.find((object) => object.sectionId === createdSection?.id)?.x).toBe(84);
    expect(store.getState().map?.seats.at(1)).toMatchObject({ x: 120, y: 160 });

    store.getState().undo();
    expect(store.getState().map?.sections).toHaveLength(1);
    expect(store.getState().map?.seats).toHaveLength(1);

    store.getState().redo();
    expect(store.getState().map?.sections).toHaveLength(2);
    expect(store.getState().map?.seats).toHaveLength(7);

    store.getState().redo();
    expect(store.getState().map?.sections).toHaveLength(2);
    expect(store.getState().map?.seats).toHaveLength(7);
    expect(store.getState().map?.objects.find((object) => object.sectionId === createdSection?.id)?.x).toBe(94);
  });

  it('undoes and redoes a seat section movement as a single history entry', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 120, y: 160 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 6,
        rows: 2,
        columns: 3,
        horizontalSpacing: 40,
        verticalSpacing: 50,
      },
    );

    store.setState({ past: [], future: [] });

    const createdSection = store.getState().map?.sections.at(-1);
    const createdSectionObject = store.getState().map?.objects.find((object) => object.sectionId === createdSection?.id);
    const createdSeats = store.getState().map?.seats.filter((seat) => seat.sectionId === createdSection?.id) ?? [];
    expect(createdSectionObject).toBeTruthy();
    expect(createdSeats).toHaveLength(6);
    if (!createdSectionObject) return;

    store.getState().updateMapItems({
      objects: [{ id: createdSectionObject.id, patch: { x: createdSectionObject.x + 80, y: createdSectionObject.y + 40 } }],
      seats: createdSeats.map((seat) => ({ id: seat.id, patch: { x: seat.x + 80, y: seat.y + 40 } })),
    });

    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().map?.objects.find((object) => object.id === createdSectionObject.id)).toMatchObject({
      x: createdSectionObject.x + 80,
      y: createdSectionObject.y + 40,
    });
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === createdSection?.id).map((seat) => seat.x)).toEqual(
      createdSeats.map((seat) => seat.x + 80),
    );

    store.getState().undo();
    expect(store.getState().map?.objects.find((object) => object.id === createdSectionObject.id)).toMatchObject({
      x: createdSectionObject.x,
      y: createdSectionObject.y,
    });
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === createdSection?.id).map((seat) => seat.x)).toEqual(
      createdSeats.map((seat) => seat.x),
    );

    store.getState().redo();
    expect(store.getState().map?.objects.find((object) => object.id === createdSectionObject.id)).toMatchObject({
      x: createdSectionObject.x + 80,
      y: createdSectionObject.y + 40,
    });
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === createdSection?.id).map((seat) => seat.x)).toEqual(
      createdSeats.map((seat) => seat.x + 80),
    );
  });

  it('does not duplicate sections from the duplicate command', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap({
      ...createMap(),
      objects: [
        ...createMap().objects,
        {
          id: 'section-object-1',
          levelId: 'level-1',
          sectionId: 'section-1',
          type: 'SECTION',
          data: { label: 'Setor 1', fill: '#6d28d9' },
          x: 80,
          y: 80,
          width: 220,
          height: 140,
          rotation: 0,
          locked: false,
          hidden: false,
          sortOrder: 2,
        },
      ],
    });

    store.getState().setSelection({ type: 'section', id: 'section-1' });
    store.getState().duplicateSelection();

    expect(store.getState().map?.sections).toHaveLength(1);
    expect(store.getState().map?.objects.filter((object) => object.type === 'SECTION')).toHaveLength(1);
    expect(store.getState().past).toHaveLength(0);

    store.getState().setSelection({ type: 'object', id: 'section-object-1' });
    store.getState().duplicateSelection();

    expect(store.getState().map?.sections).toHaveLength(1);
    expect(store.getState().map?.objects.filter((object) => object.type === 'SECTION')).toHaveLength(1);
    expect(store.getState().past).toHaveLength(0);
  });

  it('opens a responsive gap for corridors and restores seats when the corridor is removed', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const baseSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    const baseSectionWidth =
      store.getState().map?.objects.find((object) => object.type === 'SECTION' && object.sectionId)?.width ?? 0;

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    const shiftedSeats = store.getState().map?.seats.slice(1) ?? [];
    const shiftedSectionObject = store.getState().map?.objects.find((object) => object.type === 'SECTION' && object.sectionId);

    expect(corridorId).toBeTruthy();
    expect(shiftedSeats.some((seat, index) => seat.x !== baseSeats[index]?.x || seat.y !== baseSeats[index]?.y)).toBe(true);
    expect(shiftedSeats[1]!.x - shiftedSeats[0]!.x).toBeGreaterThanOrEqual(40);
    expect(shiftedSeats[2]!.x - shiftedSeats[1]!.x).toBeGreaterThanOrEqual(40);
    expect(shiftedSeats[3]!.x - shiftedSeats[2]!.x).toBeGreaterThanOrEqual(40);
    expect(shiftedSectionObject?.width).toBeGreaterThan(baseSectionWidth);

    if (corridorId) {
      store.getState().setSelection({ type: 'object', id: corridorId });
      store.getState().deleteSelection();
    }

    const restoredSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    expect(restoredSeats).toEqual(baseSeats);
    const restoredSectionObject = store.getState().map?.objects.find((object) => object.type === 'SECTION' && object.sectionId);
    expect(restoredSectionObject?.data.sectionBaseBounds).toBeUndefined();
  });

  it('recalculates corridor gaps from the original seat positions when a corridor moves', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const baseSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    const firstGapSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    store.getState().updateObject(corridorId, { x: 320, y: 70 });
    const movedAwaySeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    expect(movedAwaySeats).toEqual(baseSeats);

    store.getState().updateObject(corridorId, { x: 135 });
    const secondGapSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    expect(secondGapSeats).toEqual(firstGapSeats);
  });

  it('treats overlapping corridors as one obstacle without doubling seat displacement', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const firstCorridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(firstCorridorId).toBeTruthy();
    const firstGapSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];

    const secondCorridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(secondCorridorId).toBeTruthy();
    const mergedGapSeats = store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];

    expect(mergedGapSeats).toEqual(firstGapSeats);
  });

  it('uses per-side corridor spacing controls when recalculating seats', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    const readGap = () => {
      const seats = (store.getState().map?.seats ?? [])
        .filter((seat) => seat.rowLabel === 'A' && seat.x < 300)
        .sort((left, right) => left.x - right.x);
      const col1 = seats[0];
      const col2 = seats[1];
      if (!col1 || !col2) return 0;
      return col2.x - (col1.x + (col1.size ?? 20));
    };

    const defaultGap = readGap();
    store.getState().updateObject(corridorId, { data: { seatGapLeft: 40 } });
    const widerGap = readGap();

    expect(defaultGap).toBeGreaterThan(0);
    expect(widerGap).toBeGreaterThan(defaultGap);
  });

  it('moves a reflowed seat section as one stable undoable state', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();

    const section = store.getState().map?.sections.at(-1);
    const sectionObject = store.getState().map?.objects.find((object) => object.sectionId === section?.id);
    const shiftedSeats = store.getState().map?.seats.filter((seat) => seat.sectionId === section?.id) ?? [];
    expect(sectionObject).toBeTruthy();
    expect(shiftedSeats).toHaveLength(8);
    if (!section || !sectionObject) return;

    store.setState({ past: [], future: [] });
    store.getState().setSelection({ type: 'section', id: section.id });
    store.getState().nudgeSelection({ x: 80, y: 40 });

    const movedSectionObject = store.getState().map?.objects.find((object) => object.id === sectionObject.id);
    const movedSeats = store.getState().map?.seats.filter((seat) => seat.sectionId === section.id) ?? [];
    expect(store.getState().past).toHaveLength(1);
    expect(movedSectionObject?.x).not.toBe(sectionObject.x);
    expect(movedSectionObject?.y).not.toBe(sectionObject.y);
    expect(movedSeats.map((seat) => ({ x: seat.x, y: seat.y }))).not.toEqual(
      shiftedSeats.map((seat) => ({ x: seat.x, y: seat.y })),
    );

    store.getState().undo();
    expect(store.getState().map?.objects.find((object) => object.id === sectionObject.id)).toMatchObject({
      x: sectionObject.x,
      y: sectionObject.y,
    });
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === section.id).map((seat) => ({ x: seat.x, y: seat.y }))).toEqual(
      shiftedSeats.map((seat) => ({ x: seat.x, y: seat.y })),
    );

    store.getState().redo();
    expect(store.getState().map?.objects.find((object) => object.id === sectionObject.id)).toEqual(movedSectionObject);
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === section.id).map((seat) => ({ x: seat.x, y: seat.y }))).toEqual(
      movedSeats.map((seat) => ({ x: seat.x, y: seat.y })),
    );
  });

  it('keeps resized reflowed seat sections as one atomic history state', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();

    const section = store.getState().map?.sections.at(-1);
    const sectionObject = store.getState().map?.objects.find((object) => object.sectionId === section?.id);
    const shiftedSeats = store.getState().map?.seats.filter((seat) => seat.sectionId === section?.id) ?? [];
    expect(sectionObject).toBeTruthy();
    expect(shiftedSeats).toHaveLength(8);
    if (!section || !sectionObject) return;

    const seatPatches = shiftedSeats.map((seat) => ({
      id: seat.id,
      patch: {
        x: seat.x + 300 + (seat.x - sectionObject.x) * 0.15,
        y: seat.y + (seat.y - sectionObject.y) * 0.1,
        size: (seat.size ?? 20) * 1.2,
      },
    }));

    store.setState({ past: [], future: [] });
    store.getState().updateMapItems({
      objects: [
        {
          id: sectionObject.id,
          patch: {
            x: sectionObject.x + 300,
            y: sectionObject.y,
            width: (sectionObject.width ?? 0) * 1.15,
            height: (sectionObject.height ?? 0) * 1.1,
          },
        },
      ],
      seats: seatPatches,
    });

    expect(store.getState().past).toHaveLength(1);
    const resizedSeats = store.getState().map?.seats.filter((seat) => seat.sectionId === section.id).map((seat) => ({ x: seat.x, y: seat.y, size: seat.size })) ?? [];
    expect(resizedSeats).not.toEqual(shiftedSeats.map((seat) => ({ x: seat.x, y: seat.y, size: seat.size })));

    store.getState().undo();
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === section.id).map((seat) => ({ x: seat.x, y: seat.y, size: seat.size }))).toEqual(
      shiftedSeats.map((seat) => ({ x: seat.x, y: seat.y, size: seat.size })),
    );

    store.getState().redo();
    expect(store.getState().map?.seats.filter((seat) => seat.sectionId === section.id).map((seat) => ({ x: seat.x, y: seat.y, size: seat.size }))).toEqual(
      resizedSeats,
    );
  });

  it('creates corridor defaults as smart corridor with spacing metadata', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    const corridorId = store.getState().addObjectAt('corridor', { x: 200, y: 100 });
    expect(corridorId).toBeTruthy();

    const corridor = store.getState().map?.objects.find((object) => object.id === corridorId);
    expect(corridor).toMatchObject({
      width: 32,
      height: 280,
      rotation: 0,
      data: expect.objectContaining({
        smartCorridor: true,
        seatGapTop: 8,
        seatGapRight: 8,
        seatGapBottom: 8,
        seatGapLeft: 8,
        corridorThickness: 32,
      }),
    });
  });

  it('reflows a new seat grid immediately when a corridor already exists in the area', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const createdSection = store.getState().map?.sections.at(-1);
    const gridSeats =
      store.getState().map?.seats.filter((seat) => seat.sectionId === createdSection?.id) ?? [];
    const col1 = gridSeats.find((seat) => seat.seatNumber === '1' && seat.rowLabel === 'A');
    const col2 = gridSeats.find((seat) => seat.seatNumber === '2' && seat.rowLabel === 'A');
    expect(col1).toBeTruthy();
    expect(col2).toBeTruthy();
    if (!col1 || !col2) return;

    const col1Bounds = getSeatBounds(col1);
    const col2Bounds = getSeatBounds(col2);
    const gap = col2Bounds.x - (col1Bounds.x + col1Bounds.width);

    expect(gap).toBeGreaterThan(20);
  });

  it('recalculates corridor reflow when corridor geometry changes orientation', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    const verticalLayout =
      store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];
    store.getState().updateObject(corridorId, { width: 280, height: 32 });
    const horizontalLayout =
      store.getState().map?.seats.slice(1).map((seat) => ({ id: seat.id, x: seat.x, y: seat.y })) ?? [];

    expect(horizontalLayout).not.toEqual(verticalLayout);
    store.getState().updateObject(corridorId, { width: 30, height: 120 });
    const finalLayout = store.getState().map?.seats.slice(1).map((seat) => ({ x: seat.x, y: seat.y })) ?? [];
    expect(finalLayout).toEqual([
      { x: 100, y: 100 },
      { x: 183, y: 100 },
      { x: 223, y: 100 },
      { x: 263, y: 100 },
      { x: 100, y: 140 },
      { x: 183, y: 140 },
      { x: 223, y: 140 },
      { x: 263, y: 140 },
    ]);
  });

  it('reflows seats when duplicating a rotated corridor', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 155, y: 40 }, { width: 120, height: 28 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    store.getState().updateObject(corridorId, { rotation: 90 });
    store.getState().setSelection({ type: 'object', id: corridorId });
    store.getState().duplicateSelection();

    const duplicated = store.getState().map?.objects.find((object) => object.type === 'CORRIDOR' && object.id !== corridorId);
    expect(duplicated).toBeTruthy();
    if (!duplicated) return;

    expect(duplicated).toMatchObject({ rotation: 90 });
    expect(Number.isFinite(duplicated.x)).toBe(true);
    expect(Number.isFinite(duplicated.y)).toBe(true);
    expect(duplicated.width).toBe(120);
    expect(duplicated.height).toBe(28);
    expect(store.getState().past).toHaveLength(4);
  });

  it('normalizes legacy initial area names while keeping the artboard size fixed', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap({
      ...createMap(),
      levels: [{ id: 'level-1', name: 'Plateia', sortOrder: 0, widthPx: 1600, heightPx: 1000, unit: 'px', scale: '1m = 50px' }],
    });

    expect(store.getState().map?.levels[0]?.name).toBe('Ambiente 1');
    expect(store.getState().map?.levels[0]?.widthPx).toBe(1440);
    expect(store.getState().map?.levels[0]?.heightPx).toBe(900);

    store.getState().updateLevel('level-1', { name: 'Mezanino', widthPx: 3000, heightPx: 2000 });

    expect(store.getState().map?.levels[0]?.name).toBe('Mezanino');
    expect(store.getState().map?.levels[0]?.widthPx).toBe(1440);
    expect(store.getState().map?.levels[0]?.heightPx).toBe(900);
  });

  it('normalizes and reapplies corridor reflow on loadMap and toPayload', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    const sectionObject = store.getState().map?.objects.find(
      (object) => object.type === 'SECTION' && object.sectionId,
    );
    expect(sectionObject?.data.seatBaseLayout ?? sectionObject?.data.sectionBaseBounds).toBeTruthy();

    const payload = store.getState().toPayload();
    expect(payload).toBeTruthy();
    if (!payload) return;

    const corridorPayload = payload.objects.find((object) => object.id === corridorId);
    expect(Number(corridorPayload?.data?.corridorThickness ?? 0)).toBeGreaterThanOrEqual(8);

    const reloadedMap: EventMapDTO = {
      ...createMap(),
      name: payload.name ?? createMap().name,
      levels: payload.levels,
      sections: payload.sections.map((section) => ({
        ...section,
        lotId: null,
        lot: null,
        capacity: null,
        notes: null,
      })),
      objects: payload.objects,
      seats: store.getState().map?.seats ?? [],
    };

    store.getState().loadMap(reloadedMap);

    for (const corridorObject of store.getState().map?.objects.filter((object) => object.type === 'CORRIDOR') ?? []) {
      const layout = resolveSmartCorridorLayout(corridorObject);
      expect(Number(corridorObject.data.corridorThickness)).toBeGreaterThanOrEqual(8);

      for (const seat of store.getState().map?.seats ?? []) {
        const seatBounds = getSeatBounds(seat);
        expect(intersectsRect(seatBounds, layout.coreRect)).toBe(false);
        expect(intersectsRect(seatBounds, layout.clearanceRect)).toBe(false);
      }
    }

    const reloadedSection = store.getState().map?.objects.find(
      (object) => object.type === 'SECTION' && object.sectionId,
    );
    expect(reloadedSection?.data.seatBaseLayout ?? reloadedSection?.data.sectionBaseBounds).toBeTruthy();
  });

  it('skips seat base layout translation when reflow commits seat positions', () => {
    const store = useEventMapEditorStore;
    store.getState().loadMap(createMap());

    store.getState().addSeatGridAt(
      { x: 100, y: 100 },
      {
        ...DEFAULT_SEAT_GRID_CONFIG,
        totalSeats: 8,
        rows: 2,
        columns: 4,
        seatSize: 20,
        horizontalSpacing: 40,
        verticalSpacing: 40,
      },
    );

    const corridorId = store.getState().addObjectAt('corridor', { x: 135, y: 70 }, { width: 30, height: 120 });
    expect(corridorId).toBeTruthy();
    if (!corridorId) return;

    const sectionObject = store.getState().map?.objects.find(
      (object) => object.type === 'SECTION' && object.sectionId,
    );
    const baseLayoutBefore = JSON.stringify(sectionObject?.data.seatBaseLayout ?? {});

    const reflowedSeat = store.getState().map?.seats.find((seat) => seat.seatNumber === '2' && seat.rowLabel === 'A');
    expect(reflowedSeat).toBeTruthy();
    if (!reflowedSeat) return;

    store.getState().updateMapItems({
      objects: [{ id: corridorId, patch: { x: 145, y: 70 } }],
      seats: [{ id: reflowedSeat.id, patch: { x: reflowedSeat.x + 10, y: reflowedSeat.y } }],
      skipSeatBaseLayoutTranslation: true,
    });

    const baseLayoutAfter = JSON.stringify(
      store.getState().map?.objects.find((object) => object.type === 'SECTION' && object.sectionId)?.data
        .seatBaseLayout ?? {},
    );
    expect(baseLayoutAfter).toBe(baseLayoutBefore);
  });
});
