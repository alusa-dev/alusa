import type { EventMapDocument, MapSelectionItem } from '@alusa/domain';

/**
 * Marquee selection reports rendered seats. Replace complete parametric rows or
 * blocks with their canonical entities even when the marquee also contains
 * shapes, so a mixed transform preserves the row layout and seat spacing.
 * Partial selections intentionally remain individual seats.
 */
export function compactParametricSeatSelection(
  selection: MapSelectionItem[],
  document: EventMapDocument | null | undefined,
  visibleSeatIds?: readonly string[],
): MapSelectionItem[] {
  if (!document || selection.length === 0 || !selection.some((item) => item.type === 'seat')) return selection;

  const selectedSeatIds = new Set(selection.flatMap((item) => item.type === 'seat' ? [item.id] : []));
  const seatIdsInDocument = document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.rows.flatMap((row) => row.seatIds)),
  );
  const selectableSeatIds = new Set(visibleSeatIds ?? seatIdsInDocument);
  const replacementBySeatId = new Map<string, MapSelectionItem>();

  for (const section of document.sections) {
    for (const block of section.blocks) {
      const blockSeatIds = block.rows.flatMap((row) => row.seatIds).filter((id) => selectableSeatIds.has(id));
      if (blockSeatIds.length > 0 && blockSeatIds.every((id) => selectedSeatIds.has(id))) {
        const item: MapSelectionItem = { type: 'seatblock', id: block.id };
        for (const id of blockSeatIds) {
          replacementBySeatId.set(id, item);
        }
        continue;
      }

      for (const row of block.rows) {
        const rowSeatIds = row.seatIds.filter((id) => selectableSeatIds.has(id));
        if (rowSeatIds.length === 0 || !rowSeatIds.every((id) => selectedSeatIds.has(id))) continue;
        const item: MapSelectionItem = { type: 'seatrow', id: row.id };
        for (const id of rowSeatIds) {
          replacementBySeatId.set(id, item);
        }
      }
    }
  }

  const result: MapSelectionItem[] = [];
  const emitted = new Set<string>();
  for (const item of selection) {
    if (item.type !== 'seat') {
      result.push(item);
      continue;
    }
    const replacement = replacementBySeatId.get(item.id);
    if (!replacement) {
      result.push(item);
      continue;
    }
    const key = `${replacement.type}:${replacement.id}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(replacement);
  }
  return result;
}
