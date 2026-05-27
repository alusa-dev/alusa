import type { EventMapDTO } from '../../types/event-map-types.js';
import type { MapEngineRuntime } from '../../ports/runtime-ports.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import {
  getNextGroupDisplayName,
  getObjectGroupId,
  sanitizeGroupMembership,
  setObjectGroupData,
  validateGroupCandidates,
} from '../../layout/object-groups.js';
import { cloneMap, createLocalId } from '../../reducer/reducer-context.js';

export type SelectionMutationResult = {
  map: EventMapDTO;
  selection: MapSelection;
  warnings: string[];
  blocked: boolean;
};

export function groupSelection(input: {
  map: EventMapDTO;
  selection: MapSelection;
  runtime?: MapEngineRuntime;
}): SelectionMutationResult {
  const validation = validateGroupCandidates(getSelectableItems(input.selection), input.map.objects);
  if (!validation.ok) {
    return { map: input.map, selection: input.selection, warnings: [validation.reason], blocked: true };
  }

  const nextMap = cloneMap(input.map);
  const groupId = createLocalId('group', input.runtime);
  const groupLabel = getNextGroupDisplayName(nextMap.objects);
  const memberIds = new Set(validation.candidates.map((object) => object.id));

  nextMap.objects = nextMap.objects.map((object) =>
    memberIds.has(object.id)
      ? { ...object, data: setObjectGroupData(object.data, groupId, groupLabel) }
      : object,
  );
  nextMap.objects = sanitizeGroupMembership(nextMap.objects);

  return {
    map: nextMap,
    selection: validation.candidates.map((object) => ({ type: 'object' as const, id: object.id })),
    warnings: [],
    blocked: false,
  };
}

export function ungroupSelection(input: { map: EventMapDTO; selection: MapSelection }): SelectionMutationResult {
  const groupIds = new Set<string>();

  for (const item of getSelectableItems(input.selection)) {
    if (item.type !== 'object') continue;
    const object = input.map.objects.find((entry) => entry.id === item.id);
    const groupId = object ? getObjectGroupId(object) : null;
    if (groupId) groupIds.add(groupId);
  }

  if (groupIds.size === 0) {
    return { map: input.map, selection: input.selection, warnings: ['Nenhum grupo selecionado.'], blocked: true };
  }

  const nextMap = cloneMap(input.map);
  nextMap.objects = nextMap.objects.map((object) => {
    const groupId = getObjectGroupId(object);
    if (groupId && groupIds.has(groupId)) {
      return { ...object, data: setObjectGroupData(object.data, null, null) };
    }
    return object;
  });

  return { map: nextMap, selection: input.selection, warnings: [], blocked: false };
}
