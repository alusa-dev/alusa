import type { MapCommand } from '../../commands/command-types.js';
import { deleteSelection } from '../../operations/selection/delete-selection.js';
import { duplicateSelection } from '../../operations/selection/duplicate-selection.js';
import { groupSelection, ungroupSelection } from '../../operations/selection/group-selection.js';
import { moveSelection } from '../../operations/transform/move-selection.js';
import {
  commandResult,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
} from '../reducer-context.js';
import { handleUpdateItems } from './update-items.js';

export function handleDeleteSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'DELETE_SELECTION' }>,
): MapCommandHandlerResult {
  const result = deleteSelection({ map: state.nextMap, selection: command.payload.selection });
  if (result.blocked) return;
  state.nextMap = result.map;
  state.nextSelection = result.selection;
}

export function handleDuplicateSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'DUPLICATE_SELECTION' }>,
): MapCommandHandlerResult {
  const result = duplicateSelection({
    map: state.nextMap,
    selection: command.payload.selection,
    runtime: state.runtime,
  });
  if (result.selection.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }
  state.nextMap = result.map;
  state.nextSelection = result.selection;
}

export function handleGroupSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'GROUP_SELECTION' }>,
): MapCommandHandlerResult {
  const result = groupSelection({ map: state.nextMap, selection: command.payload.selection, runtime: state.runtime });
  if (result.blocked) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }
  state.nextMap = result.map;
  state.nextSelection = result.selection;
}

export function handleUngroupSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'UNGROUP_SELECTION' }>,
): MapCommandHandlerResult {
  const result = ungroupSelection({ map: state.nextMap, selection: command.payload.selection });
  if (result.blocked) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }
  state.nextMap = result.map;
  state.nextSelection = result.selection;
}

export function handleNudgeSelection(
  state: MapCommandHandlerState,
  command: Extract<MapCommand, { type: 'NUDGE_SELECTION' }>,
): MapCommandHandlerResult {
  const { delta } = command.payload;
  const result = moveSelection({ map: state.nextMap, selection: state.selection, delta });
  if (result.patches.objects.length === 0 && result.patches.seats.length === 0 && result.patches.seatGroups.length === 0) {
    return {
      earlyReturn: commandResult({
        map: state.beforeMap,
        selection: state.selection,
        createdId: state.createdId,
        activeLevelId: state.activeLevelId,
      }),
    };
  }
  handleUpdateItems(state, {
    type: 'UPDATE_ITEMS',
    payload: {
      objects: result.patches.objects,
      seats: result.patches.seats,
      seatGroups: result.patches.seatGroups,
      skipSeatBaseLayoutTranslation: true,
    },
  });
}
