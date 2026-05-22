'use client';

import { create } from 'zustand';

import type {
  EventMapDTO,
  EventMapDraftPayload,
  EventMapLevelDTO,
  EventMapObjectDTO,
  EventMapSectionDTO,
  EventSeatDTO,
} from '../api/event-map-service';
import {
  getNextLevelSortOrder,
  isPlateiaBaseLevel,
  MAP_AREA_HEIGHT_PX,
  MAP_AREA_WIDTH_PX,
  normalizeMapLevels,
} from '../lib/level-utils';
import { withAutoObjectLabel, withDuplicateObjectLabel } from '../lib/object-naming';
import {
  buildSeatGridPreview,
  getSeatGridPreviewBounds,
  SEAT_GRID_SECTION_PADDING,
  type SeatGridConfig,
} from '../lib/seat-grid';
import { getTextModeFromCreation, normalizeTextData } from '../lib/text-object';
import { sanitizeTextObjectData } from '../lib/text-object.schema';
import {
  expandObjectSelectionItems,
  getNextGroupDisplayName,
  getObjectGroupId,
  getObjectGroupLabel,
  sanitizeGroupMembership,
  setObjectGroupData,
  validateGroupCandidates,
} from '../lib/object-groups';

import { applyCorridorReflow, inferCorridorAxisFromSize, persistCorridorMetadataOnly, translateSeatCorridorBase, translateSectionCorridorBase, updateCorridorSplitAnchorsOnDrag } from '../lib/corridor-reflow';
import { computeArtboardFitView } from '../lib/viewport-utils';
import {
  getSelectableItems,
  normalizeSelection,
  replaceSelection,
  toggleSelectionItem,
  type MapSelection,
  type MapSelectionItem,
} from '../lib/selection-utils';

export type MapTool =
  | 'select'
  | 'pan'
  | 'zoom'
  | 'section'
  | 'row'
  | 'seat'
  | 'table'
  | 'stage'
  | 'text'
  | 'blocked'
  | 'corridor'
  | 'booth'
  | 'general'
  | 'shape-square'
  | 'shape-circle'
  | 'shape-ellipse'
  | 'shape-triangle';

export type { MapSelection, MapSelectionItem };

