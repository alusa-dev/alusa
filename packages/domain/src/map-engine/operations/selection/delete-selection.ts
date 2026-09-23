import type { EventMapDTO } from '../../types/event-map-types.js';
import type { MapSelection } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import { expandObjectSelectionItems, sanitizeGroupMembership } from '../../layout/object-groups.js';
import { projectMapDocumentToEditorFields } from '../../migration/project-map-document.js';
import type { EventMapDocument, MapSeatBlock, MapSeatRow } from '../../model/event-map-document.js';
import type { MapSelectionItem } from '../../selection/selection-utils.js';
import { cloneMap, updateCounts } from '../../reducer/reducer-context.js';

export type DeleteSelectionInput = {
  map: EventMapDTO;
  selection: MapSelection;
};

export type DeleteSelectionResult = {
  map: EventMapDTO;
  selection: MapSelection;
  warnings: string[];
  blocked: boolean;
};

const OPERATIONAL_SEAT_STATUSES = new Set(['SOLD', 'HELD', 'COMPLIMENTARY']);

function getBlock(document: EventMapDocument, blockId: string): MapSeatBlock | null {
  for (const section of document.sections) {
    const block = section.blocks.find((candidate) => candidate.id === blockId);
    if (block) return block;
  }
  return null;
}

function getRow(document: EventMapDocument, rowId: string): MapSeatRow | null {
  for (const section of document.sections) {
    for (const block of section.blocks) {
      const row = block.rows.find((candidate) => candidate.id === rowId);
      if (row) return row;
    }
  }
  return null;
}

function seatIdsForSelection(document: EventMapDocument, item: MapSelectionItem): string[] {
  if (item.type === 'seat') return [item.id];
  if (item.type === 'seatrow') return getRow(document, item.id)?.seatIds ?? [];
  if (item.type === 'seatblock') return getBlock(document, item.id)?.rows.flatMap((row) => row.seatIds) ?? [];
  if (item.type === 'section') {
    return document.sections.find((section) => section.id === item.id)?.blocks.flatMap((block) => block.rows.flatMap((row) => row.seatIds)) ?? [];
  }
  return [];
}

function removeFromDocument(document: EventMapDocument, item: MapSelectionItem): EventMapDocument {
  if (item.type === 'section') {
    return { ...document, sections: document.sections.filter((section) => section.id !== item.id) };
  }

  if (item.type === 'seatblock') {
    return {
      ...document,
      sections: document.sections.map((section) => ({
        ...section,
        blockIds: section.blockIds.filter((blockId) => blockId !== item.id),
        blocks: section.blocks.filter((block) => block.id !== item.id),
      })),
    };
  }

  if (item.type === 'seatrow') {
    return {
      ...document,
      sections: document.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({
          ...block,
          rowIds: block.rowIds.filter((rowId) => rowId !== item.id),
          rows: block.rows.filter((row) => row.id !== item.id),
        })),
      })),
    };
  }

  if (item.type === 'seat') {
    return {
      ...document,
      sections: document.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({
          ...block,
          rows: block.rows.map((row) => ({
            ...row,
            seatIds: row.seatIds.filter((seatId) => seatId !== item.id),
            seats: row.seats.filter((seat) => seat.id !== item.id),
          })),
        })),
      })),
    };
  }

  return document;
}

function pruneEmptySeatContainers(document: EventMapDocument): EventMapDocument {
  return {
    ...document,
    sections: document.sections
      .map((section) => ({
        ...section,
        // A seat-block section is a logical container. Its visible geometry
        // comes from the rows, so never keep a stale derived rectangle.
        outline: section.blocks.length > 0 ? [] : section.outline,
        blockIds: section.blockIds.filter((blockId) => section.blocks.some((block) => block.id === blockId && block.rows.length > 0)),
        blocks: section.blocks
          .map((block) => ({
            ...block,
            rowIds: block.rowIds.filter((rowId) => block.rows.some((row) => row.id === rowId && row.seats.length > 0)),
            rows: block.rows.filter((row) => row.seats.length > 0),
          }))
          .filter((block) => block.rows.length > 0),
      }))
      .filter((section) => section.blocks.length > 0),
  };
}

function projectDocument(map: EventMapDTO, document: EventMapDocument) {
  const prunedDocument = pruneEmptySeatContainers(document);
  const projection = projectMapDocumentToEditorFields(prunedDocument, map);
  map.document = prunedDocument;
  map.sections = projection.sections;
  map.objects = projection.objects;
  map.seats = projection.seats;
}

export function deleteSelection(input: DeleteSelectionInput): DeleteSelectionResult {
  const nextMap = cloneMap(input.map);
  const items = expandObjectSelectionItems(getSelectableItems(input.selection), nextMap.objects);
  const warnings: string[] = [];

  const hasLockedItem = items.some((item) => {
    if (item.type === 'object') {
      return nextMap.objects.some((object) => object.id === item.id && object.locked);
    }
    if (item.type === 'section') {
      return nextMap.objects.some((object) => object.sectionId === item.id && object.locked);
    }
    return false;
  });

  const operationalSeatIds = new Set(
    items.flatMap((item) =>
      nextMap.document
        ? seatIdsForSelection(nextMap.document, item)
        : item.type === 'seat'
          ? [item.id]
          : item.type === 'section'
            ? nextMap.seats.filter((seat) => seat.sectionId === item.id).map((seat) => seat.id)
            : [],
    ),
  );
  const hasOperationalSeat = nextMap.seats.some(
    (seat) => operationalSeatIds.has(seat.id) && OPERATIONAL_SEAT_STATUSES.has(seat.status),
  );

  if (hasLockedItem) {
    return {
      map: input.map,
      selection: input.selection,
      warnings: ['A seleção contém item bloqueado.'],
      blocked: true,
    };
  }

  if (hasOperationalSeat) {
    return {
      map: input.map,
      selection: input.selection,
      warnings: ['A seleção contém assento vendido ou reservado.'],
      blocked: true,
    };
  }

  for (const item of items) {
    if (nextMap.document && ['section', 'seatblock', 'seatrow', 'seat'].includes(item.type)) {
      projectDocument(nextMap, removeFromDocument(nextMap.document, item));
    } else if (item.type === 'seat') {
      nextMap.seats = nextMap.seats.filter((entry) => entry.id !== item.id);
    }

    if (item.type === 'object') {
      nextMap.objects = nextMap.objects.filter((entry) => entry.id !== item.id);
    }

    if (item.type === 'section') {
      nextMap.seats = nextMap.seats.filter((seat) => seat.sectionId !== item.id);
      nextMap.objects = nextMap.objects.filter((object) => object.sectionId !== item.id);
      nextMap.sections = nextMap.sections.filter((section) => section.id !== item.id);
    }

  }

  nextMap.objects = sanitizeGroupMembership(nextMap.objects);
  updateCounts(nextMap);

  return { map: nextMap, selection: [], warnings, blocked: false };
}
