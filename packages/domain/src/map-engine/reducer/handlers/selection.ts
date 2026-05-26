import type { EventMapObjectDTO } from '../../types/event-map-types.js';
import type { MapCommand } from '../../commands/command-types.js';
import type { MapSelectionItem } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import { withDuplicateObjectLabel } from '../../layout/object-naming.js';
import {
  applyCorridorReflow,
  translateSeatCorridorBase,
  translateSectionCorridorBase,
} from '../../layout/corridor/index.js';
import {
  expandObjectSelectionItems,
  getNextGroupDisplayName,
  getObjectGroupId,
  getObjectGroupLabel,
  sanitizeGroupMembership,
  setObjectGroupData,
  validateGroupCandidates,
} from '../../layout/object-groups.js';
import { applyObjectPatchWithCorridorMetadata } from './corridor.js';
import {
  commandResult,
  createLocalId,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';

export function handleDeleteSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'DELETE_SELECTION' }>,
): MapCommandHandlerResult {
  const items = expandObjectSelectionItems(getSelectableItems(command.payload.selection), state.nextMap.objects);
  if (items.length === 0) return;

  for (const item of items) {
    if (item.type === 'seat') {
      const seat = state.nextMap.seats.find((entry) => entry.id === item.id);
      if (seat?.status === 'SOLD') break;
      state.nextMap.seats = state.nextMap.seats.filter((entry) => entry.id !== item.id);
    }

    if (item.type === 'object') {
      state.nextMap.objects = state.nextMap.objects.filter((entry) => entry.id !== item.id);
      applyCorridorReflow(state.nextMap);
    }

    if (item.type === 'section') {
      const hasSoldSeat = state.nextMap.seats.some((seat) => seat.sectionId === item.id && seat.status === 'SOLD');
      if (hasSoldSeat) break;
      state.nextMap.seats = state.nextMap.seats.filter((seat) => seat.sectionId !== item.id);
      state.nextMap.objects = state.nextMap.objects.filter((object) => object.sectionId !== item.id);
      state.nextMap.sections = state.nextMap.sections.filter((section) => section.id !== item.id);
    }

    if (item.type === 'seatgroup') {
      const removedSeatSectionIds = new Set(
        state.nextMap.seats
          .filter((s) => s.groupId === item.id)
          .map((s) => s.sectionId)
          .filter((sid): sid is string => !!sid),
      );
      state.nextMap.seatGroups = (state.nextMap.seatGroups ?? []).filter((g) => g.id !== item.id);
      state.nextMap.seats = state.nextMap.seats.filter((s) => s.groupId !== item.id);
      for (const sectionId of removedSeatSectionIds) {
        if (!state.nextMap.seats.some((s) => s.sectionId === sectionId)) {
          state.nextMap.objects = state.nextMap.objects.filter((o) => !o.sectionId || o.sectionId !== sectionId);
          state.nextMap.sections = state.nextMap.sections.filter((s) => s.id !== sectionId);
        }
      }
    }
  }

  const usedGroupIds = new Set(state.nextMap.seats.map((s) => s.groupId).filter((gid): gid is string => !!gid));
  state.nextMap.seatGroups = (state.nextMap.seatGroups ?? []).filter((g) => usedGroupIds.has(g.id));
  state.nextMap.objects = sanitizeGroupMembership(state.nextMap.objects);
  updateCounts(state.nextMap);
  state.nextSelection = [];
}

export function handleDuplicateSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'DUPLICATE_SELECTION' }>,
): MapCommandHandlerResult {
  const items = getSelectableItems(command.payload.selection);
  if (items.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }

  const created: MapSelectionItem[] = [];
  const groupIdMap = new Map<string, string>();
  const groupLabelMap = new Map<string, string>();

  for (const item of items) {
    if (item.type === 'object') {
      const object = state.nextMap.objects.find((entry) => entry.id === item.id);
      if (!object || object.locked) continue;
      if (object.sectionId && object.type === 'SECTION') continue;
      const oldGroupId = getObjectGroupId(object);
      let nextGroupId: string | null = null;
      let nextGroupLabel: string | null = null;
      if (oldGroupId) {
        if (!groupIdMap.has(oldGroupId)) {
          groupIdMap.set(oldGroupId, createLocalId('group', state.runtime));
          groupLabelMap.set(
            oldGroupId,
            getNextGroupDisplayName(state.nextMap.objects, getObjectGroupLabel(object)),
          );
        }
        nextGroupId = groupIdMap.get(oldGroupId) ?? null;
        nextGroupLabel = groupLabelMap.get(oldGroupId) ?? null;
      }
      const copy: EventMapObjectDTO = {
        ...object,
        id: createLocalId('object', state.runtime),
        x: object.x + 28,
        y: object.y + 28,
        sortOrder: state.nextMap.objects.length,
        data: setObjectGroupData(withDuplicateObjectLabel(object, state.nextMap.objects), nextGroupId, nextGroupLabel),
      };
      state.nextMap.objects.push(copy);
      created.push({ type: 'object', id: copy.id });
    }

    if (item.type === 'seat') {
      const seat = state.nextMap.seats.find((entry) => entry.id === item.id);
      if (!seat) continue;
      const copy = {
        ...seat,
        id: createLocalId('seat', state.runtime),
        technicalCode: `${seat.technicalCode}-C`,
        displayLabel: `${seat.displayLabel}C`,
        x: seat.x + 34,
        y: seat.y,
        status: 'AVAILABLE' as const,
      };
      state.nextMap.seats.push(copy);
      created.push({ type: 'seat', id: copy.id });
    }
  }

  if (created.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }
  if (
    created.some((item) => {
      if (item.type !== 'object') return false;
      return state.nextMap.objects.some((object) => object.id === item.id && object.type === 'CORRIDOR');
    })
  ) {
    applyCorridorReflow(state.nextMap);
  }
  updateCounts(state.nextMap);
  state.nextSelection = created;
}