type EventMapEditorState = {
  map: EventMapDTO | null;
  activeLevelId: string | null;
  tool: MapTool;
  selection: MapSelection;
  zoom: number;
  pan: { x: number; y: number };
  viewportSize: { width: number; height: number };
  isDirty: boolean;
  past: EventMapDTO[];
  future: EventMapDTO[];
  zoomToolPinned: boolean;
  temporaryZoomPreviousTool: MapTool | null;
  zoomScrubbedThisHold: boolean;
  inlineTextEditorActive: boolean;
  loadMap: (map: EventMapDTO, options?: { dirty?: boolean }) => void;
  setTool: (tool: MapTool) => void;
  beginTemporaryZoom: () => void;
  restoreTemporaryZoomTool: () => void;
  commitPermanentZoomTool: () => void;
  markZoomScrubbedThisHold: () => void;
  setSelection: (selection: MapSelectionItem | MapSelection | null) => void;
  toggleSelectionItem: (item: MapSelectionItem) => void;
  setActiveLevelId: (levelId: string) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setViewportSize: (size: { width: number; height: number }) => void;
  fitArtboardToView: () => void;
  addObjectAt: (
    tool: MapTool,
    point: { x: number; y: number },
    size?: { width?: number; height?: number },
  ) => string | null;
  deleteObject: (id: string) => void;
  addRowAt: (point: { x: number; y: number }, quantity?: number) => void;
  addSeatGridAt: (point: { x: number; y: number }, config: Partial<SeatGridConfig>) => void;
  updateObject: (id: string, patch: Partial<EventMapObjectDTO>) => void;
  updateObjects: (updates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>) => void;
  updateMapItems: (updates: {
    objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
    seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
  }) => void;
  updateSeat: (id: string, patch: Partial<EventSeatDTO>) => void;
  updateSection: (id: string, patch: Partial<EventMapSectionDTO>) => void;
  updateLevel: (id: string, patch: Partial<EventMapLevelDTO>) => void;
  addLevel: (name?: string) => void;
  toggleObjectVisibility: (id: string) => void;
  toggleSectionVisibility: (id: string) => void;
  deleteSection: (id: string) => void;
  deleteLevel: (id: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  nudgeSelection: (delta: { x: number; y: number }) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (map?: EventMapDTO) => void;
  toPayload: () => EventMapDraftPayload | null;
  setInlineTextEditorActive: (active: boolean) => void;
};

const DEFAULT_COLORS = ['#6d28d9', '#0f766e', '#2563eb', '#db2777', '#ea580c', '#16a34a'];

function cloneMap(map: EventMapDTO): EventMapDTO {
  return JSON.parse(JSON.stringify(map)) as EventMapDTO;
}

function createLocalId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function applyMapLevels(map: EventMapDTO) {
  map.levels = normalizeMapLevels(map.levels);
}

function cloneAndNormalizeMap(map: EventMapDTO): EventMapDTO {
  const next = cloneMap(map);
  applyMapLevels(next);
  next.objects = next.objects.map((object) =>
    object.type === 'TEXT'
      ? { ...object, data: sanitizeTextObjectData(normalizeTextData(object.data)) }
      : object,
  );
  return next;
}

function withHistory(state: EventMapEditorState) {
  return state.map ? [...state.past.slice(-24), cloneMap(state.map)] : state.past;
}

function getDefaultActiveLevelId(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const otherLevels = normalized.filter((level) => !isPlateiaBaseLevel(level));
  if (otherLevels.length > 0) return otherLevels.at(-1)?.id ?? null;
  return normalized.find((level) => isPlateiaBaseLevel(level))?.id ?? null;
}

function getActiveLevel(map: EventMapDTO | null, activeLevelId: string | null) {
  if (!map) return null;
  return map.levels.find((level) => level.id === activeLevelId) ?? map.levels[0] ?? null;
}

function createDefaultSection(map: EventMapDTO, levelId: string, point: { x: number; y: number }, size?: { width: number; height: number }) {
  const color = DEFAULT_COLORS[map.sections.length % DEFAULT_COLORS.length];
  const sectionId = createLocalId('section');
  const objectId = createLocalId('object');
  const sectionName = `Setor ${map.sections.length + 1}`;
  const section: EventMapSectionDTO = {
    id: sectionId,
    levelId,
    lotId: null,
    lot: null,
    name: sectionName,
    color,
    capacity: null,
    status: 'ACTIVE',
    notes: null,
  };
  const object: EventMapObjectDTO = {
    id: objectId,
    levelId,
    sectionId,
    type: 'SECTION',
    data: { label: sectionName, fill: color },
    x: point.x,
    y: point.y,
    width: size?.width ?? 320,
    height: size?.height ?? 180,
    rotation: 0,
    locked: false,
    hidden: false,
    sortOrder: map.objects.length,
  };

  map.sections.push(section);
  map.objects.push(object);
  return section;
}

function ensureSection(map: EventMapDTO, levelId: string, point: { x: number; y: number }) {
  return map.sections.find((section) => section.levelId === levelId) ?? createDefaultSection(map, levelId, point);
}

function updateCounts(map: EventMapDTO) {
  map.counts = {
    levels: map.levels.length,
    sections: map.sections.length,
    seats: map.seats.length,
    availableSeats: map.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
  };
}

export const useEventMapEditorStore = create<EventMapEditorState>((set, get) => ({
  map: null,
  activeLevelId: null,
  tool: 'select',
  selection: [] as MapSelection,
  zoom: 0.7,
  pan: { x: 80, y: 80 },
  viewportSize: { width: 1200, height: 800 },
  isDirty: false,
  past: [],
  future: [],
  zoomToolPinned: false,
  temporaryZoomPreviousTool: null,
  zoomScrubbedThisHold: false,
  inlineTextEditorActive: false,
  loadMap: (map, options) => {
    const normalized = cloneAndNormalizeMap(map);
    const activeLevelId = getDefaultActiveLevelId(normalized.levels);
    const state = get();

    const level = normalized.levels.find((l) => l.id === activeLevelId) ?? normalized.levels[0];
    let newZoom = state.zoom;
    let newPan = state.pan;

    if (level && state.viewportSize.width > 0 && state.viewportSize.height > 0) {
      const levelObjects = normalized.objects.filter((o) => o.levelId === level.id);
      if (levelObjects.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const obj of levelObjects) {
          minX = Math.min(minX, obj.x);
          minY = Math.min(minY, obj.y);
          maxX = Math.max(maxX, obj.x + (obj.width ?? 0));
          maxY = Math.max(maxY, obj.y + (obj.height ?? 0));
        }
        const contentW = maxX - minX;
        const contentH = maxY - minY;
        if (contentW > 0 && contentH > 0) {
          const padding = 48;
          const availW = Math.max(state.viewportSize.width - padding * 2, 1);
          const availH = Math.max(state.viewportSize.height - padding * 2, 1);
          const rawZoom = Math.min(availW / contentW, availH / contentH);
          const zoom = Math.min(Math.max(rawZoom, 0.25), 2.5);
          newZoom = zoom;
          newPan = {
            x: (state.viewportSize.width - contentW * zoom) / 2 - minX * zoom,
            y: (state.viewportSize.height - contentH * zoom) / 2 - minY * zoom,
          };
        } else {
          const fit = computeArtboardFitView({ artboardWidth: level.widthPx, artboardHeight: level.heightPx, viewportWidth: state.viewportSize.width, viewportHeight: state.viewportSize.height });
          newZoom = fit.zoom;
          newPan = fit.pan;
        }
      } else {
        const fit = computeArtboardFitView({ artboardWidth: level.widthPx, artboardHeight: level.heightPx, viewportWidth: state.viewportSize.width, viewportHeight: state.viewportSize.height });
        newZoom = fit.zoom;
        newPan = fit.pan;
      }
    }

    return set({
      map: normalized,
      activeLevelId,
      selection: activeLevelId ? [{ type: 'level', id: activeLevelId }] : [],
      tool: 'select',
      zoom: newZoom,
      pan: newPan,
      zoomToolPinned: false,
      temporaryZoomPreviousTool: null,
      zoomScrubbedThisHold: false,
      inlineTextEditorActive: false,
      isDirty: options?.dirty ?? false,
      past: [],
      future: [],
    });
  },
  setTool: (tool) =>
    set({
      tool,
      zoomToolPinned: tool === 'zoom',
      temporaryZoomPreviousTool: null,
      zoomScrubbedThisHold: false,
    }),
  beginTemporaryZoom: () => {
    const state = get();
    if (state.zoomToolPinned && state.tool === 'zoom') return;
    if (state.temporaryZoomPreviousTool) return;
    set({
      tool: 'zoom',
      temporaryZoomPreviousTool: state.tool,
      zoomScrubbedThisHold: false,
    });
  },
  restoreTemporaryZoomTool: () => {
    const previous = get().temporaryZoomPreviousTool;
    if (!previous) return;
    set({
      tool: previous,
      temporaryZoomPreviousTool: null,
      zoomToolPinned: false,
      zoomScrubbedThisHold: false,
    });
  },
  commitPermanentZoomTool: () =>
    set({
      tool: 'zoom',
      zoomToolPinned: true,
      temporaryZoomPreviousTool: null,
      zoomScrubbedThisHold: false,
    }),
  markZoomScrubbedThisHold: () => {
    if (!get().zoomScrubbedThisHold) {
      set({ zoomScrubbedThisHold: true });
    }
  },
  setSelection: (selection) => set({ selection: normalizeSelection(selection) }),
  toggleSelectionItem: (item) =>
    set((state) => ({
      selection: toggleSelectionItem(state.selection, item),
    })),
  setActiveLevelId: (levelId) => set({ activeLevelId: levelId }),
  setZoom: (zoom) => set({ zoom: Math.min(Math.max(zoom, 0.25), 2.5) }),
  setPan: (pan) => set({ pan }),
  setViewportSize: (viewportSize) => set({ viewportSize }),
  fitArtboardToView: () =>
    set((state) => {
      const level =
        state.map?.levels.find((entry) => entry.id === state.activeLevelId) ??
        state.map?.levels.find((entry) => entry.sortOrder === 0) ??
        state.map?.levels[0];

      if (!level) return state;

      const fit = computeArtboardFitView({
        artboardWidth: level.widthPx,
        artboardHeight: level.heightPx,
        viewportWidth: state.viewportSize.width,
        viewportHeight: state.viewportSize.height,
      });

      return { zoom: fit.zoom, pan: fit.pan };
    }),
  addObjectAt: (tool, point, size) => {
    let createdId: string | null = null;

    set((state) => {
      const map = state.map ? cloneMap(state.map) : null;
      const level = getActiveLevel(map, state.activeLevelId);
      if (!map || !level) return state;
      const past = withHistory(state);

      if (tool === 'section') {
        const section = createDefaultSection(
          map,
          level.id,
          point,
          size?.width && size?.height ? { width: size.width, height: size.height } : undefined,
        );
        createdId = section.id;
        updateCounts(map);
        return { map, selection: replaceSelection({ type: 'section', id: section.id }), tool: 'select', isDirty: true, past, future: [] };
      }

      if (tool === 'seat') {
        const section = ensureSection(map, level.id, point);
        const seatNumber = String(map.seats.filter((seat) => seat.sectionId === section.id).length + 1);
        const seat: EventSeatDTO = {
          id: createLocalId('seat'),
          levelId: level.id,
          sectionId: section.id,
          objectId: null,
          technicalCode: `${section.name.replace(/\s+/g, '-').toUpperCase()}-${seatNumber}`,
          displayLabel: seatNumber,
          rowLabel: null,
          seatNumber,
          status: 'AVAILABLE',
          accessible: false,
          publicVisible: true,
          x: point.x,
          y: point.y,
          size: 24,
          rotation: 0,
        };
        map.seats.push(seat);
        createdId = seat.id;
        updateCounts(map);
        return { map, selection: replaceSelection({ type: 'seat', id: seat.id }), tool: 'select', isDirty: true, past, future: [] };
      }

      const configByTool: Partial<
        Record<MapTool, { type: EventMapObjectDTO['type']; width: number; height: number; data: Record<string, unknown> }>
      > = {
        table: { type: 'TABLE' as const, width: 120, height: 90, data: { fill: '#f8fafc' } },
        stage: { type: 'STAGE' as const, width: 360, height: 110, data: { fill: '#111827' } },
        text: { type: 'TEXT' as const, width: 0, height: 0, data: { text: '' } },
        blocked: { type: 'BLOCKED_AREA' as const, width: 220, height: 100, data: { fill: '#e2e8f0' } },
        corridor: {
          type: 'CORRIDOR' as const,
          width: 32,
          height: 280,
          data: { fill: '#f1f5f9', corridorAxis: 'vertical', corridorAutoFit: true },
        },
        booth: { type: 'BOOTH' as const, width: 180, height: 120, data: { fill: '#fff7ed' } },
        general: { type: 'GENERAL_AREA' as const, width: 280, height: 160, data: { fill: '#ecfeff' } },
        'shape-square': { type: 'GENERAL_AREA' as const, width: 130, height: 130, data: { fill: '#ffffff', shape: 'square' } },
        'shape-circle': { type: 'GENERAL_AREA' as const, width: 130, height: 130, data: { fill: '#ffffff', shape: 'circle' } },
        'shape-ellipse': { type: 'GENERAL_AREA' as const, width: 180, height: 110, data: { fill: '#ffffff', shape: 'ellipse' } },
        'shape-triangle': { type: 'GENERAL_AREA' as const, width: 150, height: 130, data: { fill: '#ffffff', shape: 'triangle' } },
      };
      const config = configByTool[tool];

      if (!config) return state;

      const textMode = config.type === 'TEXT' ? getTextModeFromCreation(size?.width ?? null, size?.height ?? null) : undefined;
      const objectWidth = config.type === 'TEXT' && !size?.width ? null : size?.width ?? config.width;
      const objectHeight = config.type === 'TEXT' && !size?.height ? null : size?.height ?? config.height;
      const objectData: Record<string, unknown> =
        config.type === 'TEXT'
          ? normalizeTextData({
              ...withAutoObjectLabel(config.data, tool, map.objects),
              textMode,
            })
          : withAutoObjectLabel(config.data, tool, map.objects);

      if (config.type === 'CORRIDOR') {
        const width = typeof objectWidth === 'number' ? objectWidth : config.width;
        const height = typeof objectHeight === 'number' ? objectHeight : config.height;
        objectData.corridorAxis = inferCorridorAxisFromSize(width, height);
        objectData.corridorAutoFit = true;
      }

      const object: EventMapObjectDTO = {
        id: createLocalId('object'),
        levelId: level.id,
        sectionId: null,
        type: config.type,
        data: objectData,
        x: point.x,
        y: point.y,
        width: objectWidth,
        height: objectHeight,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: map.objects.length,
      };
      map.objects.push(object);
      createdId = object.id;
      if (object.type === 'CORRIDOR') applyCorridorReflow(map);
      updateCounts(map);
      return { map, selection: replaceSelection({ type: 'object', id: object.id }), tool: 'select', isDirty: true, past, future: [] };
    });

    return createdId;
  },
  addRowAt: (point, quantity = 12) =>
    set((state) => {
      const map = state.map ? cloneMap(state.map) : null;
      const level = getActiveLevel(map, state.activeLevelId);
      if (!map || !level) return state;
      const past = withHistory(state);
      const section = ensureSection(map, level.id, point);
      const rowIndex = new Set(map.seats.map((seat) => seat.rowLabel).filter(Boolean)).size;
      const rowLabel = String.fromCharCode(65 + Math.min(rowIndex, 25));
      const spacing = 34;
      const startX = point.x;
      const startY = point.y;

      for (let index = 0; index < quantity; index += 1) {
        const number = String(index + 1);
        map.seats.push({
          id: createLocalId('seat'),
          levelId: level.id,
          sectionId: section.id,
          objectId: null,
          technicalCode: `${rowLabel}${number}`,
          displayLabel: `${rowLabel}${number}`,
          rowLabel,
          seatNumber: number,
          status: 'AVAILABLE',
          accessible: false,
          publicVisible: true,
          x: startX + index * spacing,
          y: startY,
          size: 24,
          rotation: 0,
        });
      }

      updateCounts(map);
      return { map, selection: replaceSelection({ type: 'section', id: section.id }), tool: 'select', isDirty: true, past, future: [] };
    }),
  addSeatGridAt: (point, config) =>
    set((state) => {
      const map = state.map ? cloneMap(state.map) : null;
      const level = getActiveLevel(map, state.activeLevelId);
      if (!map || !level) return state;

      const seats = buildSeatGridPreview(point, config);
      if (seats.length === 0) return state;
      const sectionBounds = getSeatGridPreviewBounds(seats, SEAT_GRID_SECTION_PADDING);
      if (!sectionBounds) return state;

      const past = withHistory(state);
      const color = DEFAULT_COLORS[map.sections.length % DEFAULT_COLORS.length];
      const sectionId = createLocalId('section');
      const objectId = createLocalId('object');
      const sectionName = `Setor ${map.sections.length + 1}`;
      const sectionCode = sectionName.replace(/\s+/g, '-').toUpperCase();

      map.sections.push({
        id: sectionId,
        levelId: level.id,
        lotId: null,
        lot: null,
        name: sectionName,
        color,
        capacity: seats.length,
        status: 'ACTIVE',
        notes: null,
      });

      map.objects.push({
        id: objectId,
        levelId: level.id,
        sectionId,
        type: 'SECTION',
        data: { label: sectionName, fill: color, opacity: 0.1, cornerRadius: 10 },
        x: sectionBounds.x,
        y: sectionBounds.y,
        width: sectionBounds.width,
        height: sectionBounds.height,
        rotation: 0,
        locked: false,
        hidden: false,
        sortOrder: map.objects.length,
      });

      for (const draft of seats) {
        const id = createLocalId('seat');
        map.seats.push({
          id,
          levelId: level.id,
          sectionId,
          objectId: null,
          technicalCode: `${sectionCode}-${draft.technicalCode}`,
          displayLabel: draft.displayLabel,
          rowLabel: draft.rowLabel,
          seatNumber: draft.seatNumber,
          status: 'AVAILABLE',
          accessible: false,
          publicVisible: true,
          x: draft.x,
          y: draft.y,
          size: draft.size,
          rotation: 0,
        });
      }

      updateCounts(map);
      return { map, selection: replaceSelection({ type: 'section', id: sectionId }), tool: 'select', isDirty: true, past, future: [] };
    }),
  updateObject: (id, patch) =>
    set((state) => {
      if (!state.map) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      const target = map.objects.find((object) => object.id === id);
      const sectionDelta =
        target?.type === 'SECTION' && target.sectionId
          ? {
              sectionId: target.sectionId,
              delta: {
                x: typeof patch.x === 'number' ? patch.x - target.x : 0,
                y: typeof patch.y === 'number' ? patch.y - target.y : 0,
              },
            }
          : null;
      map.objects = map.objects.map((object) => {
        if (object.id !== id) return object;
        if (patch.data) {
          return { ...object, ...patch, data: { ...object.data, ...patch.data } };
        }
        return { ...object, ...patch };
      });
      const updatedObject = map.objects.find((object) => object.id === id);
      if (
        updatedObject?.type === 'CORRIDOR' &&
        (typeof patch.x === 'number' ||
          typeof patch.y === 'number' ||
          typeof patch.width === 'number' ||
          typeof patch.height === 'number' ||
          typeof patch.rotation === 'number')
      ) {
        updateCorridorSplitAnchorsOnDrag(updatedObject, patch, target ?? undefined);
      } else if (
        updatedObject?.type === 'CORRIDOR' &&
        patch.data &&
        ('corridorAxis' in patch.data || 'corridorAutoFit' in patch.data)
      ) {
        persistCorridorMetadataOnly(updatedObject);
      }
      if (sectionDelta) translateSectionCorridorBase(map, sectionDelta.sectionId, sectionDelta.delta);
      applyCorridorReflow(map);
      return { map, isDirty: true, past, future: [] };
    }),
  updateObjects: (updates) =>
    set((state) => {
      if (!state.map || updates.length === 0) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      const patchById = new Map(updates.map((entry) => [entry.id, entry.patch]));
      const sectionDeltas: Array<{ sectionId: string; delta: { x: number; y: number } }> = [];

      for (const object of map.objects) {
        const patch = patchById.get(object.id);
        if (!patch || object.type !== 'SECTION' || !object.sectionId) continue;
        const nextX = typeof patch.x === 'number' ? patch.x : object.x;
        const nextY = typeof patch.y === 'number' ? patch.y : object.y;
        const dx = nextX - object.x;
        const dy = nextY - object.y;
        if (Math.abs(dx) >= 0.001 || Math.abs(dy) >= 0.001) {
          sectionDeltas.push({ sectionId: object.sectionId, delta: { x: dx, y: dy } });
        }
      }

      map.objects = map.objects.map((object) => {
        const patch = patchById.get(object.id);
        if (!patch) return object;
        if (patch.data) {
          return { ...object, ...patch, data: { ...object.data, ...patch.data } };
        }
        return { ...object, ...patch };
      });

      for (const entry of sectionDeltas) {
        translateSectionCorridorBase(map, entry.sectionId, entry.delta);
      }
      applyCorridorReflow(map);
      return { map, isDirty: true, past, future: [] };
    }),
  updateMapItems: ({ objects = [], seats = [] }) =>
    set((state) => {
      if (!state.map || (objects.length === 0 && seats.length === 0)) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      const objectPatchById = new Map(objects.map((entry) => [entry.id, entry.patch]));
      const seatPatchById = new Map(seats.map((entry) => [entry.id, entry.patch]));
      const sectionDeltaById = new Map<string, { x: number; y: number }>();

      if (objectPatchById.size > 0) {
        for (const object of map.objects) {
          const patch = objectPatchById.get(object.id);
          if (!patch || object.type !== 'SECTION' || !object.sectionId) continue;
          const nextX = typeof patch.x === 'number' ? patch.x : object.x;
          const nextY = typeof patch.y === 'number' ? patch.y : object.y;
          const dx = nextX - object.x;
          const dy = nextY - object.y;
          if (Math.abs(dx) >= 0.001 || Math.abs(dy) >= 0.001) {
            sectionDeltaById.set(object.sectionId, { x: dx, y: dy });
          }
        }

        map.objects = map.objects.map((object) => {
          const patch = objectPatchById.get(object.id);
          if (!patch) return object;
          if (patch.data) {
            return { ...object, ...patch, data: { ...object.data, ...patch.data } };
          }
          return { ...object, ...patch };
        });

        for (const [sectionId, delta] of sectionDeltaById) {
          translateSectionCorridorBase(map, sectionId, delta);
        }
      }

      if (seatPatchById.size > 0) {
        const seatBaseDeltas: Array<{ seatId: string; sectionId: string; delta: { x: number; y: number } }> = [];
        for (const seat of map.seats) {
          const patch = seatPatchById.get(seat.id);
          if (!patch) continue;
          const nextX = typeof patch.x === 'number' ? patch.x : seat.x;
          const nextY = typeof patch.y === 'number' ? patch.y : seat.y;
          const sectionDelta = sectionDeltaById.get(seat.sectionId) ?? { x: 0, y: 0 };
          const residualDelta = {
            x: nextX - seat.x - sectionDelta.x,
            y: nextY - seat.y - sectionDelta.y,
          };
          if (Math.abs(residualDelta.x) >= 0.001 || Math.abs(residualDelta.y) >= 0.001) {
            seatBaseDeltas.push({ seatId: seat.id, sectionId: seat.sectionId, delta: residualDelta });
          }
        }
        translateSeatCorridorBase(map, seatBaseDeltas);

        map.seats = map.seats.map((seat) => {
          const patch = seatPatchById.get(seat.id);
          return patch ? { ...seat, ...patch } : seat;
        });
        updateCounts(map);
      }

      applyCorridorReflow(map);

      return { map, isDirty: true, past, future: [] };
    }),
  deleteObject: (id) =>
    set((state) => {
      if (!state.map) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.objects = sanitizeGroupMembership(map.objects.filter((object) => object.id !== id));
      applyCorridorReflow(map);
      return {
        map,
        selection: state.selection.filter((item) => !(item.type === 'object' && item.id === id)),
        isDirty: true,
        past,
        future: [],
      };
    }),
  updateSeat: (id, patch) =>
    set((state) => {
      if (!state.map) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      const target = map.seats.find((seat) => seat.id === id);
      if (target) {
        const nextX = typeof patch.x === 'number' ? patch.x : target.x;
        const nextY = typeof patch.y === 'number' ? patch.y : target.y;
        translateSeatCorridorBase(map, [
          {
            seatId: target.id,
            sectionId: target.sectionId,
            delta: { x: nextX - target.x, y: nextY - target.y },
          },
        ]);
      }
      map.seats = map.seats.map((seat) => (seat.id === id ? { ...seat, ...patch } : seat));
      applyCorridorReflow(map);
      updateCounts(map);
      return { map, isDirty: true, past, future: [] };
    }),
  updateSection: (id, patch) =>
    set((state) => {
      if (!state.map) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.sections = map.sections.map((section) => (section.id === id ? { ...section, ...patch } : section));
      if (patch.name || patch.color) {
        map.objects = map.objects.map((object) =>
          object.sectionId === id
            ? {
                ...object,
                data: {
                  ...object.data,
                  ...(patch.name ? { label: patch.name } : {}),
                  ...(patch.color ? { fill: patch.color } : {}),
                },
              }
            : object,
        );
      }
      return { map, isDirty: true, past, future: [] };
    }),
  updateLevel: (id, patch) =>
    set((state) => {
      if (!state.map) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.levels = map.levels.map((level) => {
        if (level.id !== id) return level;
        const { widthPx: _widthPx, heightPx: _heightPx, unit: _unit, sortOrder: _sortOrder, ...allowedPatch } = patch;
        if (isPlateiaBaseLevel(level)) {
          return {
            ...level,
            ...allowedPatch,
            widthPx: MAP_AREA_WIDTH_PX,
            heightPx: MAP_AREA_HEIGHT_PX,
            unit: 'px',
          };
        }
        return {
          ...level,
          ...allowedPatch,
          widthPx: MAP_AREA_WIDTH_PX,
          heightPx: MAP_AREA_HEIGHT_PX,
          unit: 'px',
        };
      });
      applyMapLevels(map);
      return { map, isDirty: true, past, future: [] };
    }),
  addLevel: (name) =>
    set((state) => {
      if (!state.map) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      const levelCount = normalizeMapLevels(map.levels).length;
      const level: EventMapLevelDTO = {
        id: createLocalId('level'),
        name: name?.trim() || `Ambiente ${levelCount + 1}`,
        sortOrder: getNextLevelSortOrder(map.levels),
        widthPx: MAP_AREA_WIDTH_PX,
        heightPx: MAP_AREA_HEIGHT_PX,
        unit: 'px',
        scale: null,
      };
      map.levels.push(level);
      applyMapLevels(map);
      return {
        map,
        activeLevelId: level.id,
        selection: replaceSelection({ type: 'level', id: level.id }),
        isDirty: true,
        past,
        future: [],
      };
    }),
  toggleObjectVisibility: (id) =>
    set((state) => {
      if (!state.map) return state;
      const target = state.map.objects.find((object) => object.id === id);
      if (!target) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.objects = map.objects.map((object) => (object.id === id ? { ...object, hidden: !object.hidden } : object));
      return { map, isDirty: true, past, future: [] };
    }),
  toggleSectionVisibility: (id) =>
    set((state) => {
      if (!state.map) return state;
      const linked = state.map.objects.find((object) => object.sectionId === id);
      const nextHidden = linked ? !linked.hidden : true;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.objects = map.objects.map((object) => (object.sectionId === id ? { ...object, hidden: nextHidden } : object));
      map.seats = map.seats.map((seat) => (seat.sectionId === id ? { ...seat, publicVisible: !nextHidden } : seat));
      updateCounts(map);
      return { map, isDirty: true, past, future: [] };
    }),
  deleteSection: (id) =>
    set((state) => {
      if (!state.map) return state;
      const hasSoldSeat = state.map.seats.some((seat) => seat.sectionId === id && seat.status === 'SOLD');
      if (hasSoldSeat) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.seats = map.seats.filter((seat) => seat.sectionId !== id);
      map.objects = map.objects.filter((object) => object.sectionId !== id);
      map.sections = map.sections.filter((section) => section.id !== id);
      updateCounts(map);
      return {
        map,
        selection: state.selection.filter((item) => !(item.type === 'section' && item.id === id)),
        isDirty: true,
        past,
        future: [],
      };
    }),
  deleteLevel: (id) =>
    set((state) => {
      if (!state.map) return state;
      const level = state.map.levels.find((entry) => entry.id === id);
      if (!level || isPlateiaBaseLevel(level)) return state;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      map.seats = map.seats.filter((seat) => seat.levelId !== id);
      map.objects = map.objects.filter((object) => object.levelId !== id);
      map.sections = map.sections.filter((section) => section.levelId !== id);
      map.levels = map.levels.filter((entry) => entry.id !== id);
      applyMapLevels(map);
      updateCounts(map);
      const activeLevelId = state.activeLevelId === id ? getDefaultActiveLevelId(map.levels) : state.activeLevelId;
      const selection = state.selection.filter((item) => !(item.type === 'level' && item.id === id));
      return { map, activeLevelId, selection, isDirty: true, past, future: [] };
    }),
  deleteSelection: () =>
    set((state) => {
      const items = expandObjectSelectionItems(getSelectableItems(state.selection), state.map?.objects ?? []);
      if (!state.map || items.length === 0) return state;

      const map = cloneMap(state.map);
      const past = withHistory(state);

      for (const item of items) {
        if (item.type === 'seat') {
          const seat = map.seats.find((entry) => entry.id === item.id);
          if (seat?.status === 'SOLD') return state;
          map.seats = map.seats.filter((entry) => entry.id !== item.id);
        }

        if (item.type === 'object') {
          map.objects = map.objects.filter((entry) => entry.id !== item.id);
          applyCorridorReflow(map);
        }

        if (item.type === 'section') {
          const hasSoldSeat = map.seats.some((seat) => seat.sectionId === item.id && seat.status === 'SOLD');
          if (hasSoldSeat) return state;
          map.seats = map.seats.filter((seat) => seat.sectionId !== item.id);
          map.objects = map.objects.filter((object) => object.sectionId !== item.id);
          map.sections = map.sections.filter((section) => section.id !== item.id);
        }
      }

      map.objects = sanitizeGroupMembership(map.objects);
      updateCounts(map);
      return { map, selection: [], isDirty: true, past, future: [] };
    }),
  duplicateSelection: () =>
    set((state) => {
      const items = getSelectableItems(state.selection);
      if (!state.map || items.length === 0) return state;

      const map = cloneMap(state.map);
      const past = withHistory(state);
      const created: MapSelectionItem[] = [];
      const groupIdMap = new Map<string, string>();
      const groupLabelMap = new Map<string, string>();

      for (const item of items) {
        if (item.type === 'object') {
          const object = map.objects.find((entry) => entry.id === item.id);
          if (!object || object.locked) continue;
          if (object.sectionId && object.type === 'SECTION') continue;
          const oldGroupId = getObjectGroupId(object);
          let nextGroupId: string | null = null;
          let nextGroupLabel: string | null = null;
          if (oldGroupId) {
            if (!groupIdMap.has(oldGroupId)) {
              groupIdMap.set(oldGroupId, createLocalId('group'));
              groupLabelMap.set(
                oldGroupId,
                getNextGroupDisplayName(map.objects, getObjectGroupLabel(object)),
              );
            }
            nextGroupId = groupIdMap.get(oldGroupId) ?? null;
            nextGroupLabel = groupLabelMap.get(oldGroupId) ?? null;
          }
          const copy: EventMapObjectDTO = {
            ...object,
            id: createLocalId('object'),
            x: object.x + 28,
            y: object.y + 28,
            sortOrder: map.objects.length,
            data: setObjectGroupData(withDuplicateObjectLabel(object, map.objects), nextGroupId, nextGroupLabel),
          };
          map.objects.push(copy);
          created.push({ type: 'object', id: copy.id });
        }

        if (item.type === 'seat') {
          const seat = map.seats.find((entry) => entry.id === item.id);
          if (!seat) continue;
          const copy = {
            ...seat,
            id: createLocalId('seat'),
            technicalCode: `${seat.technicalCode}-C`,
            displayLabel: `${seat.displayLabel}C`,
            x: seat.x + 34,
            y: seat.y,
            status: 'AVAILABLE' as const,
          };
          map.seats.push(copy);
          created.push({ type: 'seat', id: copy.id });
        }
      }

      if (created.length === 0) return state;
      if (created.some((item) => {
        if (item.type !== 'object') return false;
        return map.objects.some((object) => object.id === item.id && object.type === 'CORRIDOR');
      })) {
        applyCorridorReflow(map);
      }
      updateCounts(map);
      return { map, selection: created, isDirty: true, past, future: [] };
    }),
  groupSelection: () =>
    set((state) => {
      if (!state.map) return state;

      const validation = validateGroupCandidates(getSelectableItems(state.selection), state.map.objects);
      if (!validation.ok) return state;

      const candidates = validation.candidates;
      const map = cloneMap(state.map);
      const past = withHistory(state);
      const groupId = createLocalId('group');
      const groupLabel = getNextGroupDisplayName(map.objects);
      const memberIds = new Set(candidates.map((object) => object.id));

      map.objects = map.objects.map((object) =>
        memberIds.has(object.id)
          ? { ...object, data: setObjectGroupData(object.data, groupId, groupLabel) }
          : object,
      );
      map.objects = sanitizeGroupMembership(map.objects);

      return {
        map,
        selection: candidates.map((object) => ({ type: 'object' as const, id: object.id })),
        isDirty: true,
        past,
        future: [],
      };
    }),
  ungroupSelection: () =>
    set((state) => {
      const items = getSelectableItems(state.selection).filter((item) => item.type === 'object');
      if (!state.map || items.length === 0) return state;

      const groupIds = new Set<string>();
      for (const item of items) {
        const object = state.map.objects.find((entry) => entry.id === item.id);
        const groupId = object ? getObjectGroupId(object) : null;
        if (groupId) groupIds.add(groupId);
      }
      if (groupIds.size === 0) return state;

      const map = cloneMap(state.map);
      const past = withHistory(state);

      map.objects = map.objects.map((object) => {
        const groupId = getObjectGroupId(object);
        if (groupId && groupIds.has(groupId)) {
          return { ...object, data: setObjectGroupData(object.data, null, null) };
        }
        return object;
      });

      return { map, isDirty: true, past, future: [] };
    }),
  nudgeSelection: ({ x: dx, y: dy }) =>
    set((state) => {
      const items = expandObjectSelectionItems(getSelectableItems(state.selection), state.map?.objects ?? []);
      if (!state.map || items.length === 0 || (dx === 0 && dy === 0)) return state;

      const map = cloneMap(state.map);
      const past = withHistory(state);
      const movedSectionIds = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));

      for (const item of items) {
        if (item.type !== 'section') continue;

        const linkedObject = map.objects.find((object) => object.sectionId === item.id);
        if (linkedObject && !linkedObject.locked) {
          linkedObject.x += dx;
          linkedObject.y += dy;
        }
        translateSectionCorridorBase(map, item.id, { x: dx, y: dy });

        for (const seat of map.seats) {
          if (seat.sectionId === item.id && seat.status !== 'SOLD') {
            seat.x += dx;
            seat.y += dy;
          }
        }
      }

      for (const item of items) {
        if (item.type === 'object') {
          const object = map.objects.find((entry) => entry.id === item.id);
          if (!object || object.locked) continue;
          if (object.sectionId && movedSectionIds.has(object.sectionId)) continue;
          object.x += dx;
          object.y += dy;
        }

        if (item.type === 'seat') {
          const seat = map.seats.find((entry) => entry.id === item.id);
          if (!seat || seat.status === 'SOLD') continue;
          if (seat.sectionId && movedSectionIds.has(seat.sectionId)) continue;
          seat.x += dx;
          seat.y += dy;
        }
      }

      applyCorridorReflow(map);
      updateCounts(map);
      return { map, isDirty: true, past, future: [] };
    }),
  undo: () =>
    set((state) => {
      const previous = state.past.at(-1);
      if (!previous || !state.map) return state;
      return {
        map: previous,
        past: state.past.slice(0, -1),
        future: [cloneMap(state.map), ...state.future].slice(0, 24),
        isDirty: true,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next || !state.map) return state;
      return {
        map: next,
        past: [...state.past, cloneMap(state.map)].slice(-24),
        future: state.future.slice(1),
        isDirty: true,
      };
    }),
  markSaved: (map) =>
    set((state) => {
      const nextMap = map ? cloneAndNormalizeMap(map) : state.map;
      const activeStillExists = nextMap?.levels.some((level) => level.id === state.activeLevelId) ?? false;
      return {
        map: nextMap,
        activeLevelId: activeStillExists ? state.activeLevelId : getDefaultActiveLevelId(nextMap?.levels ?? []),
        isDirty: false,
        past: [],
        future: [],
      };
    }),
  setInlineTextEditorActive: (active) => set({ inlineTextEditorActive: active }),
  toPayload: () => {
    const map = get().map;
    if (!map) return null;
    const normalized = cloneAndNormalizeMap(map);
    return {
      name: normalized.name,
      levels: normalized.levels,
      sections: normalized.sections.map(({ lot: _lot, ...section }) => section),
      objects: normalized.objects,
      seats: normalized.seats,
    };
  },
}));
