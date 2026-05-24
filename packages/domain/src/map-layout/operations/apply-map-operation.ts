import type { MapOperation } from './types.js';
import type { MapLayoutState, MapLayoutResult } from '../state/types.js';
import { relabelGroup } from '../seat-groups/derive-seats.js';
import { normalizeCorridor } from '../corridors/normalize-corridor.js';
import { createSeatGroup } from '../seat-groups/create-seat-group.js';

export function applyMapOperation(
  state: MapLayoutState,
  op: MapOperation,
): MapLayoutResult {
  switch (op.kind) {
    case 'CREATE_SEAT_GROUP': {
      const exists = state.seatGroups.has(op.group.id);
      if (exists) return { state, warnings: [{ code: 'DUPLICATE_ID', entityId: op.group.id }] };

      const nextGroups = new Map(state.seatGroups);
      nextGroups.set(op.group.id, op.group);
      const nextSeats = new Map(state.seats);
      for (const seat of (op.seats ?? [])) {
        nextSeats.set(seat.id, seat);
      }
      return { state: { ...state, seatGroups: nextGroups, seats: nextSeats }, warnings: [] };
    }

    case 'MOVE_SEAT_GROUP': {
      const group = state.seatGroups.get(op.groupId);
      if (!group) return stateUnchanged(state, `SEAT_GROUP_NOT_FOUND:${op.groupId}`);

      const nextGroups = new Map(state.seatGroups);
      nextGroups.set(op.groupId, { ...group, x: op.to.x, y: op.to.y });
      return { state: { ...state, seatGroups: nextGroups }, warnings: [] };
    }

    case 'REPARAMETRIZE_SEAT_GROUP': {
      const group = state.seatGroups.get(op.groupId);
      if (!group) return stateUnchanged(state, `SEAT_GROUP_NOT_FOUND:${op.groupId}`);

      const nextGroup = { ...group, ...op.patch };
      const nextGroups = new Map(state.seatGroups);
      nextGroups.set(op.groupId, nextGroup);
      return { state: { ...state, seatGroups: nextGroups }, warnings: [] };
    }

    case 'RELABEL_SEAT_GROUP': {
      const group = state.seatGroups.get(op.groupId);
      if (!group) return stateUnchanged(state, `SEAT_GROUP_NOT_FOUND:${op.groupId}`);

      const seats = [...state.seats.values()].filter((s) => s.groupId === op.groupId);
      const updatedGroup = { ...group, numbering: op.numbering };
      const relabeled = relabelGroup(updatedGroup, seats);

      const nextGroups = new Map(state.seatGroups);
      nextGroups.set(op.groupId, updatedGroup);
      const nextSeats = new Map(state.seats);
      for (const seat of relabeled) nextSeats.set(seat.id, seat);

      return { state: { ...state, seatGroups: nextGroups, seats: nextSeats }, warnings: [] };
    }

    case 'DELETE_SEAT_GROUP': {
      const nextGroups = new Map(state.seatGroups);
      nextGroups.delete(op.groupId);
      const nextSeats = new Map(state.seats);
      for (const [id, seat] of state.seats) {
        if (seat.groupId === op.groupId) nextSeats.delete(id);
      }
      return { state: { ...state, seatGroups: nextGroups, seats: nextSeats }, warnings: [] };
    }

    case 'OVERRIDE_SEAT': {
      const seat = state.seats.get(op.seatId);
      if (!seat) return stateUnchanged(state, `SEAT_NOT_FOUND:${op.seatId}`);

      const nextSeats = new Map(state.seats);
      nextSeats.set(op.seatId, { ...seat, manualOverride: { ...seat.manualOverride, ...op.override } });
      return { state: { ...state, seats: nextSeats }, warnings: [] };
    }

    case 'CREATE_CORRIDOR': {
      const normalized = normalizeCorridor(op.corridor);
      const nextCorridors = new Map(state.corridors);
      nextCorridors.set(normalized.id, normalized);
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'MOVE_CORRIDOR': {
      const corridor = state.corridors.get(op.corridorId);
      if (!corridor) return stateUnchanged(state, `CORRIDOR_NOT_FOUND:${op.corridorId}`);

      const nextCorridors = new Map(state.corridors);
      nextCorridors.set(op.corridorId, { ...corridor, x: op.to.x, y: op.to.y });
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'UPDATE_CORRIDOR': {
      const corridor = state.corridors.get(op.corridorId);
      if (!corridor) return stateUnchanged(state, `CORRIDOR_NOT_FOUND:${op.corridorId}`);

      const updated = normalizeCorridor({ ...corridor, ...op.patch });
      const nextCorridors = new Map(state.corridors);
      nextCorridors.set(op.corridorId, updated);
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'RESIZE_CORRIDOR_EDGE': {
      const corridor = state.corridors.get(op.corridorId);
      if (!corridor) return stateUnchanged(state, `CORRIDOR_NOT_FOUND:${op.corridorId}`);

      const isVertical = op.bounds.height >= op.bounds.width;
      const updated = normalizeCorridor({
        ...corridor,
        x: op.bounds.x,
        y: op.bounds.y,
        thickness: isVertical ? op.bounds.width : op.bounds.height,
        length: isVertical ? op.bounds.height : op.bounds.width,
        rotation: op.rotation,
        axis: isVertical ? 'VERTICAL' : 'HORIZONTAL',
      });
      const nextCorridors = new Map(state.corridors);
      nextCorridors.set(op.corridorId, updated);
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'ROTATE_CORRIDOR': {
      const corridor = state.corridors.get(op.corridorId);
      if (!corridor) return stateUnchanged(state, `CORRIDOR_NOT_FOUND:${op.corridorId}`);

      const isVertical = op.bounds.height >= op.bounds.width;
      const updated = normalizeCorridor({
        ...corridor,
        x: op.bounds.x,
        y: op.bounds.y,
        thickness: isVertical ? op.bounds.width : op.bounds.height,
        length: isVertical ? op.bounds.height : op.bounds.width,
        rotation: op.rotation,
      });
      const nextCorridors = new Map(state.corridors);
      nextCorridors.set(op.corridorId, updated);
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'TRANSFORM_CORRIDOR_GROUP': {
      const nextCorridors = new Map(state.corridors);
      for (const patch of op.patches) {
        const corridor = state.corridors.get(patch.corridorId);
        if (!corridor) continue;
        const isVertical = patch.bounds.height >= patch.bounds.width;
        nextCorridors.set(
          patch.corridorId,
          normalizeCorridor({
            ...corridor,
            x: patch.bounds.x,
            y: patch.bounds.y,
            thickness: isVertical ? patch.bounds.width : patch.bounds.height,
            length: isVertical ? patch.bounds.height : patch.bounds.width,
            rotation: patch.rotation,
            axis: isVertical ? 'VERTICAL' : 'HORIZONTAL',
          }),
        );
      }
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'DELETE_CORRIDOR': {
      const nextCorridors = new Map(state.corridors);
      nextCorridors.delete(op.corridorId);
      return { state: { ...state, corridors: nextCorridors }, warnings: [] };
    }

    case 'RESIZE_SEAT_GROUP': {
      const group = state.seatGroups.get(op.groupId);
      if (!group) return stateUnchanged(state, `SEAT_GROUP_NOT_FOUND:${op.groupId}`);

      const newRows = op.rows ?? group.rows;
      const newCols = op.columns ?? group.columns;
      if (newRows === group.rows && newCols === group.columns) {
        return { state, warnings: [] };
      }

      const updatedGroup = { ...group, rows: newRows, columns: newCols };
      const { seats: allNewSeats } = createSeatGroup({ ...updatedGroup });

      const nextGroups = new Map(state.seatGroups);
      nextGroups.set(op.groupId, updatedGroup);
      const nextSeats = new Map(state.seats);

      // Remove seats that are out of new bounds
      for (const [id, seat] of state.seats) {
        if (seat.groupId === op.groupId) {
          if (seat.rowIndex < newRows && seat.columnIndex < newCols) {
            // keep with any existing manualOverride
          } else {
            nextSeats.delete(id);
          }
        }
      }

      // Add new seats that did not exist
      for (const seat of allNewSeats) {
        if (!state.seats.has(seat.id)) {
          nextSeats.set(seat.id, seat);
        }
      }

      return { state: { ...state, seatGroups: nextGroups, seats: nextSeats }, warnings: [] };
    }

    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return stateUnchanged(state, 'UNKNOWN_OPERATION');
    }
  }
}

function stateUnchanged(state: MapLayoutState, warningCode: string): MapLayoutResult {
  return { state, warnings: [{ code: warningCode }] };
}
