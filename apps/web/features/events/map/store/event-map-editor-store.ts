'use client';
import { DEFAULT_CORRIDOR_THICKNESS, MAP_AREA_HEIGHT_PX, MAP_AREA_WIDTH_PX, MIN_CORRIDOR_THICKNESS, SEAT_GRID_SECTION_PADDING, applyCorridorReflow, applyCorridorRotationPreservingCenter, buildSeatGridPreview, computeArtboardFitView, executeMapCommand, expandObjectSelectionItems, getNextGroupDisplayName, getNextLevelSortOrder, getObjectGroupId, getObjectGroupLabel, getSeatGridPreviewBounds, getSeatGridRowLabel, getSelectableItems, getTextModeFromCreation, inferCorridorAxisFromSize, isCorridorRotationOnlyTransform, isPlateiaBaseLevel, normalizeMapLevels, normalizeRotation, normalizeSeatGridConfig, normalizeSelection, normalizeTextData, persistCorridorMetadataOnly, reconcileCorridorGeometry, replaceSelection, sanitizeGroupMembership, sanitizeTextObjectData, setObjectGroupData, toggleSelectionItem, translateSeatCorridorBase, translateSectionCorridorBase, updateCorridorSplitAnchorsOnDrag, validateGroupCandidates, withAutoObjectLabel, withDuplicateObjectLabel } from '@alusa/domain';
import type { EventMapDTO, EventMapDraftPayload, EventMapLevelDTO, EventMapObjectDTO, EventMapSectionDTO, EventSeatDTO, EventSeatGroupDTO, MapCommand, MapSelection, MapSelectionItem, MapTool, SeatGridConfig } from '@alusa/domain';

import { create } from 'zustand';

export type { MapSelection, MapSelectionItem, MapTool };

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
  updateSeatGroup: (id: string, patch: Partial<EventSeatGroupDTO>) => void;
  deleteSeatGroup: (id: string) => void;
  updateObject: (id: string, patch: Partial<EventMapObjectDTO>) => void;
  updateObjects: (updates: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>) => void;
  updateMapItems: (updates: {
    objects?: Array<{ id: string; patch: Partial<EventMapObjectDTO> }>;
    seats?: Array<{ id: string; patch: Partial<EventSeatDTO> }>;
    seatGroups?: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }>;
    skipSeatBaseLayoutTranslation?: boolean;
    skipCorridorReflow?: boolean;
  }) => void;
  applyTransform: (
    command: Extract<
      MapCommand,
      {
        type:
          | 'TRANSFORM_CORRIDOR'
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

function mapHasCorridors(map: EventMapDTO) {
  return map.objects.some((object) => object.type === 'CORRIDOR');
}

function cloneNormalizeAndReflowMap(map: EventMapDTO): EventMapDTO {
  const next = cloneAndNormalizeMap(map);

  if (mapHasCorridors(next)) {
    applyCorridorReflow(next);
    updateCounts(next);
  }

  return next;
}

function buildRedoUpdateItems(
  map: EventMapDTO,
  nextMap: EventMapDTO,
): MapCommand {
  const objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seats: Array<{ id: string; patch: Partial<EventSeatDTO> }> = [];
  const seatGroups: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }> = [];
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
    for (const key of ['x', 'y', 'size', 'rotation', 'status', 'accessible', 'publicVisible', 'technicalCode', 'displayLabel', 'rowLabel', 'seatNumber', 'objectId', 'groupId'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = next[key];
        changed = true;
      }
    }
    if (changed) {
      seats.push({ id: next.id, patch });
    }
  }

  for (const next of nextMap.seatGroups ?? []) {
    const prev = (map.seatGroups ?? []).find((g) => g.id === next.id);
    if (!prev) continue;
    const patch: Partial<EventSeatGroupDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'rotation', 'rows', 'columns', 'seatWidth', 'seatHeight', 'gapX', 'gapY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'locked', 'name'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = next[key];
        changed = true;
      }
    }
    if (JSON.stringify(prev.numbering) !== JSON.stringify(next.numbering)) {
      patch.numbering = next.numbering;
      changed = true;
    }
    if (changed) {
      seatGroups.push({ id: next.id, patch });
    }
  }

  for (const next of nextMap.sections) {
    const prev = map.sections.find((s) => s.id === next.id);
    if (!prev) continue;
    const patch: Partial<EventMapSectionDTO> = {};
    let changed = false;
    for (const key of ['name', 'color', 'capacity', 'status', 'notes', 'lotId'] as const) {
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
      seatGroups,
      sections,
      levels,
      skipCorridorReflow: true,
      skipSeatBaseLayoutTranslation: true,
    },
  };
}

