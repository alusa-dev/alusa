import type { MapCommand } from '../../commands/command-types.js';
import { applyCorridorReflow } from '../../layout/corridor/index.js';
import {
  applyMapLevels,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';

export function handleRestoreDeletedItems(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'RESTORE_DELETED_ITEMS' }>,
): MapCommandHandlerResult {
  const { objects, seats, sections, levels, seatGroups = [] } = command.payload;
  for (const level of levels) {
    if (!state.nextMap.levels.some((l) => l.id === level.id)) {
      state.nextMap.levels.push(level);
    }
  }
  applyMapLevels(state.nextMap);
  for (const section of sections) {
    if (!state.nextMap.sections.some((s) => s.id === section.id)) {
      state.nextMap.sections.push(section);
    }
  }
  for (const object of objects) {
    if (!state.nextMap.objects.some((o) => o.id === object.id)) {
      state.nextMap.objects.push(object);
    }
  }
  state.nextMap.seatGroups = state.nextMap.seatGroups ?? [];
  for (const group of seatGroups) {
    if (!state.nextMap.seatGroups.some((g) => g.id === group.id)) {
      state.nextMap.seatGroups.push(group);
    }
  }
  for (const seat of seats) {
    if (!state.nextMap.seats.some((s) => s.id === seat.id)) {
      state.nextMap.seats.push(seat);
    }
  }
  applyCorridorReflow(state.nextMap);
  updateCounts(state.nextMap);
}

export function handleRestoreObjectGroups(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'RESTORE_OBJECT_GROUPS' }>,
): MapCommandHandlerResult {
  const { objects } = command.payload;
  const objectMap = new Map(objects.map((o) => [o.id, o.prevData]));
  state.nextMap.objects = state.nextMap.objects.map((object) => {
    if (objectMap.has(object.id)) {
      return {
        ...object,
        data: { ...objectMap.get(object.id) },
      };
    }
    return object;
  });
}
