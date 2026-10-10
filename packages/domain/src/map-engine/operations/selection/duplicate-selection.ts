import type { EventMapDTO, EventMapObjectDTO } from '../../types/event-map-types.js';
import type { MapEngineRuntime } from '../../ports/runtime-ports.js';
import type { MapSelection, MapSelectionItem } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import {
  expandObjectSelectionItems,
  getObjectGroupId,
  getObjectGroupLabel,
  getNextGroupDisplayName,
  setObjectGroupData,
} from '../../layout/object-groups.js';
import { withDuplicateObjectLabel } from '../../layout/object-naming.js';
import { cloneMap, createLocalId, updateCounts } from '../../reducer/reducer-context.js';
import { projectMapDocumentToEditorFields } from '../../migration/project-map-document.js';
import type { EventMapDocument, MapSeatBlock, MapSeatRow, SeatRowPath } from '../../model/event-map-document.js';
import { toLocal } from '../../geometry/rotation.js';
import { getNextSeatBlockRowPrefix, getSeatBlockRowLabel } from '../../layout/seat-block-config.js';
import { applySeatBlockNumbering, getNextNumericSeatNumber } from '../../layout/seat-block-numbering.js';
import { getNextMapLayerSortOrder } from '../../doc/levels.js';

export type DuplicateSelectionInput = { map: EventMapDTO; selection: MapSelection; offset?: { x: number; y: number }; runtime?: MapEngineRuntime };
export type DuplicateSelectionResult = { map: EventMapDTO; selection: MapSelection; warnings: string[] };
export type DuplicateSelectionValidationResult = { ok: true } | { ok: false; reason: string };

export function validateDuplicateSelection(map: EventMapDTO, selection: MapSelection): DuplicateSelectionValidationResult {
  if (selection.length === 0) return { ok: false, reason: 'Selecione um item do mapa para duplicar.' };
  if (selection.some((item) => item.type === 'level')) {
    return { ok: false, reason: 'Planos não podem ser duplicados por este atalho.' };
  }
  if (selection.some((item) => item.type === 'seat')) {
    return { ok: false, reason: 'Assentos individuais não podem ser duplicados. Duplique a fileira ou o bloco de assentos.' };
  }
  const selectable = expandObjectSelectionItems(getSelectableItems(selection), map.objects);
  for (const item of selectable) {
    if (item.type === 'object') {
      const object = map.objects.find((entry) => entry.id === item.id);
      if (!object) return { ok: false, reason: 'O objeto selecionado não está mais disponível para duplicação.' };
      if (object.locked) return { ok: false, reason: 'Desbloqueie os objetos selecionados antes de duplicar.' };
    } else if (item.type === 'section') {
      if (!map.document?.sections.some((section) => section.id === item.id)) {
        return { ok: false, reason: 'O setor selecionado não possui dados editáveis para duplicação.' };
      }
    } else if (item.type === 'seatblock') {
      if (!map.document || !map.document.sections.some((section) => section.blocks.some((block) => block.id === item.id))) {
        return { ok: false, reason: 'O bloco selecionado não está mais disponível para duplicação.' };
      }
    } else if (item.type === 'seatrow') {
      if (!map.document || !map.document.sections.some((section) => section.blocks.some((block) => block.rows.some((row) => row.id === item.id)))) {
        return { ok: false, reason: 'A fileira selecionada não está mais disponível para duplicação.' };
      }
    }
  }
  return { ok: true };
}

function translatePath(path: SeatRowPath, dx: number, dy: number): SeatRowPath {
  const point = (value: { x: number; y: number }) => ({ x: value.x + dx, y: value.y + dy });
  if (path.type === 'LINE') return { ...path, start: point(path.start), end: point(path.end) };
  if (path.type === 'ARC') return { ...path, center: point(path.center) };
  if (path.type === 'POLYLINE') return { ...path, points: path.points.map(point) };
  return { ...path, p0: point(path.p0), p1: point(path.p1), p2: point(path.p2), p3: point(path.p3) };
}

