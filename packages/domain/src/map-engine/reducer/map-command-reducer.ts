import type {
  EventMapDTO,
  EventMapLevelDTO,
  EventMapObjectDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
  EventMapSectionDTO,
} from '../types/event-map-types.js';
import type { MapCommand } from '../commands/command-types.js';
import type { MapEngineRuntime } from '../ports/runtime-ports.js';
import type { MapSelection, MapSelectionItem } from '../selection/selection-utils.js';
import type { MapTool } from '../types/event-map-types.js';
import {
  getNextLevelSortOrder,
  isPlateiaBaseLevel,
  MAP_AREA_HEIGHT_PX,
  MAP_AREA_WIDTH_PX,
  normalizeMapLevels,
} from '../geometry/level-utils.js';
import { withAutoObjectLabel, withDuplicateObjectLabel } from '../layout/object-naming.js';
import {
  buildSeatGridPreview,
  getSeatGridPreviewBounds,
  normalizeSeatGridConfig,
  SEAT_GRID_SECTION_PADDING,
  getSeatGridRowLabel,
} from '../layout/seat-grid.js';
import { getTextModeFromCreation, normalizeTextData } from '../doc/text-object.js';
import {
  expandObjectSelectionItems,
  getNextGroupDisplayName,
  getObjectGroupId,
  getObjectGroupLabel,
  sanitizeGroupMembership,
  setObjectGroupData,
  validateGroupCandidates,
} from '../layout/object-groups.js';
import {
  applyCorridorReflow,
  translateSeatCorridorBase,
  translateSectionCorridorBase,
  inferCorridorAxisFromSize,
  updateCorridorSplitAnchorsOnDrag,
  persistCorridorMetadataOnly,
} from '../layout/corridor-reflow.js';
import {
  applyCorridorRotationPreservingCenter,
  isCorridorRotationOnlyTransform,
  snapSmartCorridorRotation,
  DEFAULT_CORRIDOR_THICKNESS,
  MIN_CORRIDOR_THICKNESS,
  reconcileCorridorGeometry,
} from '../layout/smart-corridor-layout.js';
import { getSelectableItems, replaceSelection } from '../selection/selection-utils.js';

const DEFAULT_COLORS = ['#6d28d9', '#0f766e', '#2563eb', '#db2777', '#ea580c', '#16a34a'];

function cloneMap(map: EventMapDTO): EventMapDTO {
  return JSON.parse(JSON.stringify(map)) as EventMapDTO;
}

let fallbackIdSequence = 0;

function createLocalId(prefix: string, runtime?: MapEngineRuntime) {
  if (runtime?.createId) return runtime.createId(prefix);
  fallbackIdSequence += 1;
  return `${prefix}_${fallbackIdSequence}`;
}

function getActiveLevel(map: EventMapDTO | null, activeLevelId: string | null) {
  if (!map) return null;
  return map.levels.find((level) => level.id === activeLevelId) ?? map.levels[0] ?? null;
}

function createDefaultSection(
  map: EventMapDTO,
  levelId: string,
  point: { x: number; y: number },
  size?: { width: number; height: number },
  runtime?: MapEngineRuntime,
) {
  const color = DEFAULT_COLORS[map.sections.length % DEFAULT_COLORS.length];
  const sectionId = createLocalId('section', runtime);
  const objectId = createLocalId('object', runtime);
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

function ensureSection(map: EventMapDTO, levelId: string, point: { x: number; y: number }, runtime?: MapEngineRuntime) {
  return map.sections.find((section) => section.levelId === levelId) ?? createDefaultSection(map, levelId, point, undefined, runtime);
}

function updateCounts(map: EventMapDTO) {
  map.counts = {
    levels: map.levels.length,
    sections: map.sections.length,
    seats: map.seats.length,
    availableSeats: map.seats.filter((seat) => seat.status === 'AVAILABLE' && seat.publicVisible).length,
  };
}

function applyMapLevels(map: EventMapDTO) {
  map.levels = normalizeMapLevels(map.levels);
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
      applyCorridorRotationPreservingCenter(next, patch.rotation, previous);
    } else {
      if (typeof patch.rotation === 'number') {
        next.rotation = snapSmartCorridorRotation(patch.rotation);
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

export type CommandResult = {
  map: EventMapDTO;
  document: EventMapDTO;
  selection?: MapSelection;
  createdId?: string | null;
  activeLevelId?: string | null;
  undoCommand?: MapCommand | null;
  patches: MapCommand[];
  inversePatches: MapCommand[];
  warnings: string[];
};

export type ExecuteMapCommandContext = {
  activeLevelId?: string | null;
  selection?: MapSelection;
  runtime?: MapEngineRuntime;
};

function commandResult(input: {
  map: EventMapDTO;
  selection: MapSelection;
  createdId?: string | null;
  activeLevelId?: string | null;
  undoCommand?: MapCommand | null;
  patches?: MapCommand[];
  warnings?: string[];
}): CommandResult {
  const undoCommand = input.undoCommand ?? null;
  return {
    map: input.map,
    document: input.map,
    selection: input.selection,
    createdId: input.createdId ?? null,
    activeLevelId: input.activeLevelId ?? null,
    undoCommand,
    patches: input.patches ?? [],
    inversePatches: undoCommand ? [undoCommand] : [],
    warnings: input.warnings ?? [],
  };
}

function normalizeMapCommand(command: MapCommand, map: EventMapDTO): MapCommand {
  switch (command.type) {
    case 'UPDATE_OBJECT':
      return {
        type: 'UPDATE_ITEMS',
        payload: { objects: [{ id: command.payload.id, patch: command.payload.patch }] },
      };

    case 'MOVE_OBJECTS': {
      const { delta, objectIds = [], seatIds = [] } = command.payload;
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: objectIds
            .map((id) => {
              const object = map.objects.find((entry) => entry.id === id);
              return object ? { id, patch: { x: object.x + delta.x, y: object.y + delta.y } } : null;
            })
            .filter((entry): entry is { id: string; patch: { x: number; y: number } } => entry !== null),
          seats: seatIds
            .map((id) => {
              const seat = map.seats.find((entry) => entry.id === id);
              return seat ? { id, patch: { x: seat.x + delta.x, y: seat.y + delta.y } } : null;
            })
            .filter((entry): entry is { id: string; patch: { x: number; y: number } } => entry !== null),
        },
      };
    }

    case 'RESIZE_OBJECTS':
      return {
        type: 'UPDATE_ITEMS',
        payload: { objects: command.payload.objects },
      };

    case 'ROTATE_OBJECTS':
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: command.payload.objects,
          seats: command.payload.seats,
        },
      };

    case 'GROUP_OBJECTS':
      return { type: 'GROUP_SELECTION', payload: command.payload };

    case 'UNGROUP_OBJECTS':
      return { type: 'UNGROUP_SELECTION', payload: command.payload };

    case 'UPDATE_TEXT':
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: [
            {
              id: command.payload.id,
              patch: {
                data: normalizeTextData({
                  ...command.payload.data,
                  text: command.payload.text,
                  label: command.payload.text,
                }),
              },
            },
          ],
        },
      };

    case 'UPDATE_LEVEL':
      return {
        type: 'UPDATE_ITEMS',
        payload: { levels: [{ id: command.payload.id, patch: command.payload.patch }] },
      };

    case 'TRANSFORM_CORRIDOR':
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: command.payload.objects,
          seats: command.payload.seats,
          skipSeatBaseLayoutTranslation: command.payload.skipSeatBaseLayoutTranslation,
          skipCorridorReflow: command.payload.skipCorridorReflow,
        },
      };

    default:
      return command;
  }
}

