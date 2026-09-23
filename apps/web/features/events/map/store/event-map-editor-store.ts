'use client';
import { MAP_AREA_HEIGHT_PX, MAP_AREA_WIDTH_PX, buildLevelLayerSortOrderPatches, computeArtboardFitView, createSeatBlock, executeMapCommand, expandObjectSelectionItems, findMapBlockOwner, findMapRowOwner, findMapSeatOwner, getNextGroupDisplayName, getNextLevelSortOrder, getNextSeatBlockRowPrefix, getObjectGroupId, getObjectGroupLabel, getSeatBlockPreviewBounds, getSeatBlockRowLabel, getSelectableItems, getTextModeFromCreation, isPlateiaBaseLevel, migrateLegacyMapDocument, normalizeMapLevels, normalizeSeatBlockConfig, normalizeSelection, normalizeTextData, pathLength, projectMapDocumentToEditorFields, reorderLevelPanelChildItems, replaceSelection, resizeArcPathToLength, resolveSeatCountForRow, sanitizeGroupMembership, sanitizeTextObjectData, sectionLocalToWorld, setObjectGroupData, sortLevelPanelChildren, toggleSelectionItem, validateGroupCandidates, withAutoObjectLabel, withDuplicateObjectLabel, worldToSectionLocal } from '@alusa/domain';
import type { EventMapDTO, EventMapDraftPayload, EventMapLevelDTO, EventMapObjectDTO, EventMapSectionDTO, EventSeatDTO, MapCommand, MapSelection, MapSelectionItem, MapTool, MapReferenceChart, MapSeatBlock, MapSeatRow, SeatBlockConfig, SeatDistributionMode, SeatRowPath } from '@alusa/domain';

import { create } from 'zustand';

export type { MapSelection, MapSelectionItem, MapTool };

type SeatBlockPropertiesPatch = Partial<Pick<MapSeatBlock, 'name' | 'columnCount' | 'rowGap' | 'defaultSeatGap' | 'distribution' | 'distributionMode' | 'distributionAlignment' | 'firstRowSeatCount' | 'lastRowSeatCount' | 'fitMinimumSeatCount' | 'fitMaximumSeatCount'>> & {
  seatSize?: number;
  rowSeatCounts?: number[];
  rowPaths?: SeatRowPath[];
};

