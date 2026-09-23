import type { EventMapDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import { expandObjectSelectionItems } from '../../layout/object-groups.js';
import { findMapBlockOwner, findMapRowOwner } from '../../model/event-map-document.js';

export type ResolvedSelection = {
  selection: MapSelection;
  objectIds: string[];
  seatIds: string[];
  sectionIds: string[];
  warnings: string[];
  blocked: boolean;
};

function addUnique(target: string[], seen: Set<string>, id: string) {
  if (seen.has(id)) return;
  seen.add(id);
  target.push(id);
}

export function resolveOperationSelection(
  map: EventMapDTO,
  selection: MapSelection,
  options?: { includeSectionSeats?: boolean; blockLocked?: boolean; blockSoldSeats?: boolean },
): ResolvedSelection {
  const includeSectionSeats = options?.includeSectionSeats ?? true;
  const blockLocked = options?.blockLocked ?? true;
  const blockSoldSeats = options?.blockSoldSeats ?? true;
  const objectIds: string[] = [];
  const seatIds: string[] = [];
  const sectionIds: string[] = [];
  const seenObjects = new Set<string>();
  const seenSeats = new Set<string>();
  const seenSections = new Set<string>();
  const warnings: string[] = [];
  let blocked = false;
  const items = expandObjectSelectionItems(getSelectableItems(selection), map.objects);

  function addParametricSeats(item: Extract<(typeof items)[number], { type: 'seatblock' | 'seatrow' }>) {
    if (!map.document) return;
    const rows = item.type === 'seatblock'
      ? findMapBlockOwner(map.document, item.id)?.block.rows ?? []
      : (() => {
          const owner = findMapRowOwner(map.document!, item.id);
          return owner ? [owner.row] : [];
        })();
    for (const row of rows) {
      for (const seatId of row.seatIds) {
        const seat = map.seats.find((entry) => entry.id === seatId);
        if (!seat) continue;
        if (seat.status === 'SOLD' && blockSoldSeats) {
          blocked = true;
          warnings.push('A seleção contém assento vendido.');
          continue;
        }
        addUnique(seatIds, seenSeats, seat.id);
      }
    }
  }

  for (const item of items) {
    if (item.type === 'object') {
      const object = map.objects.find((entry) => entry.id === item.id);
      if (!object) continue;
      if (object.locked && blockLocked) {
        blocked = true;
        warnings.push('A seleção contém objeto bloqueado.');
        continue;
      }
      addUnique(objectIds, seenObjects, object.id);
      continue;
    }

    if (item.type === 'section') {
      addUnique(sectionIds, seenSections, item.id);
      const object = map.objects.find((entry) => entry.sectionId === item.id && entry.type === 'SECTION');
      if (object) {
        if (object.locked && blockLocked) {
          blocked = true;
          warnings.push('A seleção contém setor bloqueado.');
        } else addUnique(objectIds, seenObjects, object.id);
      }
      if (includeSectionSeats) {
        for (const seat of map.seats.filter((entry) => entry.sectionId === item.id)) {
          if (seat.status === 'SOLD' && blockSoldSeats) {
            blocked = true;
            warnings.push('A seleção contém assento vendido.');
          } else addUnique(seatIds, seenSeats, seat.id);
        }
      }
      continue;
    }

    if (item.type === 'seat') {
      const seat = map.seats.find((entry) => entry.id === item.id);
      if (!seat) continue;
      if (seat.status === 'SOLD' && blockSoldSeats) {
        blocked = true;
        warnings.push('A seleção contém assento vendido.');
      } else addUnique(seatIds, seenSeats, seat.id);
      continue;
    }

    if (item.type === 'seatblock' || item.type === 'seatrow') {
      addParametricSeats(item);
    }
  }

  return {
    selection: items.some((item) => item.type === 'seatblock' || item.type === 'seatrow')
      ? items
      : [...objectIds.map((id) => ({ type: 'object' as const, id })), ...seatIds.map((id) => ({ type: 'seat' as const, id }))],
    objectIds,
    seatIds,
    sectionIds,
    warnings,
    blocked,
  };
}

export function resolveCanvasSelection(map: EventMapDTO, selection: MapSelection, options?: Parameters<typeof resolveOperationSelection>[2]) {
  const resolved = resolveOperationSelection(map, selection, options);
  const sectionObjectIds = new Set(map.objects.filter((object) => object.type === 'SECTION').map((object) => object.id));
  const objectIds = resolved.objectIds.filter((id) => !sectionObjectIds.has(id));
  return {
    ...resolved,
    objectIds,
    selection: [...objectIds.map((id) => ({ type: 'object' as const, id })), ...resolved.seatIds.map((id) => ({ type: 'seat' as const, id }))],
  };
}

export function resolveCanvasNodeIds(map: EventMapDTO, selection: MapSelection): string[] {
  const resolved = resolveCanvasSelection(map, selection);
  return [...resolved.objectIds.map((id) => `node-${id}`), ...resolved.seatIds.map((id) => `node-${id}`)];
}