function buildRedoCommand(
  command: MapCommand,
  map: EventMapDTO,
  nextMap: EventMapDTO,
): MapCommand {
  const createdObjects = nextMap.objects.filter((no) => !map.objects.some((o) => o.id === no.id));
  const createdSeats = nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id));
  const createdSections = nextMap.sections.filter((ns) => !map.sections.some((s) => s.id === ns.id));
  const createdLevels = nextMap.levels.filter((nl) => !map.levels.some((l) => l.id === nl.id));
  const createdSeatGroups = (nextMap.seatGroups ?? []).filter((ng) => !(map.seatGroups ?? []).some((g) => g.id === ng.id));

  if (
    createdObjects.length > 0 ||
    createdSeats.length > 0 ||
    createdSections.length > 0 ||
    createdLevels.length > 0 ||
    createdSeatGroups.length > 0
  ) {
    return {
      type: 'RESTORE_DELETED_ITEMS',
      payload: {
        objects: createdObjects,
        seats: createdSeats,
        sections: createdSections,
        levels: createdLevels,
        seatGroups: createdSeatGroups,
      },
    };
  }

  if (
    command.type === 'DELETE_SELECTION' ||
    command.type === 'DELETE_LEVEL' ||
    command.type === 'DELETE_SEAT_GROUP'
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

function hasCorridorGeometryPatch(patch: Partial<EventMapObjectDTO>) {
  return (
    typeof patch.x === 'number' ||
    typeof patch.y === 'number' ||
    typeof patch.width === 'number' ||
    typeof patch.height === 'number' ||
    typeof patch.rotation === 'number'
  );
}

function corridorReflowOptionsForPatch(
  object: EventMapObjectDTO | undefined,
  patch: Partial<EventMapObjectDTO>,
) {
  if (object?.type !== 'CORRIDOR') return undefined;

  if (isCorridorRotationOnlyTransform(patch, object)) {
    return { freezeAutoFitCorridorIds: [object.id] };
  }

  const sizeChanged =
    (typeof patch.width === 'number' && object.width != null && Math.abs(patch.width - object.width) > 0.001) ||
    (typeof patch.height === 'number' && object.height != null && Math.abs(patch.height - object.height) > 0.001);

  if (sizeChanged) {
    return { freezeAutoFitCorridorIds: [object.id] };
  }

  return undefined;
}

function hasCorridorMetadataPatch(patch: Partial<EventMapObjectDTO>) {
  if (!patch.data) return false;
  return (
    'seatGapTop' in patch.data ||
    'seatGapRight' in patch.data ||
    'seatGapBottom' in patch.data ||
    'seatGapLeft' in patch.data
  );
}

function applyObjectPatchWithCorridorMetadata(
  object: EventMapObjectDTO,
  patch: Partial<EventMapObjectDTO>,
): EventMapObjectDTO {
  const previous: EventMapObjectDTO = {
    ...object,
    data: { ...object.data },
  };

  const next: EventMapObjectDTO = patch.data
    ? {
        ...object,
        ...patch,
        data: { ...object.data, ...patch.data },
      }
    : {
        ...object,
        ...patch,
      };

  if (next.type === 'CORRIDOR' && hasCorridorGeometryPatch(patch)) {
    if (isCorridorRotationOnlyTransform(patch, previous) && typeof patch.rotation === 'number') {
      applyCorridorRotationPreservingCenter(next, patch.rotation, previous, { snap: false });
    } else {
      if (typeof patch.rotation === 'number') {
        next.rotation = normalizeRotation(patch.rotation);
      }
      reconcileCorridorGeometry(next);
    }
    updateCorridorSplitAnchorsOnDrag(next, patch, previous);
    return next;
  }

  if (next.type === 'CORRIDOR' && hasCorridorMetadataPatch(patch)) {
    persistCorridorMetadataOnly(next);
    return next;
  }

  return next;
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
    const normalized = cloneNormalizeAndReflowMap(map);
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
    const id = createLocalId(tool === 'section' ? 'section' : tool === 'seat' ? 'seat' : 'object');
    let createdId: string | null = null;
    set((state) => {
      if (!state.map) return state;
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
    set((state) => runCommand(state, { type: 'ADD_ROW', payload: { point, quantity } })),
  addSeatGridAt: (point, config) =>
    set((state) => runCommand(state, { type: 'ADD_SEAT_GRID', payload: { point, config } })),
  updateSeatGroup: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_SEAT_GROUP', payload: { id, patch } })),
  deleteSeatGroup: (id) =>
    set((state) => runCommand(state, { type: 'DELETE_SEAT_GROUP', payload: { id } })),
  updateObject: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { objects: [{ id, patch }] } })),
  updateObjects: (updates) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { objects: updates } })),
  updateMapItems: ({ objects = [], seats = [], seatGroups = [], skipSeatBaseLayoutTranslation, skipCorridorReflow }) =>
    set((state) =>
      runCommand(state, {
        type: 'UPDATE_ITEMS',
        payload: {
          objects,
          seats,
          seatGroups,
          skipSeatBaseLayoutTranslation,
          skipCorridorReflow,
        },
      }),
    ),
  applyTransform: (command) => set((state) => runCommand(state, command)),
  updateSeat: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { seats: [{ id, patch }] } })),
  updateSection: (id, patch) =>
    set((state) => runCommand(state, { type: 'UPDATE_ITEMS', payload: { sections: [{ id, patch }] } })),
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
      const linked = state.map.objects.find((object) => object.sectionId === id);
      const nextHidden = linked ? !linked.hidden : true;
      const associatedSeats = state.map.seats
        .filter((seat) => seat.sectionId === id)
        .map((seat) => ({ id: seat.id, patch: { publicVisible: !nextHidden } }));
      const associatedObjects = state.map.objects
        .filter((object) => object.sectionId === id)
        .map((object) => ({ id: object.id, patch: { hidden: nextHidden } }));
      return runCommand(state, {
        type: 'UPDATE_ITEMS',
        payload: { objects: associatedObjects, seats: associatedSeats },
      });
    }),
  deleteSection: (id) =>
    set((state) => runCommand(state, { type: 'DELETE_SELECTION', payload: { selection: [{ type: 'section', id }] } })),
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
      const nextMap = map ? cloneNormalizeAndReflowMap(map) : state.map;
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
    const normalized = cloneNormalizeAndReflowMap(map);
    return {
      name: normalized.name,
      levels: normalized.levels,
      sections: normalized.sections.map(({ lot: _lot, ...section }) => section),
      objects: normalized.objects,
      seatGroups: normalized.seatGroups ?? [],
      seats: normalized.seats,
    };
  },
}));
