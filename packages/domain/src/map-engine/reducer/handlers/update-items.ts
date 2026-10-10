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
import { projectMapDocumentToEditorFields } from '../../migration/project-map-document.js';

function translateRowPath(path: MapSeatRow['path'], dx: number, dy: number): MapSeatRow['path'] {
  const point = (value: { x: number; y: number }) => ({ x: value.x + dx, y: value.y + dy });
  if (path.type === 'LINE') return { ...path, start: point(path.start), end: point(path.end) };
  if (path.type === 'ARC') return { ...path, center: point(path.center) };
  if (path.type === 'POLYLINE') return { ...path, points: path.points.map(point) };
  return { ...path, p0: point(path.p0), p1: point(path.p1), p2: point(path.p2), p3: point(path.p3) };
}

/** Persist individual seat transforms back to the canonical document. */
function syncParametricRowsFromSeatPatches(
  document: EventMapDocument | undefined,
  previousSeats: EventSeatDTO[],
  patches: Array<{ id: string; patch: Partial<EventSeatDTO> }>,
) {
  if (!document) return document;
  const geometryPatches = patches.filter((entry) =>
    entry.patch.x !== undefined || entry.patch.y !== undefined || entry.patch.rotation !== undefined || entry.patch.size !== undefined,
  );
  if (geometryPatches.length === 0) return document;

  const positionPatches = geometryPatches.filter((entry) => entry.patch.x !== undefined || entry.patch.y !== undefined);
  const patchesByRow = new Map<string, typeof positionPatches>();
  for (const entry of positionPatches) {
    const owner = findMapSeatOwner(document, entry.id);
    if (!owner) continue;
    const list = patchesByRow.get(owner.row.id) ?? [];
    list.push(entry);
    patchesByRow.set(owner.row.id, list);
  }

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
    const owner = findMapSeatOwner(nextDocument, entry.id);
    const previous = previousById.get(entry.id);
    if (!owner || !previous) continue;
    const hasPositionPatch = entry.patch.x !== undefined || entry.patch.y !== undefined;
    const nextX = entry.patch.x ?? previous.x;
    const nextY = entry.patch.y ?? previous.y;
    const localPosition = hasPositionPatch
      ? worldToSectionLocal({ x: nextX, y: nextY }, owner.section.position, owner.section.rotation)
      : null;
    nextDocument = {
      ...nextDocument,
      sections: nextDocument.sections.map((section) => section.id !== owner.section.id ? section : {
        ...section,
        blocks: section.blocks.map((block) => block.id !== owner.block.id ? block : {
          ...block,
          rows: block.rows.map((row) => row.id !== owner.row.id ? row : {
            ...row,
            seats: row.seats.map((seat) => {
              if (seat.id !== entry.id) return seat;
              const { size: _size, ...seatWithoutSize } = seat;
              const removesSizeOverride = entry.patch.size === null || (
                entry.patch.size !== undefined && Math.abs(entry.patch.size - owner.row.seatSize) < 0.001
              );
              return {
                ...(removesSizeOverride ? seatWithoutSize : seat),
                ...(!translatedSeatIds.has(entry.id) && localPosition ? { position: localPosition } : {}),
                ...(entry.patch.rotation !== undefined ? { rotation: entry.patch.rotation - owner.section.rotation } : {}),
                ...(!removesSizeOverride && entry.patch.size !== undefined && entry.patch.size !== null ? { size: entry.patch.size } : {}),
              };
            }),
          }),
        }),
      }),
    };
  }

  return nextDocument;
}