type EventMapEditorState = {
  map: EventMapDTO | null;
  activeLevelId: string | null;
  tool: MapTool;
  selection: MapSelection;
  zoom: number;
  pan: { x: number; y: number };
  viewportSize: { width: number; height: number };
  isDirty: boolean;
  past: Array<{
    execute: MapCommand;
    undo: MapCommand;
    executeSelection?: MapSelection;
    undoSelection?: MapSelection;
  }>;
  future: Array<{
    execute: MapCommand;
    undo: MapCommand;
    executeSelection?: MapSelection;
    undoSelection?: MapSelection;
  }>;
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
  ascendSelection: () => boolean;
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
  addSeatBlockAt: (point: { x: number; y: number }, config: Partial<SeatBlockConfig>) => void;
  updateSeatBlock: (id: string, patch: SeatBlockPropertiesPatch) => void;
  updateSeatRow: (id: string, patch: Partial<Pick<MapSeatRow, 'path' | 'seatGap' | 'seatSize'>>) => void;
  deleteSeatBlock: (id: string) => void;
  updateSeatRowPath: (rowId: string, path: SeatRowPath) => void;
  transformParametricSelection: (item: Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>, matrix: [number, number, number, number, number, number]) => void;
  transformParametricSelections: (transforms: Array<{ item: Extract<MapSelectionItem, { type: 'seatblock' | 'seatrow' }>; matrix: [number, number, number, number, number, number] }>) => void;
  updateObject: (id: string, patch: Partial<EventMapObjectDTO>) => void;
  updateObjects: (updates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>) => void;
  updateMapItems: (updates: {
    objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
    seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
    skipSeatBaseLayoutTranslation?: boolean;
  }) => void;
  applyTransform: (
    command: Extract<
      MapCommand,
      {
        type:
          | 'RESIZE_OBJECTS'
          | 'RESIZE_SELECTION'
          | 'ROTATE_OBJECTS'
          | 'ROTATE_SELECTION'
          | 'MOVE_OBJECTS'
          | 'MOVE_SELECTION';
      }
    >,
  ) => void;
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
  reorderLevelLayers: (levelId: string, fromIndex: number, toIndex: number) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (map?: EventMapDTO) => void;
  patchMapSettings: (patch: { name?: string; publicEnabled?: boolean }) => void;
  setReferenceChart: (referenceChart: MapReferenceChart | null) => void;
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

function translateRowPath(path: SeatRowPath, dx: number, dy: number): SeatRowPath {
  const point = (value: { x: number; y: number }) => ({ x: value.x + dx, y: value.y + dy });
  if (path.type === 'LINE') return { ...path, start: point(path.start), end: point(path.end) };
  if (path.type === 'ARC') return { ...path, center: point(path.center) };
  if (path.type === 'POLYLINE') return { ...path, points: path.points.map(point) };
  return { ...path, p0: point(path.p0), p1: point(path.p1), p2: point(path.p2), p3: point(path.p3) };
}

function ensureRowSeatCapacity(row: MapSeatBlock['rows'][number], requiredCount: number, rowIndex?: number): MapSeatBlock['rows'][number] {
  if (row.seats.length >= requiredCount) return row;
  const seats = [...row.seats];
  const seatIds = [...row.seatIds];
  for (let index = seats.length; index < requiredCount; index += 1) {
    const id = createLocalId('seat');
    const number = index + 1;
    seats.push({
      id,
      label: `${row.label}${number}`,
      technicalCode: `${row.label}${number}`,
      rowIndex: rowIndex ?? row.seats[0]?.rowIndex ?? 0,
      columnIndex: index,
      accessible: false,
      publicVisible: true,
    });
    seatIds.push(id);
  }
  return { ...row, seats, seatIds };
}

function seatCountFromSegments(segments: MapSeatBlock['distribution']) {
  return segments.reduce((total, segment) => total + (segment.type === 'SEATS' ? segment.count : 0), 0);
}

function fixedRowSeatCounts(block: MapSeatBlock) {
  const fallback = seatCountFromSegments(block.distribution);
  return block.rows.map((row) => row.distribution ? seatCountFromSegments(row.distribution) : fallback);
}

/**
 * A seat position is an explicit exception to the row's parametric layout.
 * Changing the row rhythm must return seats to that layout; otherwise an old
 * dragged position wins over the new size/gap and seats visually pile up.
 */
function clearSeatLayoutOverrides(row: MapSeatBlock['rows'][number]): MapSeatBlock['rows'][number] {
  return {
    ...row,
    seats: row.seats.map(({ position: _position, rotation: _rotation, ...seat }) => seat),
  };
}

function resizeRowPath(
  path: SeatRowPath,
  seatCount: number,
  seatSize: number,
  seatGap: number,
): SeatRowPath {
  if (seatCount < 1) return path;
  const nextLength = seatSize + Math.max(0, seatCount - 1) * (seatSize + seatGap);
  if (path.type === 'ARC') {
    return resizeArcPathToLength(path, nextLength);
  }
  if (path.type === 'LINE') {
    const dx = path.end.x - path.start.x;
    const dy = path.end.y - path.start.y;
    const currentLength = Math.hypot(dx, dy);
    const unitX = currentLength <= 0.001 ? 1 : dx / currentLength;
    const unitY = currentLength <= 0.001 ? 0 : dy / currentLength;
    return {
      type: 'LINE',
      start: path.start,
      end: { x: path.start.x + unitX * nextLength, y: path.start.y + unitY * nextLength },
    };
  }
  const currentLength = pathLength(path);
  if (currentLength <= 0.001) return path;
  const first = path.type === 'POLYLINE' ? path.points[0]! : path.p0;
  const last = path.type === 'POLYLINE' ? path.points.at(-1)! : path.p3;
  const anchor = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const scale = nextLength / currentLength;
  const resizePoint = (point: { x: number; y: number }) => ({
    x: anchor.x + (point.x - anchor.x) * scale,
    y: anchor.y + (point.y - anchor.y) * scale,
  });
  if (path.type === 'POLYLINE') return { ...path, points: path.points.map(resizePoint) };
  return {
    type: 'BEZIER',
    p0: resizePoint(path.p0),
    p1: resizePoint(path.p1),
    p2: resizePoint(path.p2),
    p3: resizePoint(path.p3),
  };
}

function getAlignedLinearRowPath(basePath: Extract<SeatRowPath, { type: 'LINE' }>, rowIndex: number, rowPitch: number) {
  const dx = basePath.end.x - basePath.start.x;
  const dy = basePath.end.y - basePath.start.y;
  const length = Math.hypot(dx, dy);
  const unitX = length <= 0.001 ? 1 : dx / length;
  const unitY = length <= 0.001 ? 0 : dy / length;
  const offset = rowIndex * rowPitch;
  const start = {
    x: basePath.start.x - unitY * offset,
    y: basePath.start.y + unitX * offset,
  };
  return {
    type: 'LINE' as const,
    start,
    end: { x: start.x + unitX * length, y: start.y + unitY * length },
  };
}

function applyMapLevels(map: EventMapDTO) {
  map.levels = normalizeMapLevels(map.levels);
}

function cloneAndNormalizeMap(map: EventMapDTO): EventMapDTO {
  const next = cloneMap(map);
  applyMapLevels(next);
  next.objects = next.objects.map((object) =>
    object.type === 'TEXT' ? { ...object, data: sanitizeTextObjectData(normalizeTextData(object.data)) } : object,
  );
  const document = next.document ?? documentFromMap(next);
  const normalizedDocument = {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      outline: section.blocks.length > 0 ? [] : section.outline,
      blocks: section.blocks.map((block) => ({
        ...block,
        columnCount: Math.max(
          1,
          Math.round(block.columnCount ?? Math.max(...block.rows.map((row) => row.seats.length), 1)),
        ),
      })),
    })),
  };
  const projection = projectMapDocumentToEditorFields(normalizedDocument, next);
  next.document = normalizedDocument;
  next.sections = projection.sections;
  next.objects = projection.objects;
  next.seats = projection.seats;
  next.counts = {
    ...next.counts,
    sections: projection.sections.length,
    seats: projection.seats.length,
    availableSeats: projection.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
  };
  return next;
}

function documentFromMap(map: EventMapDTO) {
  if (map.document) return cloneMap({ ...map, document: map.document }).document!;
  return migrateLegacyMapDocument({
    sections: map.sections.map((section) => ({
      id: section.id,
      levelId: section.levelId,
      name: section.name,
      color: section.color,
      lotId: section.lotId,
      capacity: section.capacity,
      status: section.status,
      notes: section.notes,
    })),
    groups: [],
    seats: map.seats.map((seat) => ({
      id: seat.id,
      sectionId: seat.sectionId,
      rowIndex: seat.rowIndex,
      columnIndex: seat.columnIndex,
      technicalCode: seat.technicalCode,
      displayLabel: seat.displayLabel,
      rowLabel: seat.rowLabel,
      seatNumber: seat.seatNumber,
      accessible: seat.accessible,
      publicVisible: seat.publicVisible,
    })),
    visualElements: map.objects,
  });
}

