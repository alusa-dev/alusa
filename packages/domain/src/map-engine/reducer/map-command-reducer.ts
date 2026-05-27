import type { EventMapDTO } from '../types/event-map-types.js';
import type { MapCommand } from '../commands/command-types.js';
import type { MapEngineRuntime } from '../ports/runtime-ports.js';
import type { MapSelection } from '../selection/selection-utils.js';
import { normalizeTextData } from '../doc/text-object.js';
import { rotateSelection } from '../operations/transform/rotate-selection.js';
import { moveSelection } from '../operations/transform/move-selection.js';
import { resizeSelection } from '../operations/transform/resize-selection.js';
import { selectionFromRotationPatchIds } from '../operations/transform/rotate-selection.js';
import {
  handleAddLevel,
  handleAddObject,
  handleAddRow,
  handleAddSeatGrid,
  handleDeleteLevel,
} from './handlers/add-entities.js';
import { handleRestoreDeletedItems, handleRestoreObjectGroups } from './handlers/restore.js';
import {
  handleDeleteSelection,
  handleDuplicateSelection,
  handleGroupSelection,
  handleNudgeSelection,
  handleUngroupSelection,
} from './handlers/selection.js';
import { handleDeleteSeatGroup, handleUpdateSeatGroup } from './handlers/seat-group.js';
import { buildUndoUpdateItems, handleUpdateItems } from './handlers/update-items.js';
import {
  cloneMap,
  commandResult,
  type CommandResult,
  type ExecuteMapCommandContext,
  type MapCommandHandlerResult,
  type MapCommandHandlerState,
} from './reducer-context.js';

export type { CommandResult, ExecuteMapCommandContext } from './reducer-context.js';

function normalizeMapCommand(command: MapCommand, map: EventMapDTO): MapCommand {
  switch (command.type) {
    case 'UPDATE_OBJECT':
      return {
        type: 'UPDATE_ITEMS',
        payload: { objects: [{ id: command.payload.id, patch: command.payload.patch }] },
      };

    case 'MOVE_OBJECTS': {
      const { delta, objectIds = [], seatIds = [] } = command.payload;
      const selection = [
        ...objectIds.map((id) => ({ type: 'object' as const, id })),
        ...seatIds.map((id) => ({ type: 'seat' as const, id })),
      ];
      const movement = moveSelection({ map, selection, delta });
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: movement.patches.objects,
          seats: movement.patches.seats,
          seatGroups: movement.patches.seatGroups,
          skipSeatBaseLayoutTranslation: true,
        },
      };
    }

    case 'MOVE_SELECTION': {
      const movement = moveSelection({
        map,
        selection: command.payload.selection,
        delta: command.payload.delta,
      });
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: movement.patches.objects,
          seats: movement.patches.seats,
          seatGroups: movement.patches.seatGroups,
          skipSeatBaseLayoutTranslation: true,
        },
      };
    }

    case 'RESIZE_SELECTION': {
      const resized = resizeSelection({
        map,
        selection: command.payload.selection,
        scaleX: command.payload.scaleX,
        scaleY: command.payload.scaleY,
        pivot: command.payload.pivot,
        patches: {
          objects: command.payload.objects,
          seats: command.payload.seats,
          seatGroups: command.payload.seatGroups,
        },
      });
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: resized.patches.objects,
          seats: resized.patches.seats,
          seatGroups: resized.patches.seatGroups,
          skipSeatBaseLayoutTranslation: command.payload.skipSeatBaseLayoutTranslation ?? true,
          skipCorridorReflow: command.payload.skipCorridorReflow,
        },
      };
    }

    case 'RESIZE_OBJECTS': {
      const selection = selectionFromRotationPatchIds({
        objects: command.payload.objects ?? [],
        seats: command.payload.seats ?? [],
        seatGroups: command.payload.seatGroups ?? [],
      });
      const resized = resizeSelection({
        map,
        selection,
        patches: {
          objects: command.payload.objects ?? [],
          seats: command.payload.seats ?? [],
          seatGroups: command.payload.seatGroups ?? [],
        },
      });
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: resized.patches.objects,
          seats: resized.patches.seats,
          seatGroups: resized.patches.seatGroups,
          skipSeatBaseLayoutTranslation: command.payload.skipSeatBaseLayoutTranslation,
          skipCorridorReflow: command.payload.skipCorridorReflow,
        },
      };
    }

    case 'ROTATE_OBJECTS':
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: command.payload.objects,
          seats: command.payload.seats,
        },
      };

    case 'ROTATE_SELECTION': {
      const rotation = rotateSelection({
        map,
        selection: command.payload.selection,
        angleDelta: command.payload.angleDelta,
        pivot: command.payload.pivot,
        mode: command.payload.mode,
        snapStepDegrees: command.payload.snapStepDegrees,
      });
      return {
        type: 'UPDATE_ITEMS',
        payload: {
          objects: rotation.patches.objects,
          seats: rotation.patches.seats,
          seatGroups: rotation.patches.seatGroups,
          skipCorridorReflow: true,
          skipSeatBaseLayoutTranslation: true,
        },
      };
    }

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
          seatGroups: command.payload.seatGroups,
          skipSeatBaseLayoutTranslation: command.payload.skipSeatBaseLayoutTranslation,
          skipCorridorReflow: command.payload.skipCorridorReflow,
        },
      };

    default:
      return command;
  }
}