/** Persist editable seat labels and flags in the canonical document. */
function syncSeatMetadataFromPatches(
  document: EventMapDocument | undefined,
  patches: Array<{ id: string; patch: Partial<EventSeatDTO> }>,
) {
  if (!document) return document;
  const metadataPatches = new Map(patches
    .filter(({ patch }) =>
      patch.technicalCode !== undefined || patch.displayLabel !== undefined || patch.rowLabel !== undefined ||
      patch.seatNumber !== undefined || patch.accessible !== undefined || patch.publicVisible !== undefined,
    )
    .map(({ id, patch }) => [id, patch]));
  if (metadataPatches.size === 0) return document;

  let changed = false;
  const sections = document.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => ({
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        seats: row.seats.map((seat, seatIndex) => {
          const patch = metadataPatches.get(seat.id);
          if (!patch) return seat;
          changed = true;
          const next: typeof seat = {
            ...seat,
            ...(patch.technicalCode !== undefined ? { technicalCode: patch.technicalCode } : {}),
            ...(patch.displayLabel !== undefined ? { label: patch.displayLabel } : {}),
            ...(patch.accessible !== undefined ? { accessible: patch.accessible } : {}),
            ...(patch.publicVisible !== undefined ? { publicVisible: patch.publicVisible } : {}),
          };
          if (patch.rowLabel !== undefined) {
            const rowLabel = patch.rowLabel ?? '';
            if (rowLabel === row.label) delete next.rowLabel;
            else next.rowLabel = rowLabel;
          }
          if (patch.seatNumber !== undefined) {
            const seatNumber = patch.seatNumber ?? '';
            const derivedSeatNumber = next.technicalCode?.match(/(\d+)$/)?.[1] ?? String(seatIndex + 1);
            if (seatNumber === derivedSeatNumber) delete next.seatNumber;
            else next.seatNumber = seatNumber;
          }
          // A manually edited technical code should derive its number from the
          // new code unless the same command explicitly sets a visible number.
          if (patch.technicalCode !== undefined && patch.seatNumber === undefined) {
            delete next.seatNumber;
          }
          return next;
        }),
      })),
    })),
  }));
  return changed ? { ...document, sections } : document;
}