export function executeMapCommand(
  map: EventMapDTO,
  command: MapCommand,
  context: ExecuteMapCommandContext,
): CommandResult;
export function executeMapCommand(
  map: EventMapDTO,
  command: MapCommand,
  activeLevelId: string | null,
  selection: MapSelection,
  runtime?: MapEngineRuntime,
): CommandResult;
export function executeMapCommand(
  map: EventMapDTO,
  command: MapCommand,
  contextOrActiveLevelId: ExecuteMapCommandContext | string | null,
  selectionArg: MapSelection = [],
  runtimeArg?: MapEngineRuntime,
): CommandResult {
  const context =
    typeof contextOrActiveLevelId === 'object' && contextOrActiveLevelId !== null
      ? contextOrActiveLevelId
      : {
          activeLevelId: contextOrActiveLevelId,
          selection: selectionArg,
          runtime: runtimeArg,
        };
  const activeLevelId = context.activeLevelId ?? null;
  const selection = context.selection ?? [];
  const runtime = context.runtime;
  const normalizedCommand = normalizeMapCommand(command, map);
  const nextMap = cloneMap(map);
  let nextSelection = [...selection];
  let createdId: string | null = null;
  let nextActiveLevelId = activeLevelId;
  let undoCommand: MapCommand | null = null;

  switch (normalizedCommand.type) {
    case 'ADD_OBJECT': {
      const { id, tool, point, size } = normalizedCommand.payload;
      const level = getActiveLevel(nextMap, activeLevelId);
      if (!level) break;

      if (tool === 'section') {
        const section = createDefaultSection(
          nextMap,
          level.id,
          point,
          size?.width && size?.height ? { width: size.width, height: size.height } : undefined,
          runtime,
        );
        createdId = section.id;
        updateCounts(nextMap);
        nextSelection = replaceSelection({ type: 'section', id: section.id });
        break;
      }

      if (tool === 'seat') {
        const section = ensureSection(nextMap, level.id, point, runtime);
        const seatNumber = String(nextMap.seats.filter((seat) => seat.sectionId === section.id).length + 1);
        const seat: EventSeatDTO = {
          id,
          levelId: level.id,
          sectionId: section.id,
          objectId: null,
          groupId: null,
          rowIndex: null,
          columnIndex: null,
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
        nextMap.seats.push(seat);
        createdId = seat.id;
        updateCounts(nextMap);
        nextSelection = replaceSelection({ type: 'seat', id: seat.id });
        break;
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
          data: {
            fill: '#f8fafc',
            smartCorridor: true,
            seatGapTop: 8,
            seatGapRight: 8,
            seatGapBottom: 8,
            seatGapLeft: 8,
            corridorThickness: 32,
          },
        },
        booth: { type: 'BOOTH' as const, width: 180, height: 120, data: { fill: '#fff7ed' } },
        general: { type: 'GENERAL_AREA' as const, width: 280, height: 160, data: { fill: '#ecfeff' } },
        'shape-square': { type: 'GENERAL_AREA' as const, width: 130, height: 130, data: { fill: '#ffffff', shape: 'square' } },
        'shape-circle': { type: 'GENERAL_AREA' as const, width: 130, height: 130, data: { fill: '#ffffff', shape: 'circle' } },
        'shape-ellipse': { type: 'GENERAL_AREA' as const, width: 180, height: 110, data: { fill: '#ffffff', shape: 'ellipse' } },
        'shape-triangle': { type: 'GENERAL_AREA' as const, width: 150, height: 130, data: { fill: '#ffffff', shape: 'triangle' } },
      };
      const config = configByTool[tool];
      if (!config) break;

      const textMode = config.type === 'TEXT' ? getTextModeFromCreation(size?.width ?? null, size?.height ?? null) : undefined;
      const objectWidth = config.type === 'TEXT' && !size?.width ? null : size?.width ?? config.width;
      const objectHeight = config.type === 'TEXT' && !size?.height ? null : size?.height ?? config.height;
      const objectData: Record<string, unknown> =
        config.type === 'TEXT'
          ? normalizeTextData({
              ...withAutoObjectLabel(config.data, tool, nextMap.objects),
              textMode,
            })
          : withAutoObjectLabel(config.data, tool, nextMap.objects);

      if (config.type === 'CORRIDOR') {
        const width = typeof objectWidth === 'number' ? objectWidth : config.width;
        const height = typeof objectHeight === 'number' ? objectHeight : config.height;
        const axis = inferCorridorAxisFromSize(width, height);
        const rawThickness = axis === 'vertical' ? width : height;
        objectData.smartCorridor = true;
        objectData.seatGapTop = 8;
        objectData.seatGapRight = 8;
        objectData.seatGapBottom = 8;
        objectData.seatGapLeft = 8;
        objectData.corridorThickness =
          rawThickness >= MIN_CORRIDOR_THICKNESS
            ? Math.min(rawThickness, 240)
            : DEFAULT_CORRIDOR_THICKNESS;
        objectData.corridorAxis = axis;
        objectData.corridorAutoFit = true;
      }

      const object: EventMapObjectDTO = {
        id,
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
        sortOrder: nextMap.objects.length,
      };
      nextMap.objects.push(object);
      createdId = object.id;
      if (object.type === 'CORRIDOR') applyCorridorReflow(nextMap);
      updateCounts(nextMap);
      nextSelection = replaceSelection({ type: 'object', id: object.id });
      break;
    }

    case 'DELETE_SELECTION': {
      const items = expandObjectSelectionItems(getSelectableItems(normalizedCommand.payload.selection), nextMap.objects);
      if (items.length === 0) break;

      for (const item of items) {
        if (item.type === 'seat') {
          const seat = nextMap.seats.find((entry) => entry.id === item.id);
          if (seat?.status === 'SOLD') break;
          nextMap.seats = nextMap.seats.filter((entry) => entry.id !== item.id);
        }

        if (item.type === 'object') {
          nextMap.objects = nextMap.objects.filter((entry) => entry.id !== item.id);
          applyCorridorReflow(nextMap);
        }

        if (item.type === 'section') {
          const hasSoldSeat = nextMap.seats.some((seat) => seat.sectionId === item.id && seat.status === 'SOLD');
          if (hasSoldSeat) break;
          nextMap.seats = nextMap.seats.filter((seat) => seat.sectionId !== item.id);
          nextMap.objects = nextMap.objects.filter((object) => object.sectionId !== item.id);
          nextMap.sections = nextMap.sections.filter((section) => section.id !== item.id);
        }

        if (item.type === 'seatgroup') {
          const removedSeatSectionIds = new Set(
            nextMap.seats
              .filter((s) => s.groupId === item.id)
              .map((s) => s.sectionId)
              .filter((sid): sid is string => !!sid),
          );
          nextMap.seatGroups = (nextMap.seatGroups ?? []).filter((g) => g.id !== item.id);
          nextMap.seats = nextMap.seats.filter((s) => s.groupId !== item.id);
          for (const sectionId of removedSeatSectionIds) {
            if (!nextMap.seats.some((s) => s.sectionId === sectionId)) {
              nextMap.objects = nextMap.objects.filter((o) => !o.sectionId || o.sectionId !== sectionId);
              nextMap.sections = nextMap.sections.filter((s) => s.id !== sectionId);
            }
          }
        }
      }

      const usedGroupIds = new Set(nextMap.seats.map((s) => s.groupId).filter((gid): gid is string => !!gid));
      nextMap.seatGroups = (nextMap.seatGroups ?? []).filter((g) => usedGroupIds.has(g.id));
      nextMap.objects = sanitizeGroupMembership(nextMap.objects);
      updateCounts(nextMap);
      nextSelection = [];
      break;
    }

    case 'UPDATE_ITEMS': {
      const {
        objects = [],
        seats = [],
        sections = [],
        levels = [],
        skipSeatBaseLayoutTranslation = false,
        skipCorridorReflow = false,
      } = normalizedCommand.payload;

      if (objects.length === 0 && seats.length === 0 && sections.length === 0 && levels.length === 0) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }

      const objectPatchById = new Map(objects.map((entry) => [entry.id, entry.patch]));
      const seatPatchById = new Map(seats.map((entry) => [entry.id, entry.patch]));
      const sectionPatchById = new Map(sections.map((entry) => [entry.id, entry.patch]));
      const levelPatchById = new Map(levels.map((entry) => [entry.id, entry.patch]));

      const sectionDeltaById = new Map<string, { x: number; y: number }>();

      if (objectPatchById.size > 0) {
        if (!skipSeatBaseLayoutTranslation) {
          for (const object of nextMap.objects) {
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
        }

        nextMap.objects = nextMap.objects.map((object) => {
          const patch = objectPatchById.get(object.id);
          if (!patch) return object;
          return applyObjectPatchWithCorridorMetadata(object, patch);
        });

        if (!skipSeatBaseLayoutTranslation) {
          for (const [sectionId, delta] of sectionDeltaById) {
            translateSectionCorridorBase(nextMap, sectionId, delta);
          }
        }
      }

      if (seatPatchById.size > 0) {
        if (!skipSeatBaseLayoutTranslation) {
          const seatBaseDeltas: Array<{ seatId: string; sectionId: string; delta: { x: number; y: number } }> = [];
          for (const seat of nextMap.seats) {
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
          translateSeatCorridorBase(nextMap, seatBaseDeltas);
        }

        nextMap.seats = nextMap.seats.map((seat) => {
          const patch = seatPatchById.get(seat.id);
          return patch ? { ...seat, ...patch } : seat;
        });
        updateCounts(nextMap);
      }

      if (sectionPatchById.size > 0) {
        nextMap.sections = nextMap.sections.map((section) => {
          const patch = sectionPatchById.get(section.id);
          if (!patch) return section;
          const nextSec = { ...section, ...patch };
          if (patch.name || patch.color) {
            nextMap.objects = nextMap.objects.map((object) =>
              object.sectionId === section.id
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
          return nextSec;
        });
      }

      if (levelPatchById.size > 0) {
        nextMap.levels = nextMap.levels.map((level) => {
          const patch = levelPatchById.get(level.id);
          if (!patch) return level;
          const { widthPx: _widthPx, heightPx: _heightPx, unit: _unit, sortOrder: _sortOrder, ...allowedPatch } = patch;
          return {
            ...level,
            ...allowedPatch,
            widthPx: MAP_AREA_WIDTH_PX,
            heightPx: MAP_AREA_HEIGHT_PX,
            unit: 'px',
          };
        });
        applyMapLevels(nextMap);
      }

      if (!skipCorridorReflow) {
        applyCorridorReflow(nextMap);
      }
      break;
    }

    case 'ADD_LEVEL': {
      const { levelId, name } = normalizedCommand.payload;
      const levelCount = normalizeMapLevels(nextMap.levels).length;
      const level: EventMapLevelDTO = {
        id: levelId,
        name: name?.trim() || `Ambiente ${levelCount + 1}`,
        sortOrder: getNextLevelSortOrder(nextMap.levels),
        widthPx: MAP_AREA_WIDTH_PX,
        heightPx: MAP_AREA_HEIGHT_PX,
        unit: 'px',
        scale: null,
      };
      nextMap.levels.push(level);
      applyMapLevels(nextMap);
      nextActiveLevelId = level.id;
      nextSelection = replaceSelection({ type: 'level', id: level.id });
      break;
    }

    case 'DELETE_LEVEL': {
      const { levelId } = normalizedCommand.payload;
      const level = nextMap.levels.find((entry) => entry.id === levelId);
      if (!level || isPlateiaBaseLevel(level)) break;

      nextMap.seats = nextMap.seats.filter((seat) => seat.levelId !== levelId);
      nextMap.objects = nextMap.objects.filter((object) => object.levelId !== levelId);
      nextMap.sections = nextMap.sections.filter((section) => section.levelId !== levelId);
      nextMap.seatGroups = (nextMap.seatGroups ?? []).filter((g) => g.levelId !== levelId);
      nextMap.levels = nextMap.levels.filter((entry) => entry.id !== levelId);
      applyMapLevels(nextMap);
      updateCounts(nextMap);
      nextActiveLevelId = activeLevelId === levelId ? getDefaultActiveLevelId(nextMap.levels) : activeLevelId;
      nextSelection = nextSelection.filter((item) => !(item.type === 'level' && item.id === levelId));
      break;
    }

    case 'ADD_ROW': {
      const { point, quantity } = normalizedCommand.payload;
      const level = getActiveLevel(nextMap, activeLevelId);
      if (!level) break;

      const section = ensureSection(nextMap, level.id, point, runtime);
      const rowIndex = new Set(nextMap.seats.map((seat) => seat.rowLabel).filter(Boolean)).size;
      const rowLabel = String.fromCharCode(65 + Math.min(rowIndex, 25));
      const spacing = 34;
      const startX = point.x;
      const startY = point.y;

      for (let index = 0; index < quantity; index += 1) {
        const number = String(index + 1);
        nextMap.seats.push({
          id: createLocalId('seat', runtime),
          levelId: level.id,
          sectionId: section.id,
          objectId: null,
          groupId: null,
          rowIndex: null,
          columnIndex: null,
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

      updateCounts(nextMap);
      nextSelection = replaceSelection({ type: 'section', id: section.id });
      break;
    }

    case 'ADD_SEAT_GRID': {
      const { point, config } = normalizedCommand.payload;
      const level = getActiveLevel(nextMap, activeLevelId);
      if (!level) break;

      const seats = buildSeatGridPreview(point, config);
      if (seats.length === 0) break;
      const sectionBounds = getSeatGridPreviewBounds(seats, SEAT_GRID_SECTION_PADDING);
      if (!sectionBounds) break;

      const color = DEFAULT_COLORS[nextMap.sections.length % DEFAULT_COLORS.length];
      const sectionId = createLocalId('section', runtime);
      const objectId = createLocalId('object', runtime);
      const groupId = createLocalId('seatgroup', runtime);
      const sectionName = `Setor ${nextMap.sections.length + 1}`;
      const sectionCode = sectionName.replace(/\s+/g, '-').toUpperCase();
      const normalized = normalizeSeatGridConfig(config);
      const gapX = Math.max(0, normalized.horizontalSpacing - normalized.seatSize);
      const gapY = Math.max(0, normalized.verticalSpacing - normalized.seatSize);

      nextMap.sections.push({
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

      nextMap.objects.push({
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
        sortOrder: nextMap.objects.length,
      });

      nextMap.seatGroups = nextMap.seatGroups ?? [];
      const seatGroup: EventSeatGroupDTO = {
        id: groupId,
        levelId: level.id,
        name: sectionName,
        x: point.x - normalized.seatSize / 2,
        y: point.y - normalized.seatSize / 2,
        rotation: 0,
        rows: normalized.rows,
        columns: normalized.columns,
        seatWidth: normalized.seatSize,
        seatHeight: normalized.seatSize,
        gapX,
        gapY,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        numbering: {
          format: 'number',
          rowPrefix: normalized.rowPrefix,
          startNumber: normalized.startNumber,
          direction: normalized.numberingDirection,
        },
        locked: false,
      };
      nextMap.seatGroups.push(seatGroup);

      for (const draft of seats) {
        const id = createLocalId('seat', runtime);
        nextMap.seats.push({
          id,
          levelId: level.id,
          sectionId,
          objectId: null,
          groupId,
          rowIndex: draft.rowIndex,
          columnIndex: draft.columnIndex,
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

      applyCorridorReflow(nextMap);
      updateCounts(nextMap);
      nextSelection = replaceSelection({ type: 'section', id: sectionId });
      break;
    }

    case 'DUPLICATE_SELECTION': {
      const items = getSelectableItems(normalizedCommand.payload.selection);
      if (items.length === 0) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }

      const created: MapSelectionItem[] = [];
      const groupIdMap = new Map<string, string>();
      const groupLabelMap = new Map<string, string>();

      for (const item of items) {
        if (item.type === 'object') {
          const object = nextMap.objects.find((entry) => entry.id === item.id);
          if (!object || object.locked) continue;
          if (object.sectionId && object.type === 'SECTION') continue;
          const oldGroupId = getObjectGroupId(object);
          let nextGroupId: string | null = null;
          let nextGroupLabel: string | null = null;
          if (oldGroupId) {
            if (!groupIdMap.has(oldGroupId)) {
              groupIdMap.set(oldGroupId, createLocalId('group', runtime));
              groupLabelMap.set(
                oldGroupId,
                getNextGroupDisplayName(nextMap.objects, getObjectGroupLabel(object)),
              );
            }
            nextGroupId = groupIdMap.get(oldGroupId) ?? null;
            nextGroupLabel = groupLabelMap.get(oldGroupId) ?? null;
          }
          const copy: EventMapObjectDTO = {
            ...object,
            id: createLocalId('object', runtime),
            x: object.x + 28,
            y: object.y + 28,
            sortOrder: nextMap.objects.length,
            data: setObjectGroupData(withDuplicateObjectLabel(object, nextMap.objects), nextGroupId, nextGroupLabel),
          };
          nextMap.objects.push(copy);
          created.push({ type: 'object', id: copy.id });
        }

        if (item.type === 'seat') {
          const seat = nextMap.seats.find((entry) => entry.id === item.id);
          if (!seat) continue;
          const copy = {
            ...seat,
            id: createLocalId('seat', runtime),
            technicalCode: `${seat.technicalCode}-C`,
            displayLabel: `${seat.displayLabel}C`,
            x: seat.x + 34,
            y: seat.y,
            status: 'AVAILABLE' as const,
          };
          nextMap.seats.push(copy);
          created.push({ type: 'seat', id: copy.id });
        }
      }

      if (created.length === 0) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }
      if (created.some((item) => {
        if (item.type !== 'object') return false;
        return nextMap.objects.some((object) => object.id === item.id && object.type === 'CORRIDOR');
      })) {
        applyCorridorReflow(nextMap);
      }
      updateCounts(nextMap);
      nextSelection = created;
      break;
    }

    case 'GROUP_SELECTION': {
      const validation = validateGroupCandidates(getSelectableItems(normalizedCommand.payload.selection), nextMap.objects);
      if (!validation.ok) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }

      const candidates = validation.candidates;
      const groupId = createLocalId('group', runtime);
      const groupLabel = getNextGroupDisplayName(nextMap.objects);
      const memberIds = new Set(candidates.map((object) => object.id));

      nextMap.objects = nextMap.objects.map((object) =>
        memberIds.has(object.id)
          ? { ...object, data: setObjectGroupData(object.data, groupId, groupLabel) }
          : object,
      );
      nextMap.objects = sanitizeGroupMembership(nextMap.objects);
      nextSelection = candidates.map((object) => ({ type: 'object' as const, id: object.id }));
      break;
    }

    case 'UNGROUP_SELECTION': {
      const items = getSelectableItems(normalizedCommand.payload.selection).filter((item) => item.type === 'object');
      if (items.length === 0) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }

      const groupIds = new Set<string>();
      for (const item of items) {
        const object = nextMap.objects.find((entry) => entry.id === item.id);
        const groupId = object ? getObjectGroupId(object) : null;
        if (groupId) groupIds.add(groupId);
      }
      if (groupIds.size === 0) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }

      nextMap.objects = nextMap.objects.map((object) => {
        const groupId = getObjectGroupId(object);
        if (groupId && groupIds.has(groupId)) {
          return { ...object, data: setObjectGroupData(object.data, null, null) };
        }
        return object;
      });
      break;
    }

    case 'NUDGE_SELECTION': {
      const { delta } = normalizedCommand.payload;
      const items = expandObjectSelectionItems(getSelectableItems(selection), nextMap.objects);
      if (items.length === 0 || (delta.x === 0 && delta.y === 0)) {
        return commandResult({ map, selection, createdId, activeLevelId });
      }

      const movedSectionIds = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));

      for (const item of items) {
        if (item.type !== 'section') continue;

        const linkedObject = nextMap.objects.find((object) => object.sectionId === item.id);
        if (linkedObject && !linkedObject.locked) {
          linkedObject.x += delta.x;
          linkedObject.y += delta.y;
        }
        translateSectionCorridorBase(nextMap, item.id, { x: delta.x, y: delta.y });

        nextMap.seats = nextMap.seats.map((seat) => {
          if (seat.sectionId === item.id && seat.status !== 'SOLD') {
            return { ...seat, x: seat.x + delta.x, y: seat.y + delta.y };
          }
          return seat;
        });
      }

      const objectIds = new Set(items.filter((item) => item.type === 'object').map((item) => item.id));
      const seatIds = new Set(items.filter((item) => item.type === 'seat').map((item) => item.id));

      const sectionDeltaById = new Map<string, { x: number; y: number }>();

      if (objectIds.size > 0) {
        for (const object of nextMap.objects) {
          if (!objectIds.has(object.id) || object.type !== 'SECTION' || !object.sectionId) continue;
          if (object.sectionId && movedSectionIds.has(object.sectionId)) continue;
          sectionDeltaById.set(object.sectionId, delta);
        }

        nextMap.objects = nextMap.objects.map((object) => {
          if (!objectIds.has(object.id)) return object;
          if (object.sectionId && movedSectionIds.has(object.sectionId)) return object;
          return applyObjectPatchWithCorridorMetadata(object, {
            x: object.x + delta.x,
            y: object.y + delta.y,
          });
        });

        for (const [sectionId, secDelta] of sectionDeltaById) {
          translateSectionCorridorBase(nextMap, sectionId, secDelta);
        }
      }

      if (seatIds.size > 0) {
        const seatBaseDeltas = nextMap.seats
          .filter((seat) => seatIds.has(seat.id) && seat.status !== 'SOLD' && !(seat.sectionId && movedSectionIds.has(seat.sectionId)))
          .map((seat) => {
            const sectionDelta = sectionDeltaById.get(seat.sectionId) ?? { x: 0, y: 0 };
            return {
              seatId: seat.id,
              sectionId: seat.sectionId,
              delta: { x: delta.x - sectionDelta.x, y: delta.y - sectionDelta.y },
            };
          });

        translateSeatCorridorBase(nextMap, seatBaseDeltas);

        nextMap.seats = nextMap.seats.map((seat) => {
          if (!seatIds.has(seat.id) || seat.status === 'SOLD') return seat;
          if (seat.sectionId && movedSectionIds.has(seat.sectionId)) return seat;
          return {
            ...seat,
            x: seat.x + delta.x,
            y: seat.y + delta.y,
          };
        });
      }

      applyCorridorReflow(nextMap);
      updateCounts(nextMap);
      break;
    }

    case 'UPDATE_SEAT_GROUP': {
      const { id, patch } = normalizedCommand.payload;
      const groupIndex = (nextMap.seatGroups ?? []).findIndex((g) => g.id === id);
      if (groupIndex === -1) break;
      const prev = nextMap.seatGroups[groupIndex]!;
      const next = { ...prev, ...patch };
      nextMap.seatGroups[groupIndex] = next;

      const rowsChanged = typeof patch.rows === 'number' && patch.rows !== prev.rows;
      const colsChanged = typeof patch.columns === 'number' && patch.columns !== prev.columns;

      if (rowsChanged || colsChanged) {
        nextMap.seats = nextMap.seats.filter((seat) => {
          if (seat.groupId !== id) return true;
          return (seat.rowIndex ?? 0) < next.rows && (seat.columnIndex ?? 0) < next.columns;
        });

        const numbering = next.numbering as Record<string, unknown>;
        const rowPrefix = String(numbering.rowPrefix ?? 'A');
        const startNumber = Number(numbering.startNumber ?? 1);
        const direction = numbering.direction === 'right-to-left' ? 'right-to-left' : 'left-to-right';

        const existingSeat = nextMap.seats.find((s) => s.groupId === id);
        const sectionId = existingSeat?.sectionId ?? null;
        const section = sectionId ? nextMap.sections.find((s) => s.id === sectionId) : null;
        const sectionCode = section?.name?.replace(/\s+/g, '-').toUpperCase() ?? 'SECTION';

        const existingPairs = new Set(
          nextMap.seats.filter((s) => s.groupId === id).map((s) => `${s.rowIndex ?? 0}:${s.columnIndex ?? 0}`),
        );

        const stepX = next.seatWidth + next.gapX;
        const stepY = next.seatHeight + next.gapY;

        if (sectionId) {
          for (let rowIndex = 0; rowIndex < next.rows; rowIndex++) {
            for (let colIndex = 0; colIndex < next.columns; colIndex++) {
              if (existingPairs.has(`${rowIndex}:${colIndex}`)) continue;
              const visualColIndex = direction === 'right-to-left' ? next.columns - colIndex - 1 : colIndex;
              const rowLabel = getSeatGridRowLabel(rowIndex, rowPrefix);
              const seatNumber = String(startNumber + visualColIndex);
              const displayLabel = `${rowLabel}${seatNumber}`;
              nextMap.seats.push({
                id: createLocalId('seat', runtime),
                levelId: next.levelId,
                sectionId,
                objectId: null,
                groupId: id,
                rowIndex,
                columnIndex: colIndex,
                technicalCode: `${sectionCode}-${displayLabel}`,
                displayLabel,
                rowLabel,
                seatNumber,
                status: 'AVAILABLE',
                accessible: false,
                publicVisible: true,
                x: next.x + next.paddingLeft + colIndex * stepX + next.seatWidth / 2,
                y: next.y + next.paddingTop + rowIndex * stepY + next.seatHeight / 2,
                size: next.seatWidth,
                rotation: 0,
              });
            }
          }
        }
      }

      if (
        typeof patch.x === 'number' ||
        typeof patch.y === 'number' ||
        typeof patch.seatWidth === 'number' ||
        typeof patch.seatHeight === 'number' ||
        typeof patch.gapX === 'number' ||
        typeof patch.gapY === 'number' ||
        typeof patch.paddingTop === 'number' ||
        typeof patch.paddingLeft === 'number'
      ) {
        const stepX = next.seatWidth + next.gapX;
        const stepY = next.seatHeight + next.gapY;
        nextMap.seats = nextMap.seats.map((seat) => {
          if (seat.groupId !== id) return seat;
          const row = seat.rowIndex ?? 0;
          const col = seat.columnIndex ?? 0;
          return {
            ...seat,
            x: next.x + next.paddingLeft + col * stepX + next.seatWidth / 2,
            y: next.y + next.paddingTop + row * stepY + next.seatHeight / 2,
          };
        });
      }

      updateCounts(nextMap);
      applyCorridorReflow(nextMap);
      break;
    }

    case 'DELETE_SEAT_GROUP': {
      const { id } = normalizedCommand.payload;
      const removedSeatSectionIds = new Set(
        nextMap.seats
          .filter((s) => s.groupId === id)
          .map((s) => s.sectionId)
          .filter((sid): sid is string => !!sid),
      );
      nextMap.seatGroups = (nextMap.seatGroups ?? []).filter((g) => g.id !== id);
      nextMap.seats = nextMap.seats.filter((s) => s.groupId !== id);
      for (const sectionId of removedSeatSectionIds) {
        if (!nextMap.seats.some((s) => s.sectionId === sectionId)) {
          nextMap.objects = nextMap.objects.filter((o) => !o.sectionId || o.sectionId !== sectionId);
          nextMap.sections = nextMap.sections.filter((s) => s.id !== sectionId);
        }
      }
      updateCounts(nextMap);
      nextSelection = [];
      break;
    }

    case 'RESTORE_DELETED_ITEMS': {
      const { objects, seats, sections, levels, seatGroups = [] } = normalizedCommand.payload;
      for (const level of levels) {
        if (!nextMap.levels.some((l) => l.id === level.id)) {
          nextMap.levels.push(level);
        }
      }
      applyMapLevels(nextMap);
      for (const section of sections) {
        if (!nextMap.sections.some((s) => s.id === section.id)) {
          nextMap.sections.push(section);
        }
      }
      for (const object of objects) {
        if (!nextMap.objects.some((o) => o.id === object.id)) {
          nextMap.objects.push(object);
        }
      }
      nextMap.seatGroups = nextMap.seatGroups ?? [];
      for (const group of seatGroups) {
        if (!nextMap.seatGroups.some((g) => g.id === group.id)) {
          nextMap.seatGroups.push(group);
        }
      }
      for (const seat of seats) {
        if (!nextMap.seats.some((s) => s.id === seat.id)) {
          nextMap.seats.push(seat);
        }
      }
      applyCorridorReflow(nextMap);
      updateCounts(nextMap);
      break;
    }

    case 'RESTORE_OBJECT_GROUPS': {
      const { objects } = normalizedCommand.payload;
      const objectMap = new Map(objects.map((o) => [o.id, o.prevData]));
      nextMap.objects = nextMap.objects.map((object) => {
        if (objectMap.has(object.id)) {
          return {
            ...object,
            data: { ...objectMap.get(object.id) },
          };
        }
        return object;
      });
      break;
    }

    default:
      break;
  }

  // Generate undoCommand dynamically
  switch (normalizedCommand.type) {
    case 'ADD_OBJECT': {
      const tool = normalizedCommand.payload.tool;
      const targetId = createdId || normalizedCommand.payload.id;
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: [{ type: tool === 'section' ? 'section' as const : tool === 'seat' ? 'seat' as const : 'object' as const, id: targetId }],
        },
      };
      break;
    }
    case 'DELETE_SELECTION':
    case 'DELETE_LEVEL':
    case 'DELETE_SEAT_GROUP': {
      undoCommand = {
        type: 'RESTORE_DELETED_ITEMS',
        payload: {
          objects: map.objects.filter((o) => !nextMap.objects.some((no) => no.id === o.id)),
          seats: map.seats.filter((s) => !nextMap.seats.some((ns) => ns.id === s.id)),
          sections: map.sections.filter((s) => !nextMap.sections.some((ns) => ns.id === s.id)),
          levels: map.levels.filter((l) => !nextMap.levels.some((nl) => nl.id === l.id)),
          seatGroups: (map.seatGroups ?? []).filter((g) => !(nextMap.seatGroups ?? []).some((ng) => ng.id === g.id)),
        },
      };
      break;
    }
    case 'UPDATE_ITEMS': {
      undoCommand = buildUndoUpdateItems(map, nextMap);
      break;
    }
    case 'ADD_LEVEL': {
      undoCommand = {
        type: 'DELETE_LEVEL',
        payload: {
          levelId: normalizedCommand.payload.levelId,
        },
      };
      break;
    }
    case 'ADD_ROW': {
      const addedSeatIds = nextMap.seats.filter(ns => !map.seats.some(s => s.id === ns.id)).map(ns => ns.id);
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: addedSeatIds.map((id) => ({ type: 'seat' as const, id })),
        },
      };
      break;
    }
    case 'ADD_SEAT_GRID': {
      const addedSeats = nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id));
      const addedSections = nextMap.sections.filter((ns) => !map.sections.some((s) => s.id === ns.id));
      const addedObjects = nextMap.objects.filter((no) => !map.objects.some((o) => o.id === no.id));
      const addedGroups = (nextMap.seatGroups ?? []).filter((ng) => !(map.seatGroups ?? []).some((g) => g.id === ng.id));
      
      const selectionToDelete: MapSelection = [
        ...addedSeats.map((s) => ({ type: 'seat' as const, id: s.id })),
        ...addedSections.map((s) => ({ type: 'section' as const, id: s.id })),
        ...addedObjects.map((o) => ({ type: 'object' as const, id: o.id })),
        ...addedGroups.map((g) => ({ type: 'seatgroup' as const, id: g.id })),
      ];
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: selectionToDelete,
        },
      };
      break;
    }
    case 'DUPLICATE_SELECTION': {
      const addedSeats = nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id));
      const addedObjects = nextMap.objects.filter((no) => !map.objects.some((o) => o.id === no.id));
      
      const selectionToDelete: MapSelection = [
        ...addedSeats.map((s) => ({ type: 'seat' as const, id: s.id })),
        ...addedObjects.map((o) => ({ type: 'object' as const, id: o.id })),
      ];
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: selectionToDelete,
        },
      };
      break;
    }
    case 'GROUP_SELECTION':
    case 'UNGROUP_SELECTION': {
      const candidateIds = new Set(normalizedCommand.payload.selection.filter(item => item.type === 'object').map(item => item.id));
      undoCommand = {
        type: 'RESTORE_OBJECT_GROUPS',
        payload: {
          objects: map.objects.filter((o) => candidateIds.has(o.id)).map((o) => ({
            id: o.id,
            prevData: { ...o.data },
          })),
        },
      };
      break;
    }
    case 'UPDATE_SEAT_GROUP': {
      const prevGroup = (map.seatGroups ?? []).find((g) => g.id === normalizedCommand.payload.id);
      undoCommand = {
        type: 'UPDATE_SEAT_GROUP',
        payload: {
          id: normalizedCommand.payload.id,
          patch: prevGroup ? { ...prevGroup } : {},
        },
      };
      break;
    }
    case 'NUDGE_SELECTION': {
      undoCommand = buildUndoUpdateItems(map, nextMap);
      break;
    }
    case 'RESTORE_DELETED_ITEMS': {
      const { objects, seats, sections, levels, seatGroups = [] } = normalizedCommand.payload;
      const selectionToDelete: MapSelection = [
        ...objects.map((o) => ({ type: 'object' as const, id: o.id })),
        ...seats.map((s) => ({ type: 'seat' as const, id: s.id })),
        ...sections.map((s) => ({ type: 'section' as const, id: s.id })),
        ...levels.map((l) => ({ type: 'level' as const, id: l.id })),
        ...seatGroups.map((g) => ({ type: 'seatgroup' as const, id: g.id })),
      ];
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: selectionToDelete,
        },
      };
      break;
    }
    case 'RESTORE_OBJECT_GROUPS': {
      undoCommand = {
        type: 'RESTORE_OBJECT_GROUPS',
        payload: {
          objects: normalizedCommand.payload.objects.map((o) => {
            const currentObj = map.objects.find((curr) => curr.id === o.id);
            return {
              id: o.id,
              prevData: currentObj ? { ...currentObj.data } : {},
            };
          }),
        },
      };
      break;
    }
  }

  return commandResult({
    map: nextMap,
    selection: nextSelection,
    createdId,
    activeLevelId: nextActiveLevelId,
    undoCommand,
    patches: [normalizedCommand],
  });
}

