import type { EventMapDTO, EventMapObjectDTO } from '../../types/event-map-types.js';
import type { MapEngineRuntime } from '../../ports/runtime-ports.js';
import type { MapSelection, MapSelectionItem } from '../../selection/selection-utils.js';
import { getSelectableItems } from '../../selection/selection-utils.js';
import { expandObjectSelectionItems } from '../../layout/object-groups.js';
import { cloneMap, createLocalId, DEFAULT_COLORS, updateCounts } from '../../reducer/reducer-context.js';
import { projectMapDocumentToEditorFields } from '../../migration/project-map-document.js';
import type { EventMapDocument, MapSeatBlock, MapSeatRow, SeatRowPath } from '../../model/event-map-document.js';
import { toLocal } from '../../geometry/rotation.js';
import { getNextSeatBlockRowPrefix, getSeatBlockRowLabel } from '../../layout/seat-block-config.js';

export type DuplicateSelectionInput = { map: EventMapDTO; selection: MapSelection; offset?: { x: number; y: number }; runtime?: MapEngineRuntime };
export type DuplicateSelectionResult = { map: EventMapDTO; selection: MapSelection; warnings: string[] };
export type DuplicateSelectionValidationResult = { ok: true } | { ok: false; reason: string };

export function validateDuplicateSelection(_map: EventMapDTO, _selection: MapSelection): DuplicateSelectionValidationResult {
  return { ok: true };
}

function translatePath(path: SeatRowPath, dx: number, dy: number): SeatRowPath {
  const point = (value: { x: number; y: number }) => ({ x: value.x + dx, y: value.y + dy });
  if (path.type === 'LINE') return { ...path, start: point(path.start), end: point(path.end) };
  if (path.type === 'ARC') return { ...path, center: point(path.center) };
  if (path.type === 'POLYLINE') return { ...path, points: path.points.map(point) };
  return { ...path, p0: point(path.p0), p1: point(path.p1), p2: point(path.p2), p3: point(path.p3) };
}

function duplicateRow(row: MapSeatRow, sectionId: string, blockId: string, offset: { x: number; y: number }, runtime?: MapEngineRuntime, rowLabel = row.label) {
  const rowId = createLocalId('row', runtime);
  const seats = row.seats.map((seat) => {
    const number = seat.technicalCode?.match(/(\d+)$/)?.[1] ?? String(seat.columnIndex + 1);
    const label = `${rowLabel}${number}`;
    return {
      ...seat,
      id: createLocalId('seat', runtime),
      label,
      technicalCode: label,
      publicVisible: true,
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

function duplicateBlock(block: MapSeatBlock, sectionId: string, offset: { x: number; y: number }, runtime?: MapEngineRuntime, rowPrefix = 'A') {
  const blockId = createLocalId('block', runtime);
  const rows = block.rows.map((row, index) => duplicateRow(row, sectionId, blockId, offset, runtime, getSeatBlockRowLabel(index, rowPrefix)));
  return { ...block, id: blockId, sectionId, rowIds: rows.map((row) => row.id), rows } satisfies MapSeatBlock;
}

export function duplicateSelection(input: DuplicateSelectionInput): DuplicateSelectionResult {
  const offset = input.offset ?? { x: 28, y: 28 };
  const nextMap = cloneMap(input.map);
  const items = expandObjectSelectionItems(getSelectableItems(input.selection), nextMap.objects);
  const warnings: string[] = [];
  const created: MapSelectionItem[] = [];
    const sourceDocument = nextMap.document
      ? (JSON.parse(JSON.stringify(nextMap.document)) as EventMapDocument)
      : undefined;
  if (sourceDocument) {
    const selectedSectionIds = new Set(items.filter((item) => item.type === 'section').map((item) => item.id));
    const selectedBlockIds = new Set(items.filter((item) => item.type === 'seatblock').map((item) => item.id));
    const selectedRowIds = new Set(items.filter((item) => item.type === 'seatrow').map((item) => item.id));
    const sections = sourceDocument.sections;
    const sourceSectionById = new Map(sections.map((section) => [section.id, section]));
    const duplicatedSectionIds = new Map<string, string>();
    const nextRowPrefixByLevel = new Map<string, string>();
    const takeNextRowPrefix = (levelId: string, rowCount = 0) => {
      const rowLabels = sections
        .filter((section) => section.levelId === levelId)
        .flatMap((section) => section.blocks.flatMap((block) => block.rows.map((row) => row.label)));
      const prefix = nextRowPrefixByLevel.get(levelId) ?? getNextSeatBlockRowPrefix(rowLabels);
      if (rowCount > 0) nextRowPrefixByLevel.set(levelId, getSeatBlockRowLabel(rowCount, prefix));
      return prefix;
    };
    const duplicatedSections = sourceDocument.sections
      .filter((section) => selectedSectionIds.has(section.id))
      .map((section) => {
        const sectionId = createLocalId('section', input.runtime);
        duplicatedSectionIds.set(section.id, sectionId);
        // Moving the section moves its local geometry too; offsetting both here
        // would apply the duplicate offset twice.
        const blocks = section.blocks.map((block) => {
          return duplicateBlock(block, sectionId, { x: 0, y: 0 }, input.runtime, takeNextRowPrefix(section.levelId, block.rows.length));
        });
        created.push({ type: 'section', id: sectionId });
        return {
          ...section,
          id: sectionId,
          name: `${section.name} (cópia)`,
          lotId: null,
          capacity: null,
          position: { x: section.position.x + offset.x, y: section.position.y + offset.y },
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
        sortOrder: element.sortOrder + sourceDocument.visualElements.length,
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
        const duplicateRowPrefix = takeNextRowPrefix(sourceSection.levelId, block.rows.length);
        const copy = duplicateBlock(block, sectionId, localOffset, input.runtime, duplicateRowPrefix);
        const sectionIndex = sections.length;
        sections.push({
          ...sourceSection,
          id: sectionId,
          name: `Setor ${sectionIndex + 1}`,
          color: DEFAULT_COLORS[sectionIndex % DEFAULT_COLORS.length]!,
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
        const copy = duplicateRow(row, section.id, block.id, offset, input.runtime);
        const targetBlock = target.blocks.find((entry) => entry.id === block.id);
        if (targetBlock) {
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
    nextMap.objects = projection.objects;
  }

  for (const item of items) {
    if (item.type !== 'object') continue;
    const object = nextMap.objects.find((entry) => entry.id === item.id);
    if (!object || object.locked) {
      if (object?.locked) warnings.push('Objeto bloqueado não foi duplicado.');
      continue;
    }
    const copy: EventMapObjectDTO = { ...object, id: createLocalId('object', input.runtime), x: object.x + offset.x, y: object.y + offset.y, sortOrder: nextMap.objects.length };
    nextMap.objects.push(copy);
    created.push({ type: 'object', id: copy.id });
  }

  updateCounts(nextMap);
  return { map: nextMap, selection: created, warnings };
}