function filterEditablePatches<T extends { id: string }>(
  entries: Array<{ id: string; patch: Partial<T> }>,
  currentItems: T[],
  allowedFields: readonly string[],
  mergeData = false,
) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]));
  const patches: Array<{ id: string; patch: Partial<T> }> = [];
  let missingCount = 0;
  let ignoredFieldCount = 0;

  for (const entry of entries) {
    const current = currentById.get(entry.id);
    if (!current) {
      missingCount += 1;
      continue;
    }

    const editableEntries = Object.entries(entry.patch as Record<string, unknown>)
      .filter(([field, value]) => {
        if (value === undefined) return false;
        if (allowedFields.includes(field)) return true;
        ignoredFieldCount += 1;
        return false;
      });
    const patch = Object.fromEntries(editableEntries) as Partial<T>;
    const currentRecord = current as unknown as Record<string, unknown>;
    const hasChanges = editableEntries.some(([field, value]) => {
      const nextValue = mergeData && field === 'data' && value && typeof value === 'object'
        ? { ...(currentRecord.data as Record<string, unknown> | undefined), ...(value as Record<string, unknown>) }
        : value;
      return JSON.stringify(currentRecord[field]) !== JSON.stringify(nextValue);
    });
    if (hasChanges) patches.push({ id: entry.id, patch });
  }

  return { patches, missingCount, ignoredFieldCount };
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

  const objectUpdates = filterEditablePatches(objects, state.nextMap.objects, ['x', 'y', 'width', 'height', 'rotation', 'locked', 'hidden', 'sortOrder', 'data'], true);
  const seatUpdates = filterEditablePatches(seats, state.nextMap.seats, ['x', 'y', 'size', 'rotation', 'status', 'accessible', 'publicVisible', 'technicalCode', 'displayLabel', 'rowLabel', 'seatNumber']);
  const sectionUpdates = filterEditablePatches(sections, state.nextMap.sections, ['name', 'color', 'capacity', 'status', 'notes', 'lotId', 'hidden']);
  const levelUpdates = filterEditablePatches(levels, state.nextMap.levels, ['name', 'widthPx', 'heightPx', 'unit', 'scale']);

  const missingCount = objectUpdates.missingCount + seatUpdates.missingCount + sectionUpdates.missingCount + levelUpdates.missingCount;
  const ignoredFieldCount = objectUpdates.ignoredFieldCount + seatUpdates.ignoredFieldCount + sectionUpdates.ignoredFieldCount + levelUpdates.ignoredFieldCount;
  if (missingCount > 0) state.warnings.push('Alguns itens não foram encontrados e não foram atualizados.');
  if (ignoredFieldCount > 0) state.warnings.push('Alguns campos não podem ser alterados por esta ação.');

  const effectiveObjects = objectUpdates.patches;
  const effectiveSeats = seatUpdates.patches;
  const effectiveSections = sectionUpdates.patches;
  const effectiveLevels = levelUpdates.patches;
  if (effectiveObjects.length === 0 && effectiveSeats.length === 0 && effectiveSections.length === 0 && effectiveLevels.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
        warnings: state.warnings,
      }),
    };
  }

  const objectPatchById = new Map(effectiveObjects.map((entry) => [entry.id, entry.patch]));
  const seatPatchById = new Map(effectiveSeats.map((entry) => [entry.id, entry.patch]));
  const sectionPatchById = new Map(effectiveSections.map((entry) => [entry.id, entry.patch]));
  const levelPatchById = new Map(effectiveLevels.map((entry) => [entry.id, entry.patch]));

  state.nextMap.document = syncParametricRowsFromSeatPatches(
    state.nextMap.document,
    state.beforeMap.seats,
    effectiveSeats,
  );
  state.nextMap.document = syncSeatMetadataFromPatches(state.nextMap.document, effectiveSeats);

  if (objectPatchById.size > 0) {
    if (state.nextMap.document) {
      state.nextMap.document = {
        ...state.nextMap.document,
        visualElements: state.nextMap.document.visualElements.map((element) => {
          const patch = objectPatchById.get(element.id);
          if (!patch) return element;
          return patch.data
            ? { ...element, ...patch, data: { ...element.data, ...patch.data } }
            : { ...element, ...patch };
        }),
      };
    } else {
      state.nextMap.objects = state.nextMap.objects.map((object) => {
        const patch = objectPatchById.get(object.id);
        if (!patch) return object;
        return patch.data ? { ...object, ...patch, data: { ...object.data, ...patch.data } } : { ...object, ...patch };
      });
    }
  }


  if (seatPatchById.size > 0) {
    state.nextMap.seats = state.nextMap.seats.map((seat) => {
      const patch = seatPatchById.get(seat.id);
      if (!patch) return seat;
      const rowSeatSize = patch.size === null && state.nextMap.document
        ? findMapSeatOwner(state.nextMap.document, seat.id)?.row.seatSize
        : undefined;
      return {
        ...seat,
        ...patch,
        ...(patch.size === null && rowSeatSize !== undefined ? { size: rowSeatSize } : {}),
      };
    });
    updateCounts(state.nextMap);
  }

  if (sectionPatchById.size > 0) {
    if (state.nextMap.document) {
      const sectionPatches = new Map(sectionPatchById);
      state.nextMap.document = {
        ...state.nextMap.document,
        sections: state.nextMap.document.sections.map((section) => {
          const patch = sectionPatchById.get(section.id);
          return patch ? { ...section, ...patch } : section;
        }),
        visualElements: state.nextMap.document.visualElements.map((element) => {
          if (!element.sectionId) return element;
          const patch = sectionPatches.get(element.sectionId);
          if (!patch || (patch.name === undefined && !patch.color)) return element;
          return {
            ...element,
            data: {
              ...element.data,
              ...(patch.name !== undefined ? { label: patch.name } : {}),
              ...(patch.color && element.type !== 'SECTION' ? { fill: patch.color } : {}),
            },
          };
        }),
      };
    } else {
      state.nextMap.sections = state.nextMap.sections.map((section) => {
        const patch = sectionPatchById.get(section.id);
        if (!patch) return section;
        const nextSec = { ...section, ...patch };
        if (patch.name !== undefined || patch.color) {
          state.nextMap.objects = state.nextMap.objects.map((object) =>
            object.sectionId === section.id
              ? {
                  ...object,
                  data: {
                    ...object.data,
                    ...(patch.name !== undefined ? { label: patch.name } : {}),
                    ...(patch.color && object.type !== 'SECTION' ? { fill: patch.color } : {}),
                  },
                }
              : object,
          );
        }
        return nextSec;
      });
    }
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

  if (state.nextMap.document) {
    const projection = projectMapDocumentToEditorFields(state.nextMap.document, state.nextMap);
    state.nextMap.sections = projection.sections;
    state.nextMap.objects = projection.objects;
    state.nextMap.seats = projection.seats;
    updateCounts(state.nextMap);
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
    const seatOwner = map.document ? findMapSeatOwner(map.document, prev.id) : null;
    for (const key of ['x', 'y', 'size', 'rotation', 'status', 'accessible', 'publicVisible', 'technicalCode', 'displayLabel', 'rowLabel', 'seatNumber', 'objectId'] as const) {
      if (prev[key] !== next[key]) {
        const previousValue = key === 'size' && seatOwner && prev.size !== null &&
          Math.abs(prev.size - seatOwner.row.seatSize) < 0.001
          ? null
          : prev[key];
        (patch as Record<string, unknown>)[key] = previousValue;
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
