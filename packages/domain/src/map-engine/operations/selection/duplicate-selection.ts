import type {
  EventMapDTO,
  EventMapObjectDTO,
  EventMapSectionDTO,
  EventSeatDTO,
  EventSeatGroupDTO,
} from '../../types/event-map-types.js';
import type { MapEngineRuntime } from '../../ports/runtime-ports.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import type { MapSelection, MapSelectionItem } from '../../selection/selection-utils.js';
import { findSeatGroupForSection } from '../../selection/seated-sector.js';
import { applyCorridorReflow } from '../../layout/corridor/index.js';
import {
  computeSeatGridSeatLabel,
  suggestNextSeatGroupNumbering,
} from '../../layout/seat-grid.js';
import {
  expandObjectSelectionItems,
  getNextGroupDisplayName,
  getObjectGroupId,
  getObjectGroupLabel,
  setObjectGroupData,
} from '../../layout/object-groups.js';
import { withDuplicateObjectLabel } from '../../layout/object-naming.js';
import { cloneMap, createLocalId, updateCounts } from '../../reducer/reducer-context.js';

export type DuplicateSelectionInput = {
  map: EventMapDTO;
  selection: MapSelection;
  offset?: { x: number; y: number };
  runtime?: MapEngineRuntime;
};

export type DuplicateSelectionResult = {
  map: EventMapDTO;
  selection: MapSelection;
  warnings: string[];
};

export type DuplicateSelectionValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function collectSeatGroupIdsInSelection(map: EventMapDTO, items: MapSelectionItem[]) {
  const seatGroupIds = new Set<string>();

  for (const item of items) {
    if (item.type === 'seatgroup') {
      seatGroupIds.add(item.id);
      continue;
    }

    if (item.type === 'section') {
      const seatGroup = findSeatGroupForSection(map, item.id);
      if (seatGroup) seatGroupIds.add(seatGroup.id);
      continue;
    }

    if (item.type === 'seat') {
      const seat = map.seats.find((entry) => entry.id === item.id);
      if (seat?.groupId) seatGroupIds.add(seat.groupId);
      continue;
    }

    if (item.type === 'object') {
      const object = map.objects.find((entry) => entry.id === item.id);
      if (object?.type === 'SECTION' && object.sectionId) {
        const seatGroup = findSeatGroupForSection(map, object.sectionId);
        if (seatGroup) seatGroupIds.add(seatGroup.id);
      }
    }
  }

  return seatGroupIds;
}

export function validateDuplicateSelection(
  map: EventMapDTO,
  selection: MapSelection,
): DuplicateSelectionValidationResult {
  const items = expandObjectSelectionItems(getSelectableItems(selection), map.objects);
  const seatGroupIds = collectSeatGroupIdsInSelection(map, items);

  if (seatGroupIds.size >= 2) {
    return {
      ok: false,
      reason: 'Selecione apenas um grupo de assentos para duplicar.',
    };
  }

  return { ok: true };
}

function duplicateTechnicalCode(existing: Set<string>, base: string) {
  let index = 1;
  let code = `${base}-C`;
  while (existing.has(code)) {
    index += 1;
    code = `${base}-C${index}`;
  }
  existing.add(code);
  return code;
}

function reserveTechnicalCode(existing: Set<string>, sectionCode: string, displayLabel: string) {
  let technicalCode = `${sectionCode}-${displayLabel}`;
  let suffix = 0;
  while (existing.has(technicalCode)) {
    suffix += 1;
    technicalCode = `${sectionCode}-${displayLabel}-${suffix}`;
  }
  existing.add(technicalCode);
  return technicalCode;
}