function getSeatSuffix(seat: MapSeatRow['seats'][number], rowLabel: string) {
  return seat.seatNumber ?? (seat.label.startsWith(rowLabel) ? seat.label.slice(rowLabel.length) : String(seat.columnIndex + 1));
}

function duplicateRow(row: MapSeatRow, sectionId: string, blockId: string, offset: { x: number; y: number }, runtime?: MapEngineRuntime, rowLabel = row.label) {
  const rowId = createLocalId('row', runtime);
  const seats = row.seats.map((seat) => {
    const number = seat.seatNumber ?? (seat.label.startsWith(row.label) ? seat.label.slice(row.label.length) : String(seat.columnIndex + 1));
    const id = createLocalId('seat', runtime);
    const label = `${rowLabel}${number}`;
    return {
      ...seat,
      id,
      label,
      technicalCode: `${blockId}-${id}`,
      rowLabel,
      seatNumber: number,
      ...(seat.position ? { position: { x: seat.position.x + offset.x, y: seat.position.y + offset.y } } : {}),
    };
  });
  return {
    ...row,
    id: rowId,
    sectionId,
    blockId,
    label: rowLabel,
    path: translatePath(row.path, offset.x, offset.y),
    seatIds: seats.map((seat) => seat.id),
    seats,
  } satisfies MapSeatRow;
}

function duplicateBlock(block: MapSeatBlock, sectionId: string, offset: { x: number; y: number }, runtime?: MapEngineRuntime, rowPrefix = 'A', startNumber?: number) {
  const blockId = createLocalId('block', runtime);
  const rows = block.rows.map((row, index) => duplicateRow(row, sectionId, blockId, offset, runtime, getSeatBlockRowLabel(index, rowPrefix)));
  const copy = { ...block, ...(startNumber === undefined ? {} : { startNumber }), id: blockId, sectionId, rowIds: rows.map((row) => row.id), rows } satisfies MapSeatBlock;
  return copy.numberingMode === 'NUMERIC' ? applySeatBlockNumbering(copy) : copy;
}

