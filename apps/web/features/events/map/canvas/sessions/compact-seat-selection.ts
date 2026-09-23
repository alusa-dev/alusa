import type { EventMapDocument, MapSelectionItem } from '@alusa/domain';

/**
 * Marquee selection reports the rendered seats. When it contains every seat in
 * one or more parametric rows/blocks, use those canonical entities instead so
 * group transforms update their paths and spacing rather than seat overrides.
 * Partial selections intentionally remain individual seats.
 */
export function compactParametricSeatSelection(
  selection: MapSelectionItem[],
  document: EventMapDocument | null | undefined,
  visibleSeatIds?: readonly string[],
): MapSelectionItem[] {
  if (!document || selection.length === 0 || !selection.every((item) => item.type === 'seat')) {
    return selection;
  }

  const selectedSeatIds = new Set(selection.map((item) => item.id));
  const seatIdsInDocument = document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.rows.flatMap((row) => row.seatIds)),
  );
  const selectableSeatIds = new Set(visibleSeatIds ?? seatIdsInDocument);
  const replacementBySeatId = new Map<string, MapSelectionItem>();
  const consumedSeatIds = new Set<string>();

  for (const section of document.sections) {
    for (const block of section.blocks) {
      const blockSeatIds = block.rows.flatMap((row) => row.seatIds).filter((id) => selectableSeatIds.has(id));
      if (blockSeatIds.length > 0 && blockSeatIds.every((id) => selectedSeatIds.has(id))) {
        const item: MapSelectionItem = { type: 'seatblock', id: block.id };
        for (const id of blockSeatIds) {
          consumedSeatIds.add(id);
          replacementBySeatId.set(id, item);
        }
        continue;
      }

      for (const row of block.rows) {
        const rowSeatIds = row.seatIds.filter((id) => selectableSeatIds.has(id));
        if (rowSeatIds.length === 0 || !rowSeatIds.every((id) => selectedSeatIds.has(id))) continue;
        const item: MapSelectionItem = { type: 'seatrow', id: row.id };
        for (const id of rowSeatIds) {
          consumedSeatIds.add(id);
          replacementBySeatId.set(id, item);
        }
      }
    }
  }

  // Do not create a mixed block/seat selection: the transformer operates on
  // homogeneous parametric entities, while partial seats use the generic path.
  if (consumedSeatIds.size !== selectedSeatIds.size) return selection;

  const result: MapSelectionItem[] = [];
  const emitted = new Set<string>();
  for (const item of selection) {
    const replacement = replacementBySeatId.get(item.id);
    if (!replacement) return selection;
    const key = `${replacement.type}:${replacement.id}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(replacement);
  }
  return result;
}
