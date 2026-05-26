import type { EventMapDTO, EventSeatGroupDTO } from '../../types/event-map-types.js';
import type { MapCommand } from '../../commands/command-types.js';
import { applyCorridorReflow } from '../../layout/corridor/index.js';
import { applySeatGroupLayoutPatch } from '../../layout/seat-group-transform.js';
import {
  createLocalId,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
  updateCounts,
} from '../reducer-context.js';

export function applySeatGroupPatch(
  nextMap: EventMapDTO,
  id: string,
  patch: Partial<EventSeatGroupDTO>,
  runtime?: import('../../ports/runtime-ports.js').MapEngineRuntime,
) {
  const updated = applySeatGroupLayoutPatch(nextMap, id, patch, {
    createSeatId: () => createLocalId('seat', runtime),
  });
  if (updated === nextMap) return false;
  nextMap.seats = updated.seats;
  nextMap.seatGroups = updated.seatGroups;
  return true;
}

export function handleUpdateSeatGroup(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'UPDATE_SEAT_GROUP' }>,
): MapCommandHandlerResult {
  const { id, patch } = command.payload;
  if (applySeatGroupPatch(state.nextMap, id, patch, state.runtime)) {
    updateCounts(state.nextMap);
    applyCorridorReflow(state.nextMap);
  }
}

export function handleDeleteSeatGroup(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'DELETE_SEAT_GROUP' }>,
): MapCommandHandlerResult {
  const { id } = command.payload;
  const removedSeatSectionIds = new Set(
    state.nextMap.seats
      .filter((s) => s.groupId === id)
      .map((s) => s.sectionId)
      .filter((sid): sid is string => !!sid),
  );
  state.nextMap.seatGroups = (state.nextMap.seatGroups ?? []).filter((g) => g.id !== id);
  state.nextMap.seats = state.nextMap.seats.filter((s) => s.groupId !== id);
  for (const sectionId of removedSeatSectionIds) {
    if (!state.nextMap.seats.some((s) => s.sectionId === sectionId)) {
      state.nextMap.objects = state.nextMap.objects.filter((o) => !o.sectionId || o.sectionId !== sectionId);
      state.nextMap.sections = state.nextMap.sections.filter((s) => s.id !== sectionId);
    }
  }
  updateCounts(state.nextMap);
  state.nextSelection = [];
}