function buildRedoUpdateItems(
  map: EventMapDTO,
  nextMap: EventMapDTO,
): MapCommand {
  const objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seats: Array<{ id: string; patch: Partial<EventSeatDTO> }> = [];
  const sections: Array<{ id: string; patch: Partial<EventMapSectionDTO> }> = [];
  const levels: Array<{ id: string; patch: Partial<EventMapLevelDTO> }> = [];

  for (const next of nextMap.objects) {
    const prev = map.objects.find((o) => o.id === next.id);
    if (!prev) continue;
    const patch: Partial<EventMapObjectDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'locked', 'hidden', 'sortOrder'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = next[key];
        changed = true;
      }
    }
    if (JSON.stringify(prev.data) !== JSON.stringify(next.data)) {
      patch.data = next.data;
      changed = true;
    }
    if (changed) {
      objects.push({ id: next.id, patch });
    }
  }

  for (const next of nextMap.seats) {
    const prev = map.seats.find((s) => s.id === next.id);
    if (!prev) continue;
    const patch: Partial<EventSeatDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'size', 'rotation', 'status', 'accessible', 'publicVisible', 'technicalCode', 'displayLabel', 'rowLabel', 'seatNumber', 'objectId'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = next[key];
        changed = true;
      }
    }
    if (changed) {
      seats.push({ id: next.id, patch });
    }
  }

  for (const next of nextMap.sections) {
    const prev = map.sections.find((s) => s.id === next.id);
    if (!prev) continue;
    const patch: Partial<EventMapSectionDTO> = {};
    let changed = false;
    for (const key of ['name', 'color', 'capacity', 'status', 'notes', 'lotId', 'hidden'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = next[key];
        changed = true;
      }
    }
    if (changed) {
      sections.push({ id: next.id, patch });
    }
  }

  for (const next of nextMap.levels) {
    const prev = map.levels.find((l) => l.id === next.id);
    if (!prev) continue;
    const patch: Partial<EventMapLevelDTO> = {};
    let changed = false;
    for (const key of ['name', 'sortOrder', 'widthPx', 'heightPx', 'unit', 'scale'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = next[key];
        changed = true;
      }
    }
    if (changed) {
      levels.push({ id: next.id, patch });
    }
  }

  return {
    type: 'UPDATE_ITEMS',
    payload: {
      objects,
      seats,
      sections,
      levels,
      skipSeatBaseLayoutTranslation: true,
    },
  };
}

function buildRedoCommand(
  command: MapCommand,
  map: EventMapDTO,
  nextMap: EventMapDTO,
): MapCommand {
  if (command.type === 'REPLACE_DOCUMENT') return command;
  const createdObjects = nextMap.objects.filter((no) => !map.objects.some((o) => o.id === no.id));
  const createdSeats = nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id));
  const createdSections = nextMap.sections.filter((ns) => !map.sections.some((s) => s.id === ns.id));
  const createdLevels = nextMap.levels.filter((nl) => !map.levels.some((l) => l.id === nl.id));

  if (
    createdObjects.length > 0 ||
    createdSeats.length > 0 ||
    createdSections.length > 0 ||
    createdLevels.length > 0 ||
    false
  ) {
    return {
      type: 'RESTORE_DELETED_ITEMS',
      payload: {
        objects: createdObjects,
        seats: createdSeats,
        sections: createdSections,
        levels: createdLevels,
      },
    };
  }

  if (
    command.type === 'DELETE_SELECTION' ||
    command.type === 'DELETE_LEVEL'
  ) {
    return command;
  }

  return buildRedoUpdateItems(map, nextMap);
}

function commitCommandResult(
  state: EventMapEditorState,
  command: MapCommand,
  res: ReturnType<typeof executeMapCommand>,
) {
  const hasMapChanged = res.map !== state.map;
  let nextPast = state.past;
  if (hasMapChanged && res.undoCommand) {
    const redoCommand = buildRedoCommand(command, state.map!, res.map);
    nextPast = [
      ...state.past.slice(-24),
      {
        execute: redoCommand,
        undo: res.undoCommand,
        executeSelection: res.selection ?? state.selection,
        undoSelection: state.selection,
      },
    ];
  }
  return {
    ...(hasMapChanged ? { map: res.map, isDirty: true, past: nextPast, future: [] } : {}),
    selection: res.selection ?? state.selection,
    ...(res.activeLevelId ? { activeLevelId: res.activeLevelId } : {}),
  };
}