export function handleGroupSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'GROUP_SELECTION' }>,
): MapCommandHandlerResult {
  const validation = validateGroupCandidates(getSelectableItems(command.payload.selection), state.nextMap.objects);
  if (!validation.ok) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }

  const candidates = validation.candidates;
  const groupId = createLocalId('group', state.runtime);
  const groupLabel = getNextGroupDisplayName(state.nextMap.objects);
  const memberIds = new Set(candidates.map((object) => object.id));

  state.nextMap.objects = state.nextMap.objects.map((object) =>
    memberIds.has(object.id)
      ? { ...object, data: setObjectGroupData(object.data, groupId, groupLabel) }
      : object,
  );
  state.nextMap.objects = sanitizeGroupMembership(state.nextMap.objects);
  state.nextSelection = candidates.map((object) => ({ type: 'object' as const, id: object.id }));
}

export function handleUngroupSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'UNGROUP_SELECTION' }>,
): MapCommandHandlerResult {
  const items = getSelectableItems(command.payload.selection).filter(
    (item: MapSelectionItem) => item.type === 'object',
  );
  if (items.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }

  const groupIds = new Set<string>();
  for (const item of items) {
    const object = state.nextMap.objects.find((entry) => entry.id === item.id);
    const groupId = object ? getObjectGroupId(object) : null;
    if (groupId) groupIds.add(groupId);
  }
  if (groupIds.size === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }

  state.nextMap.objects = state.nextMap.objects.map((object) => {
    const groupId = getObjectGroupId(object);
    if (groupId && groupIds.has(groupId)) {
      return { ...object, data: setObjectGroupData(object.data, null, null) };
    }
    return object;
  });
}

export function handleNudgeSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'NUDGE_SELECTION' }>,
): MapCommandHandlerResult {
  const { delta } = command.payload;
  const items = expandObjectSelectionItems(getSelectableItems(state.selection), state.nextMap.objects);
  if (items.length === 0 || (delta.x === 0 && delta.y === 0)) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }

  const movedSectionIds = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));

  for (const item of items) {
    if (item.type !== 'section') continue;

    const linkedObject = state.nextMap.objects.find((object) => object.sectionId === item.id);
    if (linkedObject && !linkedObject.locked) {
      linkedObject.x += delta.x;
      linkedObject.y += delta.y;
    }
    translateSectionCorridorBase(state.nextMap, item.id, { x: delta.x, y: delta.y });

    state.nextMap.seats = state.nextMap.seats.map((seat) => {
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
    for (const object of state.nextMap.objects) {
      if (!objectIds.has(object.id) || object.type !== 'SECTION' || !object.sectionId) continue;
      if (object.sectionId && movedSectionIds.has(object.sectionId)) continue;
      sectionDeltaById.set(object.sectionId, delta);
    }

    state.nextMap.objects = state.nextMap.objects.map((object) => {
      if (!objectIds.has(object.id)) return object;
      if (object.sectionId && movedSectionIds.has(object.sectionId)) return object;
      return applyObjectPatchWithCorridorMetadata(object, {
        x: object.x + delta.x,
        y: object.y + delta.y,
      });
    });

    for (const [sectionId, secDelta] of sectionDeltaById) {
      translateSectionCorridorBase(state.nextMap, sectionId, secDelta);
    }
  }

  if (seatIds.size > 0) {
    const seatBaseDeltas = state.nextMap.seats
      .filter((seat) => seatIds.has(seat.id) && seat.status !== 'SOLD' && !(seat.sectionId && movedSectionIds.has(seat.sectionId)))
      .map((seat) => {
        const sectionDelta = sectionDeltaById.get(seat.sectionId) ?? { x: 0, y: 0 };
        return {
          seatId: seat.id,
          sectionId: seat.sectionId,
          delta: { x: delta.x - sectionDelta.x, y: delta.y - sectionDelta.y },
        };
      });

    translateSeatCorridorBase(state.nextMap, seatBaseDeltas);

    state.nextMap.seats = state.nextMap.seats.map((seat) => {
      if (!seatIds.has(seat.id) || seat.status === 'SOLD') return seat;
      if (seat.sectionId && movedSectionIds.has(seat.sectionId)) return seat;
      return {
        ...seat,
        x: seat.x + delta.x,
        y: seat.y + delta.y,
      };
    });
  }

  applyCorridorReflow(state.nextMap);
  updateCounts(state.nextMap);
}