export function duplicateSelection(input: DuplicateSelectionInput): DuplicateSelectionResult {
  const items = expandObjectSelectionItems(getSelectableItems(input.selection), input.map.objects);
  const validation = validateDuplicateSelection(input.map, input.selection);
  if (!validation.ok) {
    return {
      map: input.map,
      selection: [],
      warnings: [validation.reason],
    };
  }

  const offset = input.offset ?? { x: 28, y: 28 };
  const nextMap = cloneMap(input.map);
  const created: MapSelectionItem[] = [];
  const warnings: string[] = [];
  const groupIdMap = new Map<string, string>();
  const groupLabelMap = new Map<string, string>();
  const sectionIdMap = new Map<string, string>();
  const objectIdMap = new Map<string, string>();
  const seatGroupIdMap = new Map<string, string>();
  const technicalCodes = new Set(nextMap.seats.map((seat) => seat.technicalCode));

  const selectedSectionIds = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));
  const selectedSeatGroupIds = new Set(items.filter((item) => item.type === 'seatgroup').map((item) => item.id));

  function duplicateSection(sectionId: string) {
    if (sectionIdMap.has(sectionId)) return sectionIdMap.get(sectionId)!;
    const section = nextMap.sections.find((entry) => entry.id === sectionId);
    if (!section) return sectionId;
    const nextSectionId = createLocalId('section', input.runtime);
    sectionIdMap.set(sectionId, nextSectionId);
    const copy: EventMapSectionDTO = {
      ...section,
      id: nextSectionId,
      name: `${section.name} (cópia)`,
    };
    nextMap.sections.push(copy);
    created.push({ type: 'section', id: nextSectionId });
    return nextSectionId;
  }

  function duplicateGroupId(object: EventMapObjectDTO) {
    const oldGroupId = getObjectGroupId(object);
    if (!oldGroupId) return { nextGroupId: null, nextGroupLabel: null };
    if (!groupIdMap.has(oldGroupId)) {
      groupIdMap.set(oldGroupId, createLocalId('group', input.runtime));
      groupLabelMap.set(oldGroupId, getNextGroupDisplayName(nextMap.objects, getObjectGroupLabel(object)));
    }
    return {
      nextGroupId: groupIdMap.get(oldGroupId) ?? null,
      nextGroupLabel: groupLabelMap.get(oldGroupId) ?? null,
    };
  }

  function duplicateObject(object: EventMapObjectDTO, nextSectionId?: string | null) {
    if (objectIdMap.has(object.id)) return objectIdMap.get(object.id)!;
    if (object.locked) {
      warnings.push('Objeto bloqueado não foi duplicado.');
      return object.id;
    }
    const { nextGroupId, nextGroupLabel } = duplicateGroupId(object);
    const nextObjectId = createLocalId('object', input.runtime);
    objectIdMap.set(object.id, nextObjectId);
    const copy: EventMapObjectDTO = {
      ...object,
      id: nextObjectId,
      sectionId: nextSectionId === undefined ? object.sectionId : nextSectionId,
      x: object.x + offset.x,
      y: object.y + offset.y,
      sortOrder: nextMap.objects.length,
      data: setObjectGroupData(withDuplicateObjectLabel(object, nextMap.objects), nextGroupId, nextGroupLabel),
    };
    nextMap.objects.push(copy);
    created.push(copy.sectionId ? { type: 'section', id: copy.sectionId } : { type: 'object', id: copy.id });
    return nextObjectId;
  }

  function duplicateSeatGroup(groupId: string, nextSectionId?: string | null) {
    if (seatGroupIdMap.has(groupId)) return seatGroupIdMap.get(groupId)!;
    const group = nextMap.seatGroups?.find((entry) => entry.id === groupId);
    if (!group) return groupId;
    if (group.locked) {
      warnings.push('Grupo de assentos bloqueado não foi duplicado.');
      return groupId;
    }

    const groupSeats = nextMap.seats.filter((seat) => seat.groupId === groupId);
    const sourceSectionId = groupSeats.find((seat) => seat.sectionId)?.sectionId ?? null;

    let resolvedSectionId = nextSectionId;
    if (resolvedSectionId === undefined && sourceSectionId) {
      resolvedSectionId = duplicateSection(sourceSectionId);
      const sectionShape = nextMap.objects.find(
        (object) => object.type === 'SECTION' && object.sectionId === sourceSectionId,
      );
      if (sectionShape && !objectIdMap.has(sectionShape.id)) {
        duplicateObject(sectionShape, resolvedSectionId);
      }
    } else if (resolvedSectionId === undefined) {
      resolvedSectionId = sourceSectionId;
    }

    const nextGroupId = createLocalId('seatgroup', input.runtime);
    seatGroupIdMap.set(groupId, nextGroupId);
    const nextNumbering = suggestNextSeatGroupNumbering(nextMap.seats, group);
    const copy: EventSeatGroupDTO = {
      ...group,
      id: nextGroupId,
      name: group.name ? `${group.name} (cópia)` : group.name,
      x: group.x + offset.x,
      y: group.y + offset.y,
      numbering: {
        ...(typeof group.numbering === 'object' && group.numbering ? group.numbering : {}),
        format: 'number',
        rowPrefix: nextNumbering.rowPrefix,
        startNumber: nextNumbering.startNumber,
        direction: nextNumbering.numberingDirection,
      },
    };
    nextMap.seatGroups = nextMap.seatGroups ?? [];
    nextMap.seatGroups.push(copy);
    created.push({ type: 'seatgroup', id: copy.id });

    const section = resolvedSectionId ? nextMap.sections.find((entry) => entry.id === resolvedSectionId) : null;
    const sectionCode = section?.name?.replace(/\s+/g, '-').toUpperCase() ?? 'SECTION';
    const sortedSeats = [...groupSeats].sort((left, right) => {
      const rowDiff = (left.rowIndex ?? 0) - (right.rowIndex ?? 0);
      if (rowDiff !== 0) return rowDiff;
      return (left.columnIndex ?? 0) - (right.columnIndex ?? 0);
    });

    for (const seat of sortedSeats) {
      if (seat.status === 'SOLD') {
        warnings.push('Assento vendido foi duplicado como disponível.');
      }

      const labels = computeSeatGridSeatLabel(seat.rowIndex ?? 0, seat.columnIndex ?? 0, nextNumbering);
      const nextSeatId = createLocalId('seat', input.runtime);
      const duplicatedSeat: EventSeatDTO = {
        ...seat,
        id: nextSeatId,
        sectionId: resolvedSectionId ?? seat.sectionId,
        objectId: seat.objectId ? objectIdMap.get(seat.objectId) ?? null : null,
        groupId: nextGroupId,
        technicalCode: reserveTechnicalCode(technicalCodes, sectionCode, labels.displayLabel),
        displayLabel: labels.displayLabel,
        rowLabel: labels.rowLabel,
        seatNumber: labels.seatNumber,
        x: seat.x + offset.x,
        y: seat.y + offset.y,
        status: 'AVAILABLE',
      };
      nextMap.seats.push(duplicatedSeat);
      created.push({ type: 'seat', id: duplicatedSeat.id });
    }

    return nextGroupId;
  }

  function duplicateSeat(
    seat: EventSeatDTO,
    options?: { sectionId?: string | null; groupId?: string | null; offsetGrouped?: boolean },
  ) {
    if (seat.status === 'SOLD') {
      warnings.push('Assento vendido foi duplicado como disponível.');
    }
    const nextSeatId = createLocalId('seat', input.runtime);
    const copy: EventSeatDTO = {
      ...seat,
      id: nextSeatId,
      sectionId: options?.sectionId ?? seat.sectionId,
      objectId: seat.objectId ? objectIdMap.get(seat.objectId) ?? null : null,
      groupId: options?.groupId === undefined ? seat.groupId : options.groupId,
      technicalCode: duplicateTechnicalCode(technicalCodes, seat.technicalCode),
      displayLabel: `${seat.displayLabel}C`,
      x: options?.offsetGrouped ? seat.x + offset.x : seat.x + offset.x,
      y: options?.offsetGrouped ? seat.y + offset.y : seat.y + offset.y,
      status: 'AVAILABLE',
    };
    nextMap.seats.push(copy);
    created.push({ type: 'seat', id: copy.id });
    return nextSeatId;
  }

  for (const item of items) {
    if (item.type === 'section') {
      const sectionShape = nextMap.objects.find((object) => object.sectionId === item.id && object.type === 'SECTION');
      if (sectionShape?.locked) {
        warnings.push('Setor bloqueado não foi duplicado.');
        continue;
      }
      const nextSectionId = duplicateSection(item.id);
      const sectionObjects = nextMap.objects.filter((object) => object.sectionId === item.id);
      for (const object of sectionObjects) duplicateObject(object, nextSectionId);

      const sectionSeatGroups = new Set(nextMap.seats.filter((seat) => seat.sectionId === item.id && seat.groupId).map((seat) => seat.groupId!));
      for (const groupId of sectionSeatGroups) duplicateSeatGroup(groupId, nextSectionId);

      const looseSeats = nextMap.seats.filter((seat) => seat.sectionId === item.id && !seat.groupId);
      for (const seat of looseSeats) duplicateSeat(seat, { sectionId: nextSectionId, groupId: null });
      continue;
    }

    if (item.type === 'seatgroup') {
      duplicateSeatGroup(item.id);
      continue;
    }

    if (item.type === 'object') {
      const object = nextMap.objects.find((entry) => entry.id === item.id);
      if (!object || (object.sectionId && selectedSectionIds.has(object.sectionId))) continue;
      duplicateObject(object);
      continue;
    }

    if (item.type === 'seat') {
      const seat = nextMap.seats.find((entry) => entry.id === item.id);
      if (!seat) continue;
      if (seat.groupId) {
        if (!selectedSeatGroupIds.has(seat.groupId)) duplicateSeatGroup(seat.groupId);
        continue;
      }
      duplicateSeat(seat);
    }
  }

  if (created.some((item) => item.type === 'object' && nextMap.objects.some((object) => object.id === item.id && object.type === 'CORRIDOR'))) {
    applyCorridorReflow(nextMap);
  }
  updateCounts(nextMap);

  const duplicatedSeatGroupIds = [...seatGroupIdMap.values()];
  const dedupedCreated = created.filter(
    (item, index, list) => list.findIndex((entry) => entry.type === item.type && entry.id === item.id) === index,
  );

  const nextSelection =
    duplicatedSeatGroupIds.length > 0
      ? duplicatedSeatGroupIds.map((id) => ({ type: 'seatgroup' as const, id }))
      : dedupedCreated;

  return {
    map: nextMap,
    selection: nextSelection,
    warnings,
  };
}