function runCommand(
  state: EventMapEditorState,
  command: MapCommand,
): Partial<EventMapEditorState> {
  if (!state.map) return {};
  const res = executeMapCommand(
    state.map,
    command,
    {
      activeLevelId: state.activeLevelId,
      selection: state.selection,
      runtime: { createId: createLocalId },
    },
  );
  return commitCommandResult(state, command, res);
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
    data: { label: sectionName, fill: color, fillEnabled: false, opacity: 0 },
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
    orders: map.counts.orders ?? 0,
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
  ascendSelection: () => {
    const state = get();
    if (!state.map?.document || state.selection.length !== 1) return false;
    const current = state.selection[0];
    if (!current || current.type === 'level') return false;
    if (current.type === 'seat') {
      const owner = findMapSeatOwner(state.map.document, current.id);
      if (!owner) return false;
      set({ selection: [{ type: 'seatrow', id: owner.row.id }] });
      return true;
    }
    if (current.type === 'seatrow') {
      const owner = findMapRowOwner(state.map.document, current.id);
      if (!owner) return false;
      set({ selection: [{ type: 'seatblock', id: owner.block.id }] });
      return true;
    }
    if (current.type === 'seatblock') {
      const owner = findMapBlockOwner(state.map.document, current.id);
      if (!owner) return false;
      set({ selection: [{ type: 'section', id: owner.section.id }] });
      return true;
    }
    if (current.type === 'section') {
      set({ selection: [] });
      return true;
    }
    return false;
  },
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
    const id = createLocalId(tool === 'section' ? 'section' : tool === 'seat' ? 'seat' : 'object');
    let createdId: string | null = null;
    set((state) => {
      if (!state.map) return state;
      if (tool === 'section' && state.map.document) {
        const levelId = state.activeLevelId ?? state.map.levels[0]?.id;
        if (!levelId) return state;
        const width = Math.max(120, size?.width ?? 360);
        const height = Math.max(90, size?.height ?? 240);
        const section = {
          id,
          levelId,
          name: `Setor ${state.map.document.sections.length + 1}`,
          color: DEFAULT_COLORS[state.map.document.sections.length % DEFAULT_COLORS.length]!,
          lotId: null,
          capacity: null,
          status: 'ACTIVE',
          notes: null,
          position: { x: point.x, y: point.y },
          rotation: 0,
          outline: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
          blockIds: [],
          blocks: [],
        };
        const before = state.map.document;
        const after = { ...before, sections: [...before.sections, section] };
        const result = runCommand(state, {
          type: 'REPLACE_DOCUMENT',
          payload: { before, after, description: 'Criar seção' },
        });
        createdId = id;
        return { ...result, selection: [{ type: 'section', id }] };
      }
      const cmd: MapCommand = { type: 'ADD_OBJECT', payload: { id, tool, point, size } };
      const res = executeMapCommand(
        state.map,
        cmd,
        {
          activeLevelId: state.activeLevelId,
          selection: state.selection,
          runtime: { createId: createLocalId },
        },
      );
      createdId = res.createdId ?? null;
      return commitCommandResult(state, cmd, res);
    });
    return createdId;
  },
  deleteObject: (id) =>
    set((state) => runCommand(state, { type: 'DELETE_SELECTION', payload: { selection: [{ type: 'object', id }] } })),
  addRowAt: (point, quantity = 12) =>
    (() => {
      const calibration = get().map?.referenceChart?.calibration;
      const seatSize = calibration?.seatDiameter ?? 28;
      get().addSeatBlockAt(point, {
        rows: 1,
        columns: quantity,
        totalSeats: quantity,
        seatSize,
        horizontalSpacing: seatSize + (calibration?.seatPitch ?? 10),
        verticalSpacing: seatSize + (calibration?.rowPitch ?? 14),
      });
    })(),
  addSeatBlockAt: (point, config) =>
    set((state) => {
      if (!state.map) return state;
      const normalizedConfig = normalizeSeatBlockConfig(config);
      const rowCount = Math.min(normalizedConfig.rows, Math.max(1, Math.ceil(normalizedConfig.totalSeats / normalizedConfig.columns)));
      const rowSeatCounts = Array.from({ length: rowCount }, (_, rowIndex) =>
        Math.min(normalizedConfig.columns, Math.max(0, normalizedConfig.totalSeats - rowIndex * normalizedConfig.columns)),
      );
      const before = documentFromMap(state.map);
      const levelId = state.activeLevelId ?? state.map.levels[0]?.id;
      if (!levelId) return state;
      const usedRowLabels = before.sections
        .filter((entry) => entry.levelId === levelId)
        .flatMap((entry) => entry.blocks.flatMap((block) => block.rows.map((row) => row.label)));
      const configuredPrefix = config.rowPrefix?.trim();
      const rowPrefix = configuredPrefix && configuredPrefix.toUpperCase() !== 'A'
        ? configuredPrefix
        : getNextSeatBlockRowPrefix(usedRowLabels);
      const sectionId = createLocalId('section');
      const section = {
        id: sectionId,
        levelId,
        name: `Setor ${before.sections.length + 1}`,
        color: DEFAULT_COLORS[before.sections.length % DEFAULT_COLORS.length]!,
        lotId: null,
        capacity: null,
        status: 'ACTIVE',
        notes: null,
        position: { x: 0, y: 0 },
        rotation: 0,
        outline: [],
        blockIds: [],
        blocks: [],
      };
      const document = { ...before, sections: [...before.sections, section] };
      const result = createSeatBlock({
        document,
        sectionId: section.id,
        origin: point,
        rows: rowCount,
        columns: normalizedConfig.columns,
        seatSize: normalizedConfig.seatSize,
        seatGap: Math.max(0, normalizedConfig.horizontalSpacing - normalizedConfig.seatSize),
        rowGap: Math.max(0, normalizedConfig.verticalSpacing - normalizedConfig.seatSize),
        rowSeatCounts,
        rowPrefix,
        startNumber: normalizedConfig.startNumber,
        createId: createLocalId,
      });
      const command: MapCommand = {
        type: 'REPLACE_DOCUMENT',
        payload: { before, after: result.document, description: 'Criar bloco de fileiras' },
      };
      const next = runCommand(state, command);
      return { ...next, selection: [{ type: 'seatblock', id: result.blockId }] };
    }),
  updateSeatBlock: (id, patch) =>
    set((state) => {
      if (!state.map?.document) return state;
      const before = state.map.document;
      const { seatSize, rowSeatCounts, rowPaths, columnCount, ...blockPatch } = patch;
      const after = {
        ...before,
        sections: before.sections.map((section) => {
          const containsTarget = section.blocks.some((block) => block.id === id);
          const nextSection = {
            ...section,
            blocks: section.blocks.map((block) => {
            if (block.id !== id) return block;
            const nextColumnCount = columnCount === undefined
              ? Math.max(1, Math.round(block.columnCount ?? Math.max(...block.rows.map((row) => row.seats.length), 1)))
              : Math.max(1, Math.round(columnCount));
            const nextSeatGap = blockPatch.defaultSeatGap ?? block.defaultSeatGap;
            const nextRowGap = blockPatch.rowGap ?? block.rowGap;
            const nextSeatSize = seatSize === undefined ? block.rows[0]?.seatSize ?? 0 : Math.max(8, seatSize);
            const currentSeatSize = block.rows[0]?.seatSize ?? nextSeatSize;
            const rowPitchDelta = nextSeatSize + nextRowGap - (currentSeatSize + block.rowGap);
            const currentDistributionMode = block.distributionMode ?? 'FIXED';
            const nextDistributionMode = blockPatch.distributionMode ?? currentDistributionMode;
            const currentFixedRows = fixedRowSeatCounts(block);
            const isSwitchingToProgressive = blockPatch.distributionMode === 'PROGRESSIVE' && currentDistributionMode !== 'PROGRESSIVE';
            const isSwitchingToFixed = blockPatch.distributionMode === 'FIXED' && currentDistributionMode !== 'FIXED';
            const nextFirstRowSeatCount = blockPatch.firstRowSeatCount ?? (
              isSwitchingToProgressive ? currentFixedRows[0] ?? block.columnCount ?? 1 : block.firstRowSeatCount
            );
            const requestedLastRowSeatCount = blockPatch.lastRowSeatCount ?? (
              isSwitchingToProgressive ? currentFixedRows.at(-1) ?? block.columnCount ?? 1 : block.lastRowSeatCount
            );
            const normalizedFirstRowSeatCount = nextFirstRowSeatCount === undefined
              ? undefined
              : Math.min(nextColumnCount, Math.max(0, Math.round(nextFirstRowSeatCount)));
            const normalizedLastRowSeatCount = requestedLastRowSeatCount === undefined
              ? undefined
              : Math.min(nextColumnCount, Math.max(0, Math.round(requestedLastRowSeatCount)));
            const requestedFitMaximum = blockPatch.fitMaximumSeatCount ?? block.fitMaximumSeatCount ?? nextColumnCount;
            const normalizedFitMaximum = Math.min(nextColumnCount, Math.max(0, Math.round(requestedFitMaximum)));
            const requestedFitMinimum = blockPatch.fitMinimumSeatCount ?? block.fitMinimumSeatCount ?? 1;
            const normalizedFitMinimum = Math.min(normalizedFitMaximum, Math.max(0, Math.round(requestedFitMinimum)));
            const progressiveSeatCount = Math.max(
              1,
              Math.round(normalizedFirstRowSeatCount ?? seatCountFromSegments(block.distribution)),
              Math.round(normalizedLastRowSeatCount ?? seatCountFromSegments(block.distribution)),
            );
            const fixedTransitionSeatCount = currentDistributionMode === 'PROGRESSIVE'
              ? Math.max(1, Math.round(normalizedFirstRowSeatCount ?? 0), Math.round(normalizedLastRowSeatCount ?? 0))
              : Math.max(1, ...currentFixedRows);
            const sequentialRowCounts = rowSeatCounts?.map((count) => Math.max(0, Math.round(count))) ?? null;
            const nextRows = sequentialRowCounts
              ? block.rows.slice(0, Math.max(1, sequentialRowCounts.length))
              : [...block.rows];
            while (sequentialRowCounts && nextRows.length < sequentialRowCounts.length) {
              const previousRow = nextRows.at(-1) ?? block.rows.at(-1);
              if (!previousRow) break;
              const rowIndex = nextRows.length;
              nextRows.push({
                ...previousRow,
                id: createLocalId('row'),
                label: getSeatBlockRowLabel(rowIndex, block.rows[0]?.label ?? 'A'),
                path: translateRowPath(previousRow.path, 0, previousRow.seatSize + nextRowGap),
                seatIds: [],
                seats: [],
                distribution: [{ type: 'SEATS', count: sequentialRowCounts[rowIndex] ?? 0 }],
              });
            }
            const nextDistribution = sequentialRowCounts
              ? [{ type: 'SEATS' as const, count: Math.max(0, ...sequentialRowCounts) }]
              : blockPatch.distribution ?? (
              isSwitchingToFixed
                ? [{ type: 'SEATS' as const, count: fixedTransitionSeatCount }]
                : block.distribution
            );
            const distributionSeatCount = seatCountFromSegments(nextDistribution);
            const requestedPathSeatCount = nextDistributionMode === 'PROGRESSIVE'
              ? columnCount === undefined ? progressiveSeatCount : nextColumnCount
              : nextDistributionMode === 'FIT'
                ? nextColumnCount
                : Math.max(1, ...(sequentialRowCounts ?? []), ...block.rows.map((row) => seatCountFromSegments(row.distribution ?? nextDistribution)));
            const availableSeatCapacity = Math.max(nextColumnCount, ...nextRows.map((row) => row.seats.length), ...(sequentialRowCounts ?? []));
            const pathSeatCount = Math.min(requestedPathSeatCount, availableSeatCapacity);
            const requestedMaximum = Math.max(
              nextColumnCount,
              nextRows.reduce((maximum, row) => Math.max(maximum, row.seats.length), 0),
              normalizedFirstRowSeatCount ?? 0,
              normalizedLastRowSeatCount ?? 0,
              normalizedFitMaximum,
              ...(sequentialRowCounts ?? []),
            );
            const shouldReflowSeats = seatSize !== undefined || blockPatch.defaultSeatGap !== undefined ||
              columnCount !== undefined ||
              rowPaths !== undefined ||
              sequentialRowCounts !== null ||
              blockPatch.distribution !== undefined || blockPatch.distributionMode !== undefined ||
              blockPatch.distributionAlignment !== undefined || blockPatch.firstRowSeatCount !== undefined ||
              blockPatch.lastRowSeatCount !== undefined || blockPatch.fitMinimumSeatCount !== undefined ||
              blockPatch.fitMaximumSeatCount !== undefined;
            const firstRequestedPath = rowPaths?.[0] ?? block.rows[0]?.path;
            const baseLinearPath = nextRows.length > 0 && firstRequestedPath?.type === 'LINE' &&
              nextRows.every((row, rowIndex) => (rowPaths?.[rowIndex] ?? row.path).type === 'LINE')
              ? firstRequestedPath
              : null;
            const rows = nextRows.map((row, rowIndex) => {
              const capacityRow = ensureRowSeatCapacity(row, requestedMaximum, rowIndex);
              const layoutRow = shouldReflowSeats ? clearSeatLayoutOverrides(capacityRow) : capacityRow;
              const nextRowDistribution = sequentialRowCounts
                ? [{ type: 'SEATS' as const, count: sequentialRowCounts[rowIndex] ?? 0 }]
                : blockPatch.distributionMode !== undefined
                  ? undefined
                  : row.distribution;
              const rowPathSeatCount = nextDistributionMode === 'FIXED'
                ? sequentialRowCounts?.[rowIndex] ?? (nextRowDistribution
                  ? seatCountFromSegments(nextRowDistribution)
                  : distributionSeatCount)
                : pathSeatCount;
              const sourcePath = rowPaths?.[rowIndex] ?? row.path;
              const rowPath = baseLinearPath && sourcePath.type === 'LINE'
                ? getAlignedLinearRowPath(baseLinearPath, rowIndex, nextSeatSize + nextRowGap)
                : rowPitchDelta === 0 ? sourcePath : translateRowPath(sourcePath, 0, rowIndex * rowPitchDelta);
              return {
                ...layoutRow,
                distribution: nextRowDistribution,
                seatGap: blockPatch.defaultSeatGap === undefined ? row.seatGap : nextSeatGap,
                seatSize: seatSize === undefined ? row.seatSize : Math.max(8, seatSize),
                path: shouldReflowSeats
                  ? resizeRowPath(rowPath, rowPathSeatCount, seatSize === undefined ? row.seatSize : Math.max(8, seatSize), blockPatch.defaultSeatGap === undefined ? row.seatGap : nextSeatGap)
                  : rowPath,
              };
            });
            return {
              ...block,
              ...blockPatch,
              columnCount: nextColumnCount,
              rowIds: rows.map((row) => row.id),
              distribution: nextDistribution,
              firstRowSeatCount: normalizedFirstRowSeatCount,
              lastRowSeatCount: normalizedLastRowSeatCount,
              fitMinimumSeatCount: normalizedFitMinimum,
              fitMaximumSeatCount: normalizedFitMaximum,
              rows,
            };
          }),
          };
          return containsTarget && nextSection.blocks.length > 0 ? { ...nextSection, outline: [] } : nextSection;
        }),
      };
      return runCommand(state, {
        type: 'REPLACE_DOCUMENT',
        payload: { before, after, description: 'Atualizar bloco de fileiras' },
      });
    }),
  updateSeatRow: (id, patch) =>
    set((state) => {
      if (!state.map?.document) return state;
      const before = state.map.document;
      const rowOwner = findMapRowOwner(before, id);
      const rowIndex = rowOwner?.block.rows.findIndex((candidate) => candidate.id === id) ?? -1;
      const rowSeatCount = rowOwner && rowIndex >= 0
        ? resolveSeatCountForRow(rowOwner.block, rowOwner.row, rowIndex, rowOwner.block.rows.length)
        : rowOwner?.row.seats.length ?? 0;
      const after = {
        ...before,
        sections: before.sections.map((section) => {
          const containsTarget = section.blocks.some((block) => block.rows.some((row) => row.id === id));
          const nextSection = {
            ...section,
            blocks: section.blocks.map((block) => ({
            ...block,
            rows: block.rows.map((row) => {
              if (row.id !== id) return row;
              const nextRow = patch.path !== undefined || patch.seatSize !== undefined || patch.seatGap !== undefined
                ? clearSeatLayoutOverrides(row)
                : row;
              const nextSeatSize = patch.seatSize === undefined ? row.seatSize : Math.max(8, patch.seatSize);
              const nextSeatGap = patch.seatGap === undefined ? row.seatGap : Math.max(0, patch.seatGap);
              return {
                ...nextRow,
                ...patch,
                seatGap: nextSeatGap,
                seatSize: nextSeatSize,
                path: patch.path !== undefined
                  ? patch.path
                  : patch.seatSize === undefined && patch.seatGap === undefined
                  ? row.path
                  : resizeRowPath(row.path, rowSeatCount, nextSeatSize, nextSeatGap),
              };
            }),
          })),
          };
          return containsTarget && nextSection.blocks.length > 0 ? { ...nextSection, outline: [] } : nextSection;
        }),
      };
      return runCommand(state, {
        type: 'REPLACE_DOCUMENT',
        payload: { before, after, description: 'Atualizar fileira' },
      });
    }),
  deleteSeatBlock: (id) =>
    set((state) => {
      if (!state.map?.document) return state;
      const before = state.map.document;
      const after = {
        ...before,
        sections: before.sections.flatMap((section) => {
          if (!section.blocks.some((block) => block.id === id)) return [section];
          const blocks = section.blocks.filter((block) => block.id !== id);
          if (blocks.length === 0) return [];
          return [{
            ...section,
            blockIds: section.blockIds.filter((blockId) => blockId !== id),
            blocks,
          }];
        }),
      };
      return {
        ...runCommand(state, {
        type: 'REPLACE_DOCUMENT',
        payload: { before, after, description: 'Excluir bloco de fileiras' },
        }),
        selection: state.selection.some((item) => item.type === 'seatblock' && item.id === id) ? [] : state.selection,
      };
    }),
  updateSeatRowPath: (rowId, path) =>
    set((state) => {
      if (!state.map?.document) return state;
      const before = state.map.document;
      const after = {
        ...before,
        sections: before.sections.map((section) => ({
          ...section,
          blocks: section.blocks.map((block) => ({
            ...block,
            rows: block.rows.map((row) => (row.id === rowId ? { ...clearSeatLayoutOverrides(row), path } : row)),
          })),
        })),
      };
      return runCommand(state, {
        type: 'REPLACE_DOCUMENT',
        payload: { before, after, description: 'Editar geometria da fileira' },
      });
    }),
  transformParametricSelection: (item, matrix) => get().transformParametricSelections([{ item, matrix }]),
  transformParametricSelections: (transforms) =>
    set((state) => {
      const document = state.map?.document;
      if (!document || transforms.length === 0) return state;
      const validTransforms = transforms.filter(({ matrix }) => matrix.every(Number.isFinite) && Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) >= 0.0001);
      if (validTransforms.length === 0) return state;
      const blockTransforms = new Map(validTransforms.flatMap(({ item, matrix }) => item.type === 'seatblock' ? [[item.id, matrix] as const] : []));
      const rowTransforms = new Map(validTransforms.flatMap(({ item, matrix }) => item.type === 'seatrow' ? [[item.id, matrix] as const] : []));
      const transformPoint = (point: { x: number; y: number }, section: (typeof document.sections)[number], matrix: [number, number, number, number, number, number]) => {
        const [a, b, c, d, e, f] = matrix;
        const world = sectionLocalToWorld(point, section.position, section.rotation);
        return worldToSectionLocal({ x: a * world.x + c * world.y + e, y: b * world.x + d * world.y + f }, section.position, section.rotation);
      };
      const transformPath = (path: SeatRowPath, section: (typeof document.sections)[number], matrix: [number, number, number, number, number, number]): SeatRowPath => {
        const scale = Math.max(0.05, Math.hypot(matrix[0], matrix[1]));
        const rotation = Math.atan2(matrix[1], matrix[0]) * (180 / Math.PI);
        switch (path.type) {
          case 'LINE': return { ...path, start: transformPoint(path.start, section, matrix), end: transformPoint(path.end, section, matrix) };
          case 'ARC': return { ...path, center: transformPoint(path.center, section, matrix), radius: Math.max(1, path.radius * scale), startAngle: path.startAngle + rotation * Math.PI / 180, endAngle: path.endAngle + rotation * Math.PI / 180 };
          case 'POLYLINE': return { ...path, points: path.points.map((point) => transformPoint(point, section, matrix)) };
          case 'BEZIER': return { ...path, p0: transformPoint(path.p0, section, matrix), p1: transformPoint(path.p1, section, matrix), p2: transformPoint(path.p2, section, matrix), p3: transformPoint(path.p3, section, matrix) };
        }
      };
      const before = document;
      const after = {
        ...document,
        sections: document.sections.map((section) => ({
          ...section,
          blocks: section.blocks.map((block) => {
            const blockMatrix = blockTransforms.get(block.id);
            const blockTarget = Boolean(blockMatrix);
            const selectedRows = new Set(blockTarget ? [] : block.rows.filter((row) => rowTransforms.has(row.id)).map((row) => row.id));
            if (!blockTarget && selectedRows.size === 0) return block;
            const matrixForRow = (rowId: string) => blockMatrix ?? rowTransforms.get(rowId)!;
            const firstSelectedRow = block.rows.find((row) => selectedRows.has(row.id));
            const baseMatrix = blockMatrix ?? rowTransforms.get(firstSelectedRow!.id)!;
            const scale = Math.max(0.05, Math.hypot(baseMatrix[0], baseMatrix[1]));
            const rotation = Math.atan2(baseMatrix[1], baseMatrix[0]) * (180 / Math.PI);
            return {
              ...block,
              ...(blockTarget ? {
                rowGap: Math.max(0, block.rowGap * scale),
                defaultSeatGap: Math.max(0, block.defaultSeatGap * scale),
                transformRotation: ((block.transformRotation ?? 0) + rotation + 360) % 360,
              } : {}),
              rows: block.rows.map((row) => {
                if (!blockTarget && !selectedRows.has(row.id)) return row;
                const rowMatrix = matrixForRow(row.id);
                const rowScale = Math.max(0.05, Math.hypot(rowMatrix[0], rowMatrix[1]));
                const rowRotation = Math.atan2(rowMatrix[1], rowMatrix[0]) * (180 / Math.PI);
                return {
                  ...row,
                  path: transformPath(row.path, section, rowMatrix),
                  ...(!blockTarget ? { transformRotation: ((row.transformRotation ?? block.transformRotation ?? 0) + rowRotation + 360) % 360 } : {}),
                  seatSize: Math.max(8, row.seatSize * rowScale),
                  seatGap: Math.max(0, row.seatGap * rowScale),
                  seats: row.seats.map((seat) => ({
                    ...seat,
                    ...(seat.position ? { position: transformPoint(seat.position, section, rowMatrix) } : {}),
                    ...(seat.rotation !== undefined ? { rotation: seat.rotation + rowRotation } : {}),
                  })),
                };
              }),
            };
          }),
        })),
      };
      if (after === before) return state;
      const description = validTransforms.length > 1 ? 'Transformar grupos de assentos' : validTransforms[0]!.item.type === 'seatblock' ? 'Transformar bloco de fileiras' : 'Transformar fileira';
      return runCommand(state, { type: 'REPLACE_DOCUMENT', payload: { before, after, description } });
    }),
  updateObject: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { objects: [{ id, patch }] } })),
  updateObjects: (updates) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { objects: updates } })),
  updateMapItems: ({ objects = [], seats = [], skipSeatBaseLayoutTranslation }) =>
    set((state) =>
      runCommand(state, {
        type: 'UPDATE_ITEMS',
        payload: {
          objects,
          seats,
          skipSeatBaseLayoutTranslation,
        },
      }),
    ),
  applyTransform: (command) => set((state) => runCommand(state, command)),
  updateSeat: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { seats: [{ id, patch }] } })),
  updateSection: (id, patch) =>
    set((state) => {
      if (!state.map?.document) return runCommand(state, { type: 'UPDATE_ITEMS', payload: { sections: [{ id, patch }] } });
      const before = state.map.document;
      const after = {
        ...before,
        sections: before.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
      };
      return runCommand(state, {
        type: 'REPLACE_DOCUMENT',
        payload: { before, after, description: 'Atualizar seção' },
      });
    }),
  updateLevel: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { levels: [{ id, patch }] } })),
  addLevel: (name) =>
    set((state) => {
      const levelId = createLocalId('level');
      return runCommand(state, { type: 'ADD_LEVEL', payload: { levelId, name } });
    }),
  toggleObjectVisibility: (id) =>
    set((state) => {
      if (!state.map) return state;
      const target = state.map.objects.find((object) => object.id === id);
      if (!target) return state;
      return runCommand(state, {
        type: 'UPDATE_ITEMS',
        payload: { objects: [{ id, patch: { hidden: !target.hidden } }] },
      });
    }),
  toggleSectionVisibility: (id) =>
    set((state) => {
      if (!state.map) return state;
      const section = state.map.document?.sections.find((entry) => entry.id === id);
      const legacySection = state.map.sections.find((entry) => entry.id === id);
      const linkedObjects = state.map.objects.filter((object) => object.sectionId === id);
      const currentHidden = section?.hidden ?? legacySection?.hidden ?? (linkedObjects.length > 0 && linkedObjects.every((object) => object.hidden));
      const nextHidden = !currentHidden;

      if (state.map.document && section) {
        const before = state.map.document;
        const after = {
          ...before,
          sections: before.sections.map((entry) => entry.id === id ? { ...entry, hidden: nextHidden } : entry),
        };
        const result = runCommand(state, {
          type: 'REPLACE_DOCUMENT',
          payload: { before, after, description: nextHidden ? 'Ocultar camada' : 'Exibir camada' },
        });
        return nextHidden ? { ...result, selection: [] } : result;
      }

      const result = runCommand(state, {
        type: 'UPDATE_ITEMS',
        payload: {
          sections: [{ id, patch: { hidden: nextHidden } }],
          objects: linkedObjects.map((object) => ({ id: object.id, patch: { hidden: nextHidden } })),
        },
      });
      return nextHidden ? { ...result, selection: [] } : result;
    }),
  deleteSection: (id) =>
    set((state) => {
      if (!state.map?.document) return runCommand(state, { type: 'DELETE_SELECTION', payload: { selection: [{ type: 'section', id }] } });
      const before = state.map.document;
      const after = { ...before, sections: before.sections.filter((section) => section.id !== id) };
      return { ...runCommand(state, { type: 'REPLACE_DOCUMENT', payload: { before, after, description: 'Excluir seção' } }), selection: [] };
    }),
  deleteLevel: (id) =>
    set((state) => runCommand(state, { type: 'DELETE_LEVEL', payload: { levelId: id } })),
  deleteSelection: () =>
    set((state) => runCommand(state, { type: 'DELETE_SELECTION', payload: { selection: state.selection } })),
  duplicateSelection: () =>
    set((state) => runCommand(state, { type: 'DUPLICATE_SELECTION', payload: { selection: state.selection } })),
  groupSelection: () =>
    set((state) => runCommand(state, { type: 'GROUP_SELECTION', payload: { selection: state.selection } })),
  ungroupSelection: () =>
    set((state) => runCommand(state, { type: 'UNGROUP_SELECTION', payload: { selection: state.selection } })),
  nudgeSelection: (delta) =>
    set((state) => runCommand(state, { type: 'NUDGE_SELECTION', payload: { delta } })),
  reorderLevelLayers: (levelId, fromIndex, toIndex) =>
    set((state) => {
      if (!state.map) return state;
      const items = sortLevelPanelChildren(state.map.sections, state.map.objects, levelId);
      const reordered = reorderLevelPanelChildItems(items, fromIndex, toIndex);
      const patches = buildLevelLayerSortOrderPatches(state.map, reordered);
      const orderChanged = items.some(
        (item, index) => item.id !== reordered[index]?.id || item.kind !== reordered[index]?.kind,
      );
      if (patches.length === 0 || !orderChanged) return state;
      return runCommand(state, {
        type: 'UPDATE_ITEMS',
        payload: { objects: patches },
      });
    }),
  undo: () =>
    set((state) => {
      const last = state.past.at(-1);
      if (!last || !state.map) return state;

      const res = executeMapCommand(
        state.map,
        last.undo,
        {
          activeLevelId: state.activeLevelId,
          selection: last.undoSelection ?? state.selection,
          runtime: { createId: createLocalId },
        },
      );

      return {
        map: res.map,
        selection: last.undoSelection ?? res.selection ?? state.selection,
        ...(res.activeLevelId ? { activeLevelId: res.activeLevelId } : {}),
        past: state.past.slice(0, -1),
        future: [last, ...state.future].slice(0, 24),
        isDirty: true,
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next || !state.map) return state;

      const res = executeMapCommand(
        state.map,
        next.execute,
        {
          activeLevelId: state.activeLevelId,
          selection: next.executeSelection ?? state.selection,
          runtime: { createId: createLocalId },
        },
      );

      return {
        map: res.map,
        selection: next.executeSelection ?? res.selection ?? state.selection,
        ...(res.activeLevelId ? { activeLevelId: res.activeLevelId } : {}),
        past: [...state.past, next].slice(-24),
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
  patchMapSettings: (patch) =>
    set((state) => {
      if (!state.map) return state;
      return {
        map: {
          ...state.map,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.publicEnabled !== undefined ? { publicEnabled: patch.publicEnabled } : {}),
        },
      };
    }),
  setReferenceChart: (referenceChart) =>
    set((state) => (state.map ? { map: { ...state.map, referenceChart } } : state)),
  setInlineTextEditorActive: (active) => set({ inlineTextEditorActive: active }),
  toPayload: () => {
    const map = get().map;
    if (!map) return null;
    const normalized = cloneAndNormalizeMap(map);
    return {
      name: normalized.name,
      levels: normalized.levels,
      document: normalized.document ?? migrateLegacyMapDocument({
        sections: normalized.sections.map((section) => ({
          id: section.id,
          levelId: section.levelId,
          name: section.name,
          color: section.color,
          lotId: section.lotId,
          capacity: section.capacity,
          status: section.status,
          notes: section.notes,
        })),
        groups: [],
        seats: normalized.seats.map((seat) => ({
          id: seat.id,
          sectionId: seat.sectionId,
          rowIndex: seat.rowIndex,
          columnIndex: seat.columnIndex,
          technicalCode: seat.technicalCode,
          displayLabel: seat.displayLabel,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          accessible: seat.accessible,
          publicVisible: seat.publicVisible,
        })),
        visualElements: normalized.objects,
      }),
      sections: normalized.sections.map(({ lot: _lot, ...section }) => section),
      objects: normalized.objects,
      seats: normalized.seats,
    };
  },
}));
