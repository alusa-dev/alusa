import type {
  EventMapDTO,
  EventMapLevelDTO,
  EventMapObjectDTO,
  EventMapSectionDTO,
  EventSeatDTO,
} from '../../types/event-map-types.js';
import type { MapCommand } from '../../commands/command-types.js';
import {
  clampArtboardHeight,
  clampArtboardWidth,
} from '../../doc/levels.js';
import {
  applyMapLevels,
  commandResult,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';
import { worldToSectionLocal } from '../../geometry/map-coordinate-transform.js';
import { findMapRowOwner, findMapSeatOwner } from '../../model/event-map-document.js';
import type { EventMapDocument, MapSeatRow } from '../../model/event-map-document.js';
import { resolveEventMapLayout } from '../../layout/resolve-map-layout.js';

function translateRowPath(path: MapSeatRow['path'], dx: number, dy: number): MapSeatRow['path'] {
  const point = (value: { x: number; y: number }) => ({ x: value.x + dx, y: value.y + dy });
  if (path.type === 'LINE') return { ...path, start: point(path.start), end: point(path.end) };
  if (path.type === 'ARC') return { ...path, center: point(path.center) };
  if (path.type === 'POLYLINE') return { ...path, points: path.points.map(point) };
  return { ...path, p0: point(path.p0), p1: point(path.p1), p2: point(path.p2), p3: point(path.p3) };
}

/** Persist parametric row translations back to the canonical document. */
function syncParametricRowsFromSeatPatches(
  document: EventMapDocument | undefined,
  previousSeats: EventSeatDTO[],
  patches: Array<{ id: string; patch: Partial<EventSeatDTO> }>,
) {
  if (!document) return document;
  const geometryPatches = patches.filter((entry) => entry.patch.x !== undefined || entry.patch.y !== undefined);
  if (geometryPatches.length === 0) return document;

  const patchesByRow = new Map<string, typeof geometryPatches>();
  for (const entry of geometryPatches) {
    const owner = findMapSeatOwner(document, entry.id);
    if (!owner) continue;
    const list = patchesByRow.get(owner.row.id) ?? [];
    list.push(entry);
    patchesByRow.set(owner.row.id, list);
  }

  if (patchesByRow.size === 0) return document;
  const resolvedLayout = resolveEventMapLayout(document);
  const activeSeatIdsByRow = new Map(
    resolvedLayout.rows.map((row) => [row.rowId, new Set(row.seatPlacements.map((seat) => seat.seatId))]),
  );
  const previousById = new Map(previousSeats.map((seat) => [seat.id, seat]));
  let nextDocument = document;
  const translatedSeatIds = new Set<string>();

  for (const [rowId, rowPatches] of patchesByRow) {
    const owner = findMapRowOwner(nextDocument, rowId);
    const activeSeatIds = activeSeatIdsByRow.get(rowId);
    if (!owner || !activeSeatIds || rowPatches.length !== activeSeatIds.size || rowPatches.some((entry) => !activeSeatIds.has(entry.id))) continue;
    const deltas = rowPatches.flatMap((entry) => {
      const previous = previousById.get(entry.id);
      const nextX = entry.patch.x ?? previous?.x;
      const nextY = entry.patch.y ?? previous?.y;
      if (!previous || nextX === undefined || nextY === undefined) return [];
      return [{ x: nextX - previous.x, y: nextY - previous.y }];
    });
    const first = deltas[0];
    if (!first || deltas.length !== rowPatches.length || deltas.some((delta) => Math.abs(delta.x - first.x) > 0.01 || Math.abs(delta.y - first.y) > 0.01)) continue;
    rowPatches.forEach((entry) => translatedSeatIds.add(entry.id));
    const localDelta = worldToSectionLocal(first, { x: 0, y: 0 }, owner.section.rotation);
    nextDocument = {
      ...nextDocument,
      sections: nextDocument.sections.map((section) => section.id !== owner.section.id ? section : {
        ...section,
        blocks: section.blocks.map((block) => block.id !== owner.block.id ? block : {
          ...block,
          rows: block.rows.map((row) => row.id === rowId ? {
            ...row,
            path: translateRowPath(row.path, localDelta.x, localDelta.y),
            seats: row.seats.map((seat) => seat.position ? {
              ...seat,
              position: { x: seat.position.x + localDelta.x, y: seat.position.y + localDelta.y },
            } : seat),
          } : row),
        }),
      }),
    };
  }

  for (const entry of geometryPatches) {
    if (translatedSeatIds.has(entry.id)) continue;
    const owner = findMapSeatOwner(nextDocument, entry.id);
    const previous = previousById.get(entry.id);
    if (!owner || !previous) continue;
    const nextX = entry.patch.x ?? previous.x;
    const nextY = entry.patch.y ?? previous.y;
    const localPosition = worldToSectionLocal({ x: nextX, y: nextY }, owner.section.position, owner.section.rotation);
    nextDocument = {
      ...nextDocument,
      sections: nextDocument.sections.map((section) => section.id !== owner.section.id ? section : {
        ...section,
        blocks: section.blocks.map((block) => block.id !== owner.block.id ? block : {
          ...block,
          rows: block.rows.map((row) => row.id !== owner.row.id ? row : {
            ...row,
            seats: row.seats.map((seat) => seat.id !== entry.id ? seat : {
              ...seat,
              position: localPosition,
              ...(entry.patch.rotation !== undefined ? { rotation: entry.patch.rotation - owner.section.rotation } : {}),
            }),
          }),
        }),
      }),
    };
  }

  return nextDocument;
}

export function handleUpdateItems(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'UPDATE_ITEMS' }>,
): MapCommandHandlerResult {
  const {
    objects = [],
    seats = [],
    sections = [],
    levels = [],
  } = command.payload;

  if (objects.length === 0 && seats.length === 0 && sections.length === 0 && levels.length === 0) {
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
  const sectionPatchById = new Map(sections.map((entry) => [entry.id, entry.patch]));
  const levelPatchById = new Map(levels.map((entry) => [entry.id, entry.patch]));

  state.nextMap.document = syncParametricRowsFromSeatPatches(
    state.nextMap.document,
    state.beforeMap.seats,
    seats,
  );

  if (objectPatchById.size > 0) {
    state.nextMap.objects = state.nextMap.objects.map((object) => {
      const patch = objectPatchById.get(object.id);
      if (!patch) return object;
      return patch.data ? { ...object, ...patch, data: { ...object.data, ...patch.data } } : { ...object, ...patch };
    });
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
                  ...(patch.color && object.type !== 'SECTION' ? { fill: patch.color } : {}),
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
      const { sortOrder: _sortOrder, widthPx, heightPx, unit, ...allowedPatch } = patch;
      return {
        ...level,
        ...allowedPatch,
        widthPx: widthPx !== undefined ? clampArtboardWidth(widthPx) : level.widthPx,
        heightPx: heightPx !== undefined ? clampArtboardHeight(heightPx) : level.heightPx,
        unit: unit ?? level.unit ?? 'px',
      };
    });
    applyMapLevels(state.nextMap);
  }

}

export function buildUndoUpdateItems(map: EventMapDTO, nextMap: EventMapDTO): MapCommand {
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
    for (const key of ['x', 'y', 'size', 'rotation', 'status', 'accessible', 'publicVisible', 'technicalCode', 'displayLabel', 'rowLabel', 'seatNumber', 'objectId'] as const) {
      if (prev[key] !== next[key]) {
        (patch as Record<string, unknown>)[key] = prev[key];
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
    for (const key of ['name', 'color', 'capacity', 'status', 'notes', 'lotId', 'hidden'] as const) {
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
      sections,
      levels,
      skipSeatBaseLayoutTranslation: true,
    },
  };
}