function applyHandlerResult(
  _state: MapCommandHandlerState,
  result: MapCommandHandlerResult,
): CommandResult | null {
  if (result && 'earlyReturn' in result) {
    return {
      ...result.earlyReturn,
      patches: [],
      inversePatches: result.earlyReturn.undoCommand ? [result.earlyReturn.undoCommand] : [],
    };
  }
  return null;
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
  const state: MapCommandHandlerState = {
    beforeMap: map,
    nextMap,
    selection,
    nextSelection: [...selection],
    activeLevelId,
    nextActiveLevelId: activeLevelId,
    createdId: null,
    runtime,
  };

  let handlerEarlyReturn: CommandResult | null = null;

  switch (normalizedCommand.type) {
    case 'ADD_OBJECT':
      handleAddObject(state, normalizedCommand);
      break;
    case 'DELETE_SELECTION':
      handleDeleteSelection(state, normalizedCommand);
      break;
    case 'UPDATE_ITEMS':
      handlerEarlyReturn = applyHandlerResult(state, handleUpdateItems(state, normalizedCommand));
      break;
    case 'ADD_LEVEL':
      handleAddLevel(state, normalizedCommand);
      break;
    case 'DELETE_LEVEL':
      handleDeleteLevel(state, normalizedCommand);
      break;
    case 'ADD_ROW':
      handleAddRow(state, normalizedCommand);
      break;
    case 'ADD_SEAT_GRID':
      handleAddSeatGrid(state, normalizedCommand);
      break;
    case 'DUPLICATE_SELECTION':
      handlerEarlyReturn = applyHandlerResult(state, handleDuplicateSelection(state, normalizedCommand));
      break;
    case 'GROUP_SELECTION':
      handlerEarlyReturn = applyHandlerResult(state, handleGroupSelection(state, normalizedCommand));
      break;
    case 'UNGROUP_SELECTION':
      handlerEarlyReturn = applyHandlerResult(state, handleUngroupSelection(state, normalizedCommand));
      break;
    case 'NUDGE_SELECTION':
      handlerEarlyReturn = applyHandlerResult(state, handleNudgeSelection(state, normalizedCommand));
      break;
    case 'UPDATE_SEAT_GROUP':
      handleUpdateSeatGroup(state, normalizedCommand);
      break;
    case 'DELETE_SEAT_GROUP':
      handleDeleteSeatGroup(state, normalizedCommand);
      break;
    case 'RESTORE_DELETED_ITEMS':
      handleRestoreDeletedItems(state, normalizedCommand);
      break;
    case 'RESTORE_OBJECT_GROUPS':
      handleRestoreObjectGroups(state, normalizedCommand);
      break;
    default:
      break;
  }

  if (handlerEarlyReturn) {
    return handlerEarlyReturn;
  }

  let undoCommand: MapCommand | null = null;

  switch (normalizedCommand.type) {
    case 'ADD_OBJECT': {
      const tool = normalizedCommand.payload.tool;
      const targetId = state.createdId || normalizedCommand.payload.id;
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: [
            {
              type: tool === 'section' ? ('section' as const) : tool === 'seat' ? ('seat' as const) : ('object' as const),
              id: targetId,
            },
          ],
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
          objects: map.objects.filter((o) => !state.nextMap.objects.some((no) => no.id === o.id)),
          seats: map.seats.filter((s) => !state.nextMap.seats.some((ns) => ns.id === s.id)),
          sections: map.sections.filter((s) => !state.nextMap.sections.some((ns) => ns.id === s.id)),
          levels: map.levels.filter((l) => !state.nextMap.levels.some((nl) => nl.id === l.id)),
          seatGroups: (map.seatGroups ?? []).filter((g) => !(state.nextMap.seatGroups ?? []).some((ng) => ng.id === g.id)),
        },
      };
      break;
    }
    case 'UPDATE_ITEMS': {
      undoCommand = buildUndoUpdateItems(map, state.nextMap);
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
      const addedSeatIds = state.nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id)).map((ns) => ns.id);
      undoCommand = {
        type: 'DELETE_SELECTION',
        payload: {
          selection: addedSeatIds.map((id) => ({ type: 'seat' as const, id })),
        },
      };
      break;
    }
    case 'ADD_SEAT_GRID': {
      const addedSeats = state.nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id));
      const addedSections = state.nextMap.sections.filter((ns) => !map.sections.some((s) => s.id === ns.id));
      const addedObjects = state.nextMap.objects.filter((no) => !map.objects.some((o) => o.id === no.id));
      const addedGroups = (state.nextMap.seatGroups ?? []).filter((ng) => !(map.seatGroups ?? []).some((g) => g.id === ng.id));

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
      const addedSeats = state.nextMap.seats.filter((ns) => !map.seats.some((s) => s.id === ns.id));
      const addedObjects = state.nextMap.objects.filter((no) => !map.objects.some((o) => o.id === no.id));
      const addedSections = state.nextMap.sections.filter((ns) => !map.sections.some((s) => s.id === ns.id));
      const addedSeatGroups = (state.nextMap.seatGroups ?? []).filter((ng) => !(map.seatGroups ?? []).some((g) => g.id === ng.id));

      const selectionToDelete: MapSelection = [
        ...addedSections.map((s) => ({ type: 'section' as const, id: s.id })),
        ...addedSeats.map((s) => ({ type: 'seat' as const, id: s.id })),
        ...addedObjects.map((o) => ({ type: 'object' as const, id: o.id })),
        ...addedSeatGroups.map((g) => ({ type: 'seatgroup' as const, id: g.id })),
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
      undoCommand = {
        type: 'RESTORE_OBJECT_GROUPS',
        payload: {
          objects: map.objects
            .filter((object) => {
              const next = state.nextMap.objects.find((candidate) => candidate.id === object.id);
              return next && JSON.stringify(next.data) !== JSON.stringify(object.data);
            })
            .map((object) => ({
              id: object.id,
              prevData: { ...object.data },
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
      undoCommand = buildUndoUpdateItems(map, state.nextMap);
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
    map: state.nextMap,
    selection: state.nextSelection,
    createdId: state.createdId,
    activeLevelId: state.nextActiveLevelId,
    undoCommand,
    patches: [normalizedCommand],
  });
}
