import type {
  EventMapDTO,
  EventMapLevelDTO,
  EventMapObjectDTO,
  EventMapSectionDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
} from '../../types/event-map-types.js';
import type { MapCommand } from '../../commands/command-types.js';
import {
  applyCorridorReflow,
  translateSeatCorridorBase,
  translateSectionCorridorBase,
} from '../../layout/corridor/index.js';
import {
  MAP_AREA_HEIGHT_PX,
  MAP_AREA_WIDTH_PX,
} from '../../geometry/level-utils.js';
import { applyObjectPatchWithCorridorMetadata } from './corridor.js';
import { applySeatGroupPatch } from './seat-group.js';
import {
  applyMapLevels,
  commandResult,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';

export function handleUpdateItems(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'UPDATE_ITEMS' }>,
): MapCommandHandlerResult {
  const {
    objects = [],
    seats = [],
    seatGroups = [],
    sections = [],
    levels = [],
    skipSeatBaseLayoutTranslation = false,
    skipCorridorReflow = false,
  } = command.payload;

  if (objects.length === 0 && seats.length === 0 && seatGroups.length === 0 && sections.length === 0 && levels.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }

  const objectPatchById = new Map(objects.map((entry) => [entry.id, entry.patch]));
  const seatPatchById = new Map(seats.map((entry) => [entry.id, entry.patch]));
  const seatGroupPatchById = new Map(seatGroups.map((entry) => [entry.id, entry.patch]));
  const sectionPatchById = new Map(sections.map((entry) => [entry.id, entry.patch]));
  const levelPatchById = new Map(levels.map((entry) => [entry.id, entry.patch]));

  const sectionDeltaById = new Map<string, { x: number; y: number }>();

  if (objectPatchById.size > 0) {
    if (!skipSeatBaseLayoutTranslation) {
      for (const object of state.nextMap.objects) {
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

    state.nextMap.objects = state.nextMap.objects.map((object) => {
      const patch = objectPatchById.get(object.id);
      if (!patch) return object;
      return applyObjectPatchWithCorridorMetadata(object, patch);
    });

    if (!skipSeatBaseLayoutTranslation) {
      for (const [sectionId, delta] of sectionDeltaById) {
        translateSectionCorridorBase(state.nextMap, sectionId, delta);
      }
    }
  }

  if (seatPatchById.size > 0) {
    if (!skipSeatBaseLayoutTranslation) {
      const seatBaseDeltas: Array<{ seatId: string; sectionId: string; delta: { x: number; y: number } }> = [];
      for (const seat of state.nextMap.seats) {
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
      translateSeatCorridorBase(state.nextMap, seatBaseDeltas);
    }
  }

  if (seatGroupPatchById.size > 0) {
    for (const [id, patch] of seatGroupPatchById) {
      applySeatGroupPatch(state.nextMap, id, patch, state.runtime);
    }
  }

  if (seatPatchById.size > 0) {
    state.nextMap.seats = state.nextMap.seats.map((seat) => {
      const patch = seatPatchById.get(seat.id);
      return patch ? { ...seat, ...patch } : seat;
    });
    updateCounts(state.nextMap);
  }

  if (sectionPatchById.size > 0) {
    state.nextMap.sections = state.nextMap.sections.map((section) => {
      const patch = sectionPatchById.get(section.id);
      if (!patch) return section;
      const nextSec = { ...section, ...patch };
      if (patch.name || patch.color) {
        state.nextMap.objects = state.nextMap.objects.map((object) =>
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
    state.nextMap.levels = state.nextMap.levels.map((level) => {
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
    applyMapLevels(state.nextMap);
  }

  if (!skipCorridorReflow) {
    applyCorridorReflow(state.nextMap);
  }
}

export function buildUndoUpdateItems(map: EventMapDTO, nextMap: EventMapDTO): MapCommand {
  const objects: Array<{ id: string; patch: Partial<EventMapObjectDTO> }> = [];
  const seats: Array<{ id: string; patch: Partial<EventSeatDTO> }> = [];
  const seatGroups: Array<{ id: string; patch: Partial<EventSeatGroupDTO> }> = [];
  const sections: Array<{ id: string; patch: Partial<EventMapSectionDTO> }> = [];
  const levels: Array<{ id: string; patch: Partial<EventMapLevelDTO> }> = [];

  for (const prev of map.objects) {
    const next = nextMap.objects.find((o) => o.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventMapObjectDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'width', 'height', 'rotation', 'locked', 'hidden', 'sortOrder'] as const) {
      if (prev[key] !== next[key]) {
        (patch as Record<string, unknown>)[key] = prev[key];
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
        (patch as Record<string, unknown>)[key] = prev[key];
        changed = true;
      }
    }
    if (changed) {
      seats.push({ id: prev.id, patch });
    }
  }

  for (const prev of map.seatGroups ?? []) {
    const next = (nextMap.seatGroups ?? []).find((g) => g.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventSeatGroupDTO> = {};
    let changed = false;
    for (const key of ['x', 'y', 'rotation', 'rows', 'columns', 'seatWidth', 'seatHeight', 'gapX', 'gapY', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'locked', 'name'] as const) {
      if (prev[key] !== next[key]) {
        (patch as Record<string, unknown>)[key] = prev[key];
        changed = true;
      }
    }
    if (JSON.stringify(prev.numbering) !== JSON.stringify(next.numbering)) {
      patch.numbering = prev.numbering;
      changed = true;
    }
    if (changed) {
      seatGroups.push({ id: prev.id, patch });
    }
  }

  for (const prev of map.sections) {
    const next = nextMap.sections.find((s) => s.id === prev.id);
    if (!next) continue;
    const patch: Partial<EventMapSectionDTO> = {};
    let changed = false;
    for (const key of ['name', 'color', 'capacity', 'status', 'notes', 'lotId'] as const) {
      if (prev[key] !== next[key]) {
        (patch as Record<string, unknown>)[key] = prev[key];
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
        (patch as Record<string, unknown>)[key] = prev[key];
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
      seatGroups,
      sections,
      levels,
      skipCorridorReflow: true,
      skipSeatBaseLayoutTranslation: true,
    },
  };
}