function getDefaultActiveLevelId(levels: EventMapLevelDTO[]) {
  const normalized = normalizeMapLevels(levels);
  const otherLevels = normalized.filter((level) => !isPlateiaBaseLevel(level));
  if (otherLevels.length > 0) return otherLevels.at(-1)?.id ?? null;
  return normalized.find((level) => isPlateiaBaseLevel(level))?.id ?? null;
}

function buildUndoUpdateItems(
  map: EventMapDTO,
  nextMap: EventMapDTO,
): MapCommand {
  const objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seats: Array<{ id: string; patch: Partial<EventSeatDTO> }> = [];
  const sections: Array<{ id: string; patch: Partial<EventMapSectionDTO> }> = [];
  const levels: Array<{ id: string; patch: Partial<EventMapLevelDTO> }> = [];

  for (const prev of map.objects) {
    const next = nextMap.objects.find((o) => o.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventMapObjectDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'locked', 'hidden', 'sortOrder'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = prev[key];
        changed = true;
      }
    }
    if (JSON.stringify(prev.data) !== JSON.stringify(next.data)) {
      patch.data = prev.data;
      changed = true;
    }
    if (changed) {
      objects.push({ id: prev.id, patch });
    }
  }

  for (const prev of map.seats) {
    const next = nextMap.seats.find((s) => s.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventSeatDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'size', 'rotation', 'status', 'accessible', 'publicVisible', 'technicalCode', 'displayLabel', 'rowLabel', 'seatNumber', 'objectId', 'groupId'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = prev[key];
        changed = true;
      }
    }
    if (changed) {
      seats.push({ id: prev.id, patch });
    }
  }

  for (const prev of map.sections) {
    const next = nextMap.sections.find((s) => s.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventMapSectionDTO> = {};
    let changed = false;
    for (const key of ['name', 'color', 'capacity', 'status', 'notes', 'lotId'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = prev[key];
        changed = true;
      }
    }
    if (changed) {
      sections.push({ id: prev.id, patch });
    }
  }

  for (const prev of map.levels) {
    const next = nextMap.levels.find((l) => l.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventMapLevelDTO> = {};
    let changed = false;
    for (const key of ['name', 'sortOrder', 'widthPx', 'heightPx', 'unit', 'scale'] as const) {
      if (prev[key] !== next[key]) {
        (patch as any)[key] = prev[key];
        changed = true;
      }
    }
    if (changed) {
      levels.push({ id: prev.id, patch });
    }
  }

  return {
    type: 'UPDATE_ITEMS',
    payload: {
      objects,
      seats,
      sections,
      levels,
      skipCorridorReflow: true,
      skipSeatBaseLayoutTranslation: true,
    },
  };
}
