export type { BoundsRect } from '../geometry/bounds.js';
export {
  getSeatBounds,
  intersectsRect,
  normalizeBoundsRect,
  unionBounds,
  expandRect,
  clampRectToLevel,
  boundsFromPoints,
  centerOf,
} from '../geometry/bounds.js';
export { getObjectBounds } from '../layout/object-bounds.js';

export type MapSelectionItem =
  | { type: 'object'; id: string }
  | { type: 'seat'; id: string }
  | { type: 'seatgroup'; id: string }
  | { type: 'section'; id: string }
  | { type: 'level'; id: string };

export type MapSelection = MapSelectionItem[];

export function selectionKey(item: MapSelectionItem) {
  return `${item.type}:${item.id}`;
}

export function isSameSelectionItem(a: MapSelectionItem, b: MapSelectionItem) {
  return a.type === b.type && a.id === b.id;
}

export function isItemSelected(selection: MapSelection, item: MapSelectionItem) {
  return selection.some((entry) => isSameSelectionItem(entry, item));
}

export function normalizeSelection(selection: MapSelectionItem | MapSelectionItem[] | null | undefined): MapSelection {
  if (!selection) return [];
  return Array.isArray(selection) ? selection : [selection];
}

export function getPrimarySelection(selection: MapSelection): MapSelectionItem | null {
  const items = selection.filter((item) => item.type !== 'level');
  if (items.length > 0) return items.at(-1) ?? null;
  return selection[0] ?? null;
}

export function getSelectableItems(selection: MapSelection) {
  return selection.filter((item) => item.type !== 'level');
}

export function toggleSelectionItem(selection: MapSelection, item: MapSelectionItem): MapSelection {
  if (item.type === 'level') {
    return [item];
  }

  const withoutLevel = selection.filter((entry) => entry.type !== 'level');
  const exists = withoutLevel.some((entry) => isSameSelectionItem(entry, item));
  if (exists) {
    const next = withoutLevel.filter((entry) => !isSameSelectionItem(entry, item));
    return next.length > 0 ? next : selection.some((entry) => entry.type === 'level') ? selection.filter((entry) => entry.type === 'level') : [];
  }

  return [...withoutLevel, item];
}

export function replaceSelection(item: MapSelectionItem): MapSelection {
  return [item];
}