export function duplicateSelection(input: DuplicateSelectionInput): DuplicateSelectionResult {
  const validation = validateDuplicateSelection(input.map, input.selection);
  if (!validation.ok) {
    return { map: input.map, selection: input.selection, warnings: [validation.reason] };
  }
  const offset = input.offset ?? { x: 28, y: 28 };
  const nextMap = cloneMap(input.map);
  const items = expandObjectSelectionItems(getSelectableItems(input.selection), nextMap.objects);
  const selectedSections = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));
  const selectedBlocks = new Set(items.filter((item) => item.type === 'seatblock').map((item) => item.id));
  const blockIdsInSections = new Set(nextMap.document?.sections
    .filter((section) => selectedSections.has(section.id))
    .flatMap((section) => section.blocks.map((block) => block.id)) ?? []);
  const rowIdsInSelectedBlocks = new Set(nextMap.document?.sections
    .flatMap((section) => section.blocks)
    .filter((block) => selectedBlocks.has(block.id) || blockIdsInSections.has(block.id))
    .flatMap((block) => block.rows.map((row) => row.id)) ?? []);
  const linkedObjectIds = new Set(nextMap.objects
    .filter((object) => object.sectionId && selectedSections.has(object.sectionId))
    .map((object) => object.id));
  const normalizedItems = items.filter((item) => {
    if (item.type === 'seatblock') return !blockIdsInSections.has(item.id);
    if (item.type === 'seatrow') return !rowIdsInSelectedBlocks.has(item.id);
    if (item.type === 'object') return !linkedObjectIds.has(item.id);
    return true;
  });
  items.splice(0, items.length, ...normalizedItems);
  const groupedItemIndexes = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (item.type !== 'object') return;
    const object = nextMap.objects.find((entry) => entry.id === item.id);
    const groupId = object ? getObjectGroupId(object) : null;
    if (!groupId) return;
    const indexes = groupedItemIndexes.get(groupId) ?? [];
    indexes.push(index);
    groupedItemIndexes.set(groupId, indexes);
  });
  for (const indexes of groupedItemIndexes.values()) {
    const sortedItems = indexes
      .map((index) => items[index])
      .filter((item): item is Extract<MapSelectionItem, { type: 'object' }> => Boolean(item))
      .sort((left, right) => {
        const leftOrder = nextMap.objects.find((object) => object.id === left.id)?.sortOrder ?? 0;
        const rightOrder = nextMap.objects.find((object) => object.id === right.id)?.sortOrder ?? 0;
        return leftOrder - rightOrder;
      });
    indexes.forEach((index, offsetIndex) => {
      const sortedItem = sortedItems[offsetIndex];
      if (sortedItem) items[index] = sortedItem;
    });
  }
  const warnings: string[] = [];
  const created: MapSelectionItem[] = [];
    const sourceDocument = nextMap.document
      ? (JSON.parse(JSON.stringify(nextMap.document)) as EventMapDocument)
      : undefined;
  if (sourceDocument) {
    const documentObjectIds = new Set(sourceDocument.visualElements.map((element) => element.id));
    sourceDocument.visualElements.push(
      ...nextMap.objects
        .filter((object) => !documentObjectIds.has(object.id))
        .map((object) => ({ ...object, data: { ...object.data } })),
    );
  }
  if (sourceDocument) {
    const selectedSectionIds = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));
    const selectedBlockIds = new Set(items.filter((item) => item.type === 'seatblock').map((item) => item.id));
    const selectedRowIds = new Set(items.filter((item) => item.type === 'seatrow').map((item) => item.id));
    const sections = sourceDocument.sections;
    const sourceSectionById = new Map(sections.map((section) => [section.id, section]));
    const duplicatedSectionIds = new Map<string, string>();
    const nextRowPrefixByLevel = new Map<string, string>();
    const nextNumericSeatNumberByLevel = new Map<string, number>();
    const takeNextNumericSeatNumber = (levelId: string, blocks: readonly MapSeatBlock[], seatCount?: number) => {
      const nextNumber = nextNumericSeatNumberByLevel.get(levelId) ?? getNextNumericSeatNumber(
        sections.filter((section) => section.levelId === levelId).flatMap((section) => section.blocks),
      );
      const allocatedSeatCount = seatCount ?? blocks.reduce((total, block) => total + block.rows.reduce((rowTotal, row) => rowTotal + row.seats.length, 0), 0);
      nextNumericSeatNumberByLevel.set(levelId, nextNumber + allocatedSeatCount);
      return nextNumber;
    };
    const takeNextRowPrefix = (levelId: string, rowCount = 0, requestedSeatSuffixes: string[] = []) => {
      const levelSections = sections.filter((section) => section.levelId === levelId);
      const rowLabels = levelSections
        .flatMap((section) => section.blocks.flatMap((block) => block.rows.map((row) => row.label.toUpperCase())));
      const usedSeatLabels = new Set(levelSections.flatMap((section) => section.blocks.flatMap((block) =>
        block.rows.flatMap((row) => row.seats.flatMap((seat) => [seat.label, seat.technicalCode ?? ''].map((label) => label.toUpperCase()))),
      )));
      const maxSeatNumber = Math.max(1, ...levelSections.flatMap((section) => section.blocks.flatMap((block) => block.rows.map((row) => row.seats.length))));
      let prefix = nextRowPrefixByLevel.get(levelId) ?? getNextSeatBlockRowPrefix(rowLabels);
      const isAvailable = (candidate: string) => {
        for (let rowIndex = 0; rowIndex < Math.max(1, rowCount); rowIndex += 1) {
          const rowLabel = getSeatBlockRowLabel(rowIndex, candidate);
          if (rowLabels.includes(rowLabel.toUpperCase())) return false;
          const seatSuffixes = requestedSeatSuffixes.length > 0
            ? requestedSeatSuffixes
            : Array.from({ length: maxSeatNumber }, (_, index) => String(index + 1));
          for (const suffix of seatSuffixes) {
            if (usedSeatLabels.has(`${rowLabel}${suffix}`.toUpperCase())) return false;
          }
        }
        return true;
      };
      while (!isAvailable(prefix)) prefix = getSeatBlockRowLabel(1, prefix);
      if (rowCount > 0) nextRowPrefixByLevel.set(levelId, getSeatBlockRowLabel(rowCount, prefix));
      return prefix;
    };
    const nextSectionSortOrderByLevel = new Map<string, number>();
    const duplicatedSections = sourceDocument.sections
      .filter((section) => selectedSectionIds.has(section.id))
      .map((section) => {
        const sectionId = createLocalId('section', input.runtime);
        duplicatedSectionIds.set(section.id, sectionId);
        // Moving the section moves its local geometry too; offsetting both here
        // would apply the duplicate offset twice.
        const blocks = section.blocks.map((block) => {
          const startNumber = block.numberingMode === 'NUMERIC' ? takeNextNumericSeatNumber(section.levelId, [block]) : undefined;
          return duplicateBlock(
            block,
            sectionId,
            { x: 0, y: 0 },
            input.runtime,
            takeNextRowPrefix(section.levelId, block.rows.length, block.rows.flatMap((row) => row.seats.map((seat) => getSeatSuffix(seat, row.label)))),
            startNumber,
          );
        });
        const nextSortOrder = nextSectionSortOrderByLevel.get(section.levelId) ?? Math.max(
          -1,
          ...sourceDocument.sections.filter((entry) => entry.levelId === section.levelId).map((entry) => entry.sortOrder ?? 0),
          ...sourceDocument.visualElements.filter((entry) => entry.levelId === section.levelId).map((entry) => entry.sortOrder),
        ) + 1;
        nextSectionSortOrderByLevel.set(section.levelId, nextSortOrder + 1);
        created.push({ type: 'section', id: sectionId });
        return {
          ...section,
          id: sectionId,
          name: `${section.name} (cópia)`,
          lotId: null,
          capacity: null,
          position: { x: section.position.x + offset.x, y: section.position.y + offset.y },
          sortOrder: nextSortOrder,
          blockIds: blocks.map((block) => block.id),
          blocks,
        };
      });
    for (const section of duplicatedSections) sections.push(section);

    const duplicatedVisualElements = sourceDocument.visualElements.flatMap((element) => {
      const sectionId = element.sectionId ? duplicatedSectionIds.get(element.sectionId) : undefined;
      if (!sectionId) return [];
      return [{
        ...element,
        id: createLocalId('object', input.runtime),
        sectionId,
        x: element.x + offset.x,
        y: element.y + offset.y,
        sortOrder: sourceDocument.sections.find((entry) => entry.id === sectionId)?.sortOrder ?? element.sortOrder,
      }];
    });
    sourceDocument.visualElements.push(...duplicatedVisualElements);

    for (const section of [...sourceDocument.sections]) {
      for (const block of section.blocks) {
        if (!selectedBlockIds.has(block.id)) continue;
        const sourceSection = sourceSectionById.get(section.id);
        if (!sourceSection) continue;
        const sectionId = createLocalId('section', input.runtime);
        const localOffset = toLocal(offset, { x: 0, y: 0 }, sourceSection.rotation);
        const duplicateRowPrefix = takeNextRowPrefix(sourceSection.levelId, block.rows.length, block.rows.flatMap((row) => row.seats.map((seat) => getSeatSuffix(seat, row.label))));
        const startNumber = block.numberingMode === 'NUMERIC' ? takeNextNumericSeatNumber(sourceSection.levelId, [block]) : undefined;
        const copy = duplicateBlock(block, sectionId, localOffset, input.runtime, duplicateRowPrefix, startNumber);
        const nextSortOrder = Math.max(
          -1,
          ...sections
            .filter((entry) => entry.levelId === sourceSection.levelId)
            .map((entry) => entry.sortOrder ?? 0),
          ...sourceDocument.visualElements
            .filter((entry) => entry.levelId === sourceSection.levelId)
            .map((entry) => entry.sortOrder),
        ) + 1;
        sections.push({
          ...sourceSection,
          id: sectionId,
          name: `${sourceSection.name} (cópia)`,
          color: sourceSection.color,
          sortOrder: nextSortOrder,
          lotId: null,
          capacity: null,
          outline: [],
          blockIds: [copy.id],
          blocks: [copy],
        });
        created.push({ type: 'seatblock', id: copy.id });
      }
      const rows = section.blocks.flatMap((block) => block.rows.filter((row) => selectedRowIds.has(row.id)).map((row) => ({ block, row })));
      for (const { block, row } of rows) {
        const target = sections.find((entry) => entry.id === section.id);
        if (!target) continue;
        const localOffset = toLocal(offset, { x: 0, y: 0 }, section.rotation);
        const rowPrefix = takeNextRowPrefix(section.levelId, 1, row.seats.map((seat) => getSeatSuffix(seat, row.label)));
        let copy = duplicateRow(row, section.id, block.id, localOffset, input.runtime, rowPrefix);
        const targetBlock = target.blocks.find((entry) => entry.id === block.id);
        if (targetBlock) {
          if (targetBlock.numberingMode === 'NUMERIC') {
            const startNumber = takeNextNumericSeatNumber(section.levelId, [targetBlock], copy.seats.length);
            copy = {
              ...copy,
              seats: copy.seats.map((seat, seatIndex) => {
                const visualIndex = targetBlock.numberingDirection === 'right-to-left'
                  ? copy.seats.length - seatIndex - 1
                  : seatIndex;
                const seatNumber = String(startNumber + visualIndex);
                return { ...seat, label: seatNumber, seatNumber, rowLabel: rowPrefix };
              }),
            };
          }
          targetBlock.rows.push(copy);
          targetBlock.rowIds.push(copy.id);
          created.push({ type: 'seatrow', id: copy.id });
        }
      }
    }
    nextMap.document = { ...sourceDocument, sections } satisfies EventMapDocument;
    const projection = projectMapDocumentToEditorFields(nextMap.document, nextMap);
    nextMap.sections = projection.sections;
    nextMap.seats = projection.seats.map((seat) => (created.some((item) => item.type === 'seatblock' || item.type === 'seatrow' || item.type === 'section') && !input.map.seats.some((previous) => previous.id === seat.id) ? { ...seat, status: 'AVAILABLE' } : seat));
    nextMap.objects = [...projection.objects];
  }

  const groupCopyIds = new Map<string, { id: string; label: string }>();
  for (const item of items) {
    if (item.type !== 'object') continue;
    const object = nextMap.objects.find((entry) => entry.id === item.id);
    if (!object || object.locked) {
      if (object?.locked) warnings.push('Objeto bloqueado não foi duplicado.');
      continue;
    }
    const groupId = getObjectGroupId(object);
    let data: Record<string, unknown> = withDuplicateObjectLabel(object, nextMap.objects);
    if (groupId) {
      let copiedGroup = groupCopyIds.get(groupId);
      if (!copiedGroup) {
        copiedGroup = {
          id: createLocalId('group', input.runtime),
          label: getNextGroupDisplayName(nextMap.objects, getObjectGroupLabel(object)),
        };
        groupCopyIds.set(groupId, copiedGroup);
      }
      data = setObjectGroupData(data, copiedGroup.id, copiedGroup.label);
    }
    const copy: EventMapObjectDTO = { ...object, id: createLocalId('object', input.runtime), data, x: object.x + offset.x, y: object.y + offset.y, sortOrder: getNextMapLayerSortOrder(nextMap) };
    nextMap.objects.push(copy);
    if (nextMap.document) {
      nextMap.document = {
        ...nextMap.document,
        visualElements: [...nextMap.document.visualElements, copy],
      };
    }
    created.push({ type: 'object', id: copy.id });
  }

  updateCounts(nextMap);
  return { map: nextMap, selection: created, warnings };
}
