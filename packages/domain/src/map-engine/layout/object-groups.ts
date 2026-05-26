import type { EventMapObjectDTO } from '../types/event-map-types.js';

import { getSelectableItems, selectionKey, type MapSelectionItem } from '../selection/selection-utils.js';

export const OBJECT_GROUP_ID_KEY = 'groupId';
export const OBJECT_GROUP_LABEL_KEY = 'groupLabel';

export function getObjectGroupId(object: EventMapObjectDTO) {
  const value = object.data[OBJECT_GROUP_ID_KEY];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function getObjectGroupLabel(object: EventMapObjectDTO) {
  const value = object.data[OBJECT_GROUP_LABEL_KEY];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function isTextObject(object: EventMapObjectDTO) {
  return object.type === 'TEXT';
}

export function canGroupObject(object: EventMapObjectDTO) {
  return !object.locked && !object.sectionId && object.type !== 'SECTION';
}

export type GroupValidationResult =
  | { ok: true; candidates: EventMapObjectDTO[] }
  | { ok: false; reason: string };

export function validateGroupCandidates(items: MapSelectionItem[], objects: EventMapObjectDTO[]): GroupValidationResult {
  const objectItems = items.filter((item) => item.type === 'object');
  if (objectItems.length < 2) {
    return { ok: false, reason: 'Selecione pelo menos dois objetos para agrupar.' };
  }

  const candidates = objectItems
    .map((item) => objects.find((object) => object.id === item.id))
    .filter((object): object is EventMapObjectDTO => Boolean(object && canGroupObject(object)));

  if (candidates.length < 2) {
    return { ok: false, reason: 'Objetos bloqueados, vinculados a setores ou inválidos não podem ser agrupados.' };
  }

  const levelId = candidates[0]?.levelId;
  if (!levelId || candidates.some((object) => object.levelId !== levelId)) {
    return { ok: false, reason: 'Só é possível agrupar objetos do mesmo plano.' };
  }

  return { ok: true, candidates };
}

/** Removes group metadata when a group has fewer than two members. */
export function sanitizeGroupMembership(objects: EventMapObjectDTO[]) {
  const membersByGroup = new Map<string, string[]>();

  for (const object of objects) {
    const groupId = getObjectGroupId(object);
    if (!groupId) continue;
    const members = membersByGroup.get(groupId) ?? [];
    members.push(object.id);
    membersByGroup.set(groupId, members);
  }

  const orphanIds = new Set<string>();
  for (const memberIds of membersByGroup.values()) {
    if (memberIds.length < 2) {
      memberIds.forEach((id) => orphanIds.add(id));
    }
  }

  if (orphanIds.size === 0) return objects;

  return objects.map((object) =>
    orphanIds.has(object.id)
      ? { ...object, data: setObjectGroupData(object.data, null, null) }
      : object,
  );
}

export function selectionHasMixedTextAndShapes(objects: EventMapObjectDTO[], objectIds: string[]) {
  let hasText = false;
  let hasShape = false;

  for (const id of objectIds) {
    const object = objects.find((entry) => entry.id === id);
    if (!object) continue;
    if (isTextObject(object)) hasText = true;
    else hasShape = true;
    if (hasText && hasShape) return true;
  }

  return false;
}

export function setObjectGroupData(
  data: Record<string, unknown>,
  groupId: string | null,
  groupLabel: string | null,
) {
  const next = { ...data };
  if (groupId) {
    next[OBJECT_GROUP_ID_KEY] = groupId;
    if (groupLabel) next[OBJECT_GROUP_LABEL_KEY] = groupLabel;
  } else {
    delete next[OBJECT_GROUP_ID_KEY];
    delete next[OBJECT_GROUP_LABEL_KEY];
  }
  return next;
}

export function getGroupMemberIds(objects: EventMapObjectDTO[], groupId: string) {
  return objects.filter((object) => getObjectGroupId(object) === groupId).map((object) => object.id);
}

export function getGroupLabel(objects: EventMapObjectDTO[], groupId: string) {
  const member = objects.find((object) => getObjectGroupId(object) === groupId);
  return getObjectGroupLabel(member ?? { data: {} } as EventMapObjectDTO) ?? 'Grupo 01';
}

export function parseGroupLabel(label: string) {
  const match = label.trim().match(/^Grupo\s+(0*)(\d+)$/i);
  if (!match) return null;

  const [, leadingZeros, digits] = match;
  return {
    index: Number(digits),
    padWidth: Math.max(2, leadingZeros.length + digits.length),
  };
}

export function formatGroupDisplayName(index: number, padWidth = 2) {
  return `Grupo ${String(index).padStart(padWidth, '0')}`;
}

function collectGroupLabelIndexes(objects: EventMapObjectDTO[]) {
  const indexes = new Set<number>();

  for (const object of objects) {
    const label = getObjectGroupLabel(object);
    if (!label) continue;
    const parsed = parseGroupLabel(label);
    if (parsed) indexes.add(parsed.index);
  }

  return indexes;
}

export function getNextGroupDisplayName(objects: EventMapObjectDTO[], sourceLabel?: string | null) {
  const existingIndexes = collectGroupLabelIndexes(objects);
  const source = sourceLabel ? parseGroupLabel(sourceLabel) : null;
  const padWidth = source?.padWidth ?? 2;

  let nextIndex = source
    ? source.index + 1
    : existingIndexes.size > 0
      ? Math.max(...existingIndexes) + 1
      : 1;

  while (existingIndexes.has(nextIndex)) nextIndex += 1;

  return formatGroupDisplayName(nextIndex, padWidth);
}

export function resolveGroupSelectionItem(
  item: MapSelectionItem,
  objects: EventMapObjectDTO[],
): MapSelectionItem[] {
  if (item.type !== 'object') return [item];

  const object = objects.find((entry) => entry.id === item.id);
  if (!object) return [item];

  const groupId = getObjectGroupId(object);
  if (!groupId) return [item];

  return getGroupMemberIds(objects, groupId).map((id) => ({ type: 'object' as const, id }));
}

export function expandObjectSelectionItems(
  items: MapSelectionItem[],
  objects: EventMapObjectDTO[],
): MapSelectionItem[] {
  const expanded: MapSelectionItem[] = [];
  const seen = new Set<string>();
  const expandedGroupIds = new Set<string>();

  for (const item of items) {
    if (item.type !== 'object') {
      const key = selectionKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push(item);
      continue;
    }

    const object = objects.find((entry) => entry.id === item.id);
    const groupId = object ? getObjectGroupId(object) : null;
    if (groupId) {
      if (expandedGroupIds.has(groupId)) continue;
      expandedGroupIds.add(groupId);
      for (const id of getGroupMemberIds(objects, groupId)) {
        const key = `object:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        expanded.push({ type: 'object', id });
      }
      continue;
    }

    const key = selectionKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    expanded.push(item);
  }

  return expanded;
}

export function isObjectInSelectedGroup(
  object: EventMapObjectDTO,
  selection: MapSelectionItem[],
  objects: EventMapObjectDTO[],
) {
  const groupId = getObjectGroupId(object);
  if (!groupId) return false;

  return getGroupMemberIds(objects, groupId).some((id) =>
    selection.some((item) => item.type === 'object' && item.id === id),
  );
}

export function resolveDragTarget(
  nodeId: string,
  item: MapSelectionItem | undefined,
  selection: MapSelectionItem[],
  objects: EventMapObjectDTO[],
) {
  const expandedSelection = expandObjectSelectionItems(getSelectableItems(selection), objects);
  const expandedNodeIds = expandedSelection.flatMap((entry) => {
    if (entry.type === 'object' || entry.type === 'seat') return [`node-${entry.id}`];
    if (entry.type === 'seatgroup') return [`node-seatgroup-${entry.id}`];
    return [];
  });

  if (item && expandedNodeIds.includes(nodeId) && expandedNodeIds.length > 1) {
    return { selectionItems: expandedSelection, nodeIds: expandedNodeIds };
  }

  if (item?.type === 'object') {
    const groupItems = resolveGroupSelectionItem(item, objects);
    if (groupItems.length > 1) {
      return {
        selectionItems: groupItems,
        nodeIds: groupItems.map((entry) => `node-${entry.id}`),
      };
    }
  }

  const selectionItems =
    item && (item.type === 'object' || item.type === 'seat' || item.type === 'seatgroup')
      ? [item]
      : getSelectableItems(selection);

  return { selectionItems, nodeIds: [nodeId] };
}
