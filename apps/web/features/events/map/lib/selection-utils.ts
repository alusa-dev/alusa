import { getTextMode, measureTextWidth } from './text-object';

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

export type BoundsRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function normalizeBoundsRect(start: { x: number; y: number }, current: { x: number; y: number }): BoundsRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function intersectsRect(a: BoundsRect, b: BoundsRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getObjectBounds(object: {
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  type: string;
  data?: Record<string, unknown>;
}) {
  if (object.type === 'TEXT') {
    const fontSize = Number(object.data?.fontSize ?? 22);
    const lineHeight = Number(object.data?.lineHeight ?? 1.2);
    const text = String(object.data?.text ?? 'Texto');
    const lineCount = Math.max(1, text.split('\n').length);
    const mode = getTextMode({
      width: object.width,
      height: object.height,
      data: object.data ?? {},
    });
    const width =
      object.width ??
      (mode === 'auto'
        ? measureTextWidth(text, fontSize, {
            fontFamily: String(object.data?.fontFamily ?? 'Inter, sans-serif'),
            fontWeight: String(object.data?.fontWeight ?? 'normal'),
            letterSpacing: Number(object.data?.letterSpacing ?? 0),
          })
        : Math.max(24, Math.min(480, text.length * fontSize * 0.55)));
    const height = object.height ?? Math.max(fontSize * lineHeight, fontSize * lineHeight * lineCount);
    return { x: object.x, y: object.y, width, height };
  }

  const width = object.width ?? 180;
  const height = object.height ?? 90;
  return { x: object.x, y: object.y, width, height };
}

export function getSeatBounds(seat: { x: number; y: number; size?: number | null }) {
  const size = seat.size ?? 24;
  return {
    x: seat.x - size / 2,
    y: seat.y - size / 2,
    width: size,
    height: size,
  };
}
